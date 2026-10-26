import { getLanguage } from './i18n/languages.js';
import { marksIntact } from './lib/styled-runs.js';
import { buildPrefsBlock, prefsFingerprint, normalizePrefs, postprocessTranslation, unusedGlossaryTerms } from './lib/prefs.js';

/**
 * Human-readable target language name for the LLM prompt.
 * Sourced from the single language registry — do not reintroduce a local copy.
 */
function langName(code) {
  const lang = getLanguage(code);
  if (!lang) return code;
  // Both Chinese variants need the script spelled out or models drift between them.
  return lang.code.startsWith('zh') ? `${lang.english} (${lang.endonym})` : lang.english;
}

// Enterprise-Grade Global Outgoing API Request Mutex & Cooldown scheduler
// Formulated to stay safely below Gemini Free Tier 15 RPM (Requests Per Minute) limits globally
let apiLockPromise = Promise.resolve();
let lastApiRequestTime = 0;

async function acquireApiLock(presentationId, cooldownMs = 4200) {
  const currentPromise = apiLockPromise;
  let releaseLock;
  apiLockPromise = new Promise(resolve => {
    releaseLock = resolve;
  });
  
  await currentPromise;
  
  try {
    const cancelData = await chrome.storage.local.get('cancelledTasks');
    const cancelledTasks = cancelData.cancelledTasks || [];
    if (cancelledTasks.includes(presentationId)) {
      throw new Error('Translation stopped by user.');
    }

    const now = Date.now();
    const timeSinceLast = now - lastApiRequestTime;
    if (timeSinceLast < cooldownMs) {
      const waitTime = cooldownMs - timeSinceLast;
      await logDebug(`Global Rate Limiter: Spacing out request by ${waitTime}ms to stay safely under target RPM...`, presentationId);
      
      const startTime = Date.now();
      while (Date.now() - startTime < waitTime) {
        const innerCancelData = await chrome.storage.local.get('cancelledTasks');
        const innerCancelledTasks = innerCancelData.cancelledTasks || [];
        if (innerCancelledTasks.includes(presentationId)) {
          throw new Error('Translation stopped by user.');
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    lastApiRequestTime = Date.now();
  } finally {
    // Release the lock immediately so the next request in line can begin its cooldown spacing check and fire
    releaseLock();
  }
}

export async function logDebug(msg, presentationId) {
  console.log(`[WorkspaceTranslator] ${msg}`);
  try {
    const key = presentationId ? `debugLogs_${presentationId}` : 'debugLogs';
    const data = await chrome.storage.local.get(key);
    const logs = data[key] || [];
    const timestamp = new Date().toLocaleTimeString();
    logs.push(`[${timestamp}] ${msg}`);
    if (logs.length > 50) logs.shift();
    await chrome.storage.local.set({ [key]: logs });
  } catch (e) {
    // Ignore
  }
}

/**
 * Unified translation interface
 * @param {string[]} texts - Array of unique strings to translate
 * @param {string} targetLang - Target language code (e.g. 'zh-TW')
 * @param {Object} config - Configuration object
 * @returns {Promise<Map<string, string>>} - Map of original -> translated text
 */
export async function translateTexts(texts, targetLang, config) {
  if (!texts || texts.length === 0) {
    await logDebug('No texts extracted for translation.', config?.presentationId);
    return new Map();
  }

  const targetLangName = langName(targetLang);
  const engine = config.translationEngine || 'gemini';
  const presentationId = config?.presentationId;

  await logDebug(`Starting translation of ${texts.length} unique texts using engine: ${engine.toUpperCase()}`, presentationId);

  // 1. Retrieve the translation cache for the target language (segregated by engine to prevent quality collisions)
  // Preferences only apply to LLM engines. They are part of the cache key so a
  // glossary/tone change never serves translations made under different rules.
  config.activePrefs = engine === 'free' ? null : normalizePrefs(config.prefs);
  // Terms the user set that don't occur in this file (often a typo, e.g. DESK vs deck):
  // reported on the completion card so the user can fix the term.
  if (config.activePrefs) {
    config.unusedTerms = [...new Set([...(config.unusedTerms || []), ...unusedGlossaryTerms(texts, config.activePrefs.glossary)])];
  }
  const fp = engine === 'free' ? '' : prefsFingerprint(config.activePrefs);
  const cacheKey = `translationCache_${engine}_${targetLang}${fp ? `_${fp}` : ''}`;
  let cache = {};
  try {
    const data = await chrome.storage.local.get(cacheKey);
    cache = data[cacheKey] || {};
  } catch (e) {
    await logDebug(`Warning: failed to load translation cache: ${e.message}`, presentationId);
  }

  // 2. Separate texts into cached and uncached
  const uncachedTexts = [];
  const translationsMap = new Map();

  for (const text of texts) {
    const trimmed = text.trim();
    if (cache[trimmed] !== undefined) {
      // Same post-processing as fresh results — cached entries may predate it.
      translationsMap.set(text, postprocessTranslation(text, cache[trimmed], config.activePrefs));
    } else {
      uncachedTexts.push(text);
    }
  }

  const cachedCount = texts.length - uncachedTexts.length;
  if (cachedCount > 0) {
    await logDebug(`Cache Hit: retrieved ${cachedCount}/${texts.length} translations from local cache.`, presentationId);
  }

  // 3. If everything is cached, return immediately!
  if (uncachedTexts.length === 0) {
    await logDebug(`All ${texts.length} texts successfully resolved from local cache instantly.`, presentationId);
    return translationsMap;
  }

  // 4. Translate uncached texts
  try {
    const cancelData = await chrome.storage.local.get('cancelledTasks');
    const cancelledTasks = cancelData.cancelledTasks || [];
    if (cancelledTasks.includes(presentationId)) {
      throw new Error('Translation stopped by user.');
    }
  } catch (e) {
    if (e.message === 'Translation stopped by user.') throw e;
  }

  if (engine === 'free') {
    const freeResults = await translateFree(uncachedTexts, targetLang, config);
    // Save to cache and map to final translationsMap
    for (const [original, translated] of freeResults.entries()) {
      translationsMap.set(original, translated);
      cache[original.trim()] = translated;
    }
  } else {
    // Dynamic batch size based on character count and item count to balance speed and reliability (especially for Docs/PPTs with long paragraphs)
    let maxBatchChars = 3000; // safe character limit per request
    let maxBatchItems = 40;   // safe maximum items per request
    let cooldownMs = 4200;    // default safe cooldown (e.g. Gemini free tier 15 RPM)
    
    if (engine === 'gemini') {
      maxBatchChars = 4000;
      maxBatchItems = 35;
      cooldownMs = 4200;
    } else if (engine === 'openai') {
      maxBatchChars = 6000;
      maxBatchItems = 50;
      cooldownMs = 2000;
    } else if (engine === 'claude') {
      maxBatchChars = 5000;
      maxBatchItems = 50;
      cooldownMs = 2000;
    } else if (engine === 'custom') {
      maxBatchChars = 8000;
      maxBatchItems = 60;
      cooldownMs = 1000;
    }
    
    config.cooldownMs = cooldownMs;

    const batches = [];
    let currentBatch = [];
    let currentBatchChars = 0;

    for (const text of uncachedTexts) {
      const textLen = text.length;
      // If adding this item would exceed character limits, or if item limit is reached, flush batch
      if (
        (currentBatch.length > 0 && currentBatchChars + textLen > maxBatchChars) ||
        currentBatch.length >= maxBatchItems
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchChars = 0;
      }
      currentBatch.push(text);
      currentBatchChars += textLen;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }


    const translateBatch = (batch) => {
      if (engine === 'gemini') return translateGemini(batch, targetLangName, config);
      if (engine === 'openai') return translateOpenAI(batch, targetLangName, config);
      if (engine === 'claude') return translateClaude(batch, targetLangName, config);
      if (engine === 'custom') return translateCustomOpenAI(batch, targetLangName, config);
      return Promise.resolve([]);
    };

    const isFormatError = (err) => /Translation mismatch|invalid response format/.test(err?.message || '');
    const checked = async (items) => {
      const out = await translateBatch(items);
      if (!Array.isArray(out)) throw new Error('Translation API returned an invalid response format (expected an array).');
      if (out.length !== items.length) {
        throw new Error(`Translation mismatch: sent ${items.length} items to translate, but received ${out.length} items.`);
      }
      return out;
    };
    // When the model returns the wrong number of items (it merged or dropped
    // some), don't fail the whole job: drop the custom instructions once if any,
    // then split the batch in halves and retry; a single item that still fails
    // stays untranslated (its text is kept as is) instead of stopping the job.
    const translateResilient = async (items, label) => {
      try {
        return await checked(items);
      } catch (err) {
        if (!isFormatError(err)) throw err;
        await logDebug(`Batch ${label}: ${err.message}`, presentationId);
        if (config.activePrefs?.custom) {
          await logDebug('Retrying without the custom instructions, which may have broken the output format.', presentationId);
          config.activePrefs = { ...config.activePrefs, custom: '' };
          config.prefsCustomDropped = true;
          try { return await checked(items); } catch (e2) { if (!isFormatError(e2)) throw e2; }
        }
        if (items.length === 1) {
          await logDebug(`Kept one item untranslated after repeated format errors: "${items[0].slice(0, 60)}"`, presentationId);
          config.untranslatedCount = (config.untranslatedCount || 0) + 1;
          return [items[0]];
        }
        const mid = Math.ceil(items.length / 2);
        await logDebug(`Splitting batch ${label} (${items.length} items) and retrying.`, presentationId);
        const left = await translateResilient(items.slice(0, mid), `${label}a`);
        const right = await translateResilient(items.slice(mid), `${label}b`);
        return [...left, ...right];
      }
    };

    // done=0 starts the caller's ETA clock just before the first request.
    if (typeof config.onBatchProgress === 'function') config.onBatchProgress(0, batches.length);

    // Process batches SEQUENTIALLY — guarantees only one API request is in-flight
    // at a time, preventing parallel 429 retries from competing for the rate-limiter lock.
    for (let idx = 0; idx < batches.length; idx++) {
      const batch = batches[idx];
      try {
        const cancelData = await chrome.storage.local.get('cancelledTasks');
        const cancelledTasks = cancelData.cancelledTasks || [];
        if (cancelledTasks.includes(presentationId)) {
          throw new Error('Translation stopped by user.');
        }
      } catch (e) {
        if (e.message === 'Translation stopped by user.') throw e;
      }

      await logDebug(`Translating batch ${idx + 1}/${batches.length} (size: ${batch.length} items)...`, presentationId);
      let batchTranslations = await translateResilient(batch, idx + 1);
      await logDebug(`Successfully translated batch ${idx + 1}/${batches.length}.`, presentationId);

      if (typeof config.onBatchProgress === 'function') {
        config.onBatchProgress(idx + 1, batches.length);
      }

      // Map responses and save to cache. After the custom-instruction fallback the
      // results no longer match this cache key's prefs, so they are not cached.
      for (let i = 0; i < batch.length; i++) {
        const original = batch[i];
        const raw = batchTranslations[i] !== undefined ? batchTranslations[i] : original;
        const translated = postprocessTranslation(original, raw, config.activePrefs);
        translationsMap.set(original, translated);
        // Results whose formatting markers came back broken aren't cached, so a
        // rerun asks the model again instead of reusing the one-style fallback.
        if (!config.prefsCustomDropped && marksIntact(original, translated)) cache[original.trim()] = translated;
      }
    }
  }

  // 5. Persist the updated cache back to chrome.storage.local with FIFO boundary
  try {
    const cacheKeys = Object.keys(cache);
    if (cacheKeys.length > 2000) {
      // Remove oldest 500 keys
      for (let k = 0; k < 500; k++) {
        delete cache[cacheKeys[k]];
      }
    }
    await chrome.storage.local.set({ [cacheKey]: cache });
  } catch (e) {
    await logDebug(`Warning: failed to persist translation cache: ${e.message}`, presentationId);
  }

  await logDebug(`Completed translating all ${texts.length} texts.`, presentationId);
  return translationsMap;
}

/**
 * Helper to fetch with retry and timeout for handling rate limits (429) and server errors (5xx)
 */
export async function fetchWithRetryAndTimeout(url, options = {}, timeoutMs = 60000, maxRetries = 3, presentationId = null, useLock = false, cooldownMs = 4200) {
  let attempt = 0;
  let baseDelay = 6000; // increased from 2000ms — aggressive backoff for rate-limited models
  
  while (true) {
    try {
      if (useLock) {
        await acquireApiLock(presentationId, cooldownMs);
      }
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs)
      });
      
      if (response.ok) {
        return response;
      }
      
      // If we encounter a rate limit (429) or transient server error (5xx), retry
      if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
        if (attempt < maxRetries) {
          attempt++;
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
          await logDebug(`Rate limit/Server error (${response.status}) hit. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`, presentationId);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      return response;
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      const isNetworkError = err instanceof TypeError;
      
      if ((isTimeout || isNetworkError) && attempt < maxRetries) {
        attempt++;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        await logDebug(`Network/Timeout error (${err.message}) hit. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`, presentationId);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      if (isTimeout) {
        throw new Error(`API request timed out after ${timeoutMs / 1000}s. Please check your internet connection or try again.`);
      }
      throw err;
    }
  }
}

/**
 * Free Google Translate API
 */
async function translateFree(texts, targetLang, config) {
  const presentationId = config?.presentationId;
  await logDebug(`Translating using Free Google Translate (total ${texts.length} items)...`, presentationId);
  const results = new Map();
  const concurrency = 5;
  const chunks = [];
  
  for (let i = 0; i < texts.length; i += concurrency) {
    chunks.push(texts.slice(i, i + concurrency));
  }
  
  for (let idx = 0; idx < chunks.length; idx++) {
    const cancelData = await chrome.storage.local.get('cancelledTasks');
    const cancelledTasks = cancelData.cancelledTasks || [];
    if (cancelledTasks.includes(presentationId)) {
      throw new Error('Translation stopped by user.');
    }

    const chunk = chunks[idx];
    await logDebug(`Free Translate chunk ${idx + 1}/${chunks.length}...`, presentationId);
    await Promise.all(chunk.map(async (text) => {
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetchWithRetryAndTimeout(url, {}, 8000, 3, presentationId); // 8s timeout, 3 retries
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        
        let translatedText = "";
        if (data && data[0]) {
          for (let part of data[0]) {
            if (part && part[0]) {
              translatedText += part[0];
            }
          }
        }
        results.set(text, translatedText || text);
      } catch (err) {
        await logDebug(`Free translate error for: "${text.substring(0, 20)}...": ${err.message}`, presentationId);
        results.set(text, text); // Fallback to original
      }
    }));
    await new Promise(r => setTimeout(r, 100)); // Small pause
  }
  return results;
}

/**
 * Helper to lexically extract the first matching JSON block (object or array) from a string.
 * This ignores comments, explanations, or stray braces after the actual JSON structure.
 */
export function extractJsonBlock(str) {
  const startBrace = str.indexOf('{');
  const startBracket = str.indexOf('[');
  
  let start = -1;
  let openChar = '';
  let closeChar = '';
  
  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
    start = startBrace;
    openChar = '{';
    closeChar = '}';
  } else if (startBracket !== -1) {
    start = startBracket;
    openChar = '[';
    closeChar = ']';
  }
  
  if (start === -1) return null;
  
  let count = 0;
  let inString = false;
  let escape = false;
  
  for (let i = start; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === openChar) {
        count++;
      } else if (char === closeChar) {
        count--;
        if (count === 0) {
          return str.substring(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Escape any backslash that is NOT part of a valid JSON escape sequence.
 *
 * LLMs sometimes emit a literal '\' inside a string value (a Windows path like
 * C:\Users, a LaTeX fragment like \frac, a stray "\%" or "\x"). JSON.parse then
 * throws "Bad escaped character in JSON" and the WHOLE batch of translations is
 * lost. This repairs those lone backslashes so the response can be parsed.
 *
 * It walks the string and leaves every genuine escape (\" \\ \/ \b \f \n \r \t
 * \uXXXX) untouched, so it cannot corrupt already-valid JSON. The one unavoidable
 * ambiguity: a literal "\n"/"\t" the LLM meant as "backslash + letter" (e.g. a
 * path C:\newfile) is kept as the valid escape (newline/tab). That is rare in
 * slide/doc text and still far better than dropping the entire batch.
 */
export function repairJsonEscapes(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const next = s[i + 1];
    if (next === '"' || next === '\\' || next === '/' || next === 'b' ||
        next === 'f' || next === 'n' || next === 'r' || next === 't') {
      out += c + next; i++;                 // valid 2-char escape — keep verbatim
    } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) {
      out += s.substr(i, 6); i += 5;        // valid \uXXXX — keep verbatim
    } else {
      out += '\\\\';                        // invalid escape → escape the backslash
    }
  }
  return out;
}

/**
 * Helper to robustly parse JSON from LLM responses even if they have trailing markdown or text
 */
export function parseJsonRobustly(str) {
  const trimmed = str.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // 1. Remove markdown code block wrappers (e.g. ```json ... ```)
    let cleaned = trimmed.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      // 2. Lexically extract the main JSON block (object or array)
      const extracted = extractJsonBlock(trimmed);
      if (extracted) {
        try {
          return JSON.parse(extracted);
        } catch (e3) {
          // ignore
        }
      }
      // 3. Last resort: repair invalid escape sequences and retry. This runs ONLY
      //    after every strict attempt has already failed, so it can never regress
      //    a response that used to parse — it only rescues ones that were lost.
      for (const candidate of [extracted, cleaned, trimmed]) {
        if (!candidate) continue;
        try {
          return JSON.parse(repairJsonEscapes(candidate));
        } catch (e4) {
          // try next candidate
        }
      }
      throw e; // rethrow the original parsing error if every strategy fails
    }
  }
}

/**
 * Single source of truth for the translation system prompt (shared by all four
 * LLM engines). Previously this text was copy-pasted into Gemini / OpenAI /
 * Claude / Custom — editing one and forgetting the others produced "works on
 * Gemini, breaks on OpenAI" bugs (see docs/05 M2). Change wording HERE only.
 */
export function buildSystemPrompt(targetLangName, prefs = null) {
  return `You are a professional translator localizing short text fragments extracted from a business document (Google Slides, Docs, Sheets, or Forms) into ${targetLangName}.

Return ONLY a JSON object of exactly this shape, and nothing else:
{"translations": [<one translation for each input string>]}
- "translations" MUST contain exactly the same number of items as the input array, in the same order. Never merge, split, drop, add, or reorder items.
- Output raw JSON only — no markdown code fences, no comments, no explanations.

Quality:
- Translate the meaning into fluent, natural ${targetLangName} as a native professional would write it — never word-for-word.
- Preserve the source's tone and register; use the politeness/formality level that is standard for ${targetLangName}.
- Be consistent: render the same term the same way across every item.
- Use accurate, established terminology for technical, legal, and industry-specific wording.

Keep unchanged (do NOT translate or reformat):
- URLs (http/https/www) and email addresses.
- Numbers, dates, measurements, currency, and product codes/SKUs.
- Placeholders and markup such as {name}, {{var}}, %s, <tag>, and any leading/trailing spaces.
- Formatting markers ⟦1⟧…⟦/1⟧, ⟦2⟧…⟦/2⟧: they wrap words with special formatting (e.g. a highlighted colour). Keep every marker pair exactly once, placed around the translated words that carry that meaning, even if the word order changes; never translate, renumber, drop or add markers.
- Brand names, product names, and acronyms, unless a widely accepted ${targetLangName} form exists.

If an item is already written in ${targetLangName}, or is a proper noun/code with no meaningful translation, return it unchanged. Never return an empty array or fewer items than you were given.` + buildPrefsBlock(prefs, targetLangName);
}

/**
 * Google Gemini API
 */
async function translateGemini(texts, targetLangName, config) {
  const presentationId = config?.presentationId;
  const model = config.modelName || 'gemini-3.1-flash-lite'; // same default as the settings panel
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  await logDebug(`Sending request to Gemini API (Model: ${model})...`, presentationId);

  const payload = {
    contents: [
      {
        parts: [
          {
            text: `Input JSON array of strings to translate:\n${JSON.stringify({ texts }, null, 2)}`
          }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        {
          text: buildSystemPrompt(targetLangName, config.activePrefs)
        }
      ]
    },
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetchWithRetryAndTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify(payload)
  }, 60000, 5, presentationId, true, config.cooldownMs);

  await logDebug(`Gemini API response received. Status: ${response.status}`, presentationId);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  
  if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0].text) {
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error(`Gemini API request blocked by safety filter: ${data.promptFeedback.blockReason}`);
    }
    throw new Error('Gemini API returned an empty or invalid response.');
  }

  const textResponse = data.candidates[0].content.parts[0].text;
  const parsed = parseJsonRobustly(textResponse);
  return parsed.translations || [];
}

/**
 * OpenAI API
 */
async function translateOpenAI(texts, targetLangName, config) {
  const presentationId = config?.presentationId;
  const model = config.modelName || 'gpt-5.4-mini';
  const url = 'https://api.openai.com/v1/chat/completions';

  await logDebug(`Sending request to OpenAI API (Model: ${model})...`, presentationId);

  const systemPrompt = buildSystemPrompt(targetLangName, config.activePrefs);

  const payload = {
    model: model,
    response_format: { type: "json_object" },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ texts }) }
    ]
  };

  const response = await fetchWithRetryAndTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(payload)
  }, 60000, 5, presentationId, true, config.cooldownMs);

  await logDebug(`OpenAI API response received. Status: ${response.status}`, presentationId);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const parsed = parseJsonRobustly(content);
  return parsed.translations || [];
}

/**
 * Anthropic Claude API
 */
async function translateClaude(texts, targetLangName, config) {
  const presentationId = config?.presentationId;
  const model = config.modelName || 'claude-haiku-4-5-20251001';
  const url = 'https://api.anthropic.com/v1/messages';

  await logDebug(`Sending request to Anthropic Claude API (Model: ${model})...`, presentationId);

  const systemPrompt = buildSystemPrompt(targetLangName, config.activePrefs);

  const prefill = '{\n  "translations": [';
  
  const payload = {
    model: model,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [
      { role: 'user', content: JSON.stringify({ texts }) },
      { role: 'assistant', content: prefill }
    ]
  };

  const response = await fetchWithRetryAndTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  }, 60000, 5, presentationId, true, config.cooldownMs);

  await logDebug(`Claude API response received. Status: ${response.status}`, presentationId);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textResponse = data.content[0].text;
  const fullJsonText = prefill + textResponse;
  const parsed = parseJsonRobustly(fullJsonText);
  return parsed.translations || [];
}

/**
 * Custom OpenAI Compatible API
 */
async function translateCustomOpenAI(texts, targetLangName, config) {
  const presentationId = config?.presentationId;
  const model = config.modelName;
  const customUrl = config.customUrl.replace(/\/$/, '') + '/chat/completions';

  await logDebug(`Sending request to Custom OpenAI-compatible Endpoint: ${customUrl} (Model: ${model})...`, presentationId);

  const systemPrompt = buildSystemPrompt(targetLangName, config.activePrefs);

  const payload = {
    model: model,
    response_format: { type: "json_object" },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ texts }) }
    ]
  };

  const response = await fetchWithRetryAndTimeout(customUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(payload)
  }, 60000, 5, presentationId, true, config.cooldownMs);

  await logDebug(`Custom API response received. Status: ${response.status}`, presentationId);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Custom LLM API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const parsed = parseJsonRobustly(content);
  return parsed.translations || [];
}
