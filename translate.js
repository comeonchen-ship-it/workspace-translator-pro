// Target Language ISO Code to Full Name Mapping
const LANG_NAMES = {
  'zh-TW': 'Traditional Chinese (繁體中文)',
  'zh-CN': 'Simplified Chinese (简体中文)',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'vi': 'Vietnamese',
  'th': 'Thai'
};

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

  const targetLangName = LANG_NAMES[targetLang] || targetLang;
  const engine = config.translationEngine || 'gemini';
  const presentationId = config?.presentationId;

  await logDebug(`Starting translation of ${texts.length} unique texts using engine: ${engine.toUpperCase()}`, presentationId);

  // 1. Retrieve the translation cache for the target language (segregated by engine to prevent quality collisions)
  const cacheKey = `translationCache_${engine}_${targetLang}`;
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
      translationsMap.set(text, cache[trimmed]);
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
      let batchTranslations = [];
      try {
        if (engine === 'gemini') {
          batchTranslations = await translateGemini(batch, targetLangName, config);
        } else if (engine === 'openai') {
          batchTranslations = await translateOpenAI(batch, targetLangName, config);
        } else if (engine === 'claude') {
          batchTranslations = await translateClaude(batch, targetLangName, config);
        } else if (engine === 'custom') {
          batchTranslations = await translateCustomOpenAI(batch, targetLangName, config);
        }
        if (!Array.isArray(batchTranslations)) {
          throw new Error(`Translation API returned an invalid response format (expected an array).`);
        }
        if (batchTranslations.length !== batch.length) {
          throw new Error(`Translation mismatch: sent ${batch.length} items to translate, but received ${batchTranslations.length} items.`);
        }
        await logDebug(`Successfully translated batch ${idx + 1}/${batches.length}.`, presentationId);
      } catch (err) {
        await logDebug(`Error translating batch ${idx + 1}: ${err.message}`, presentationId);
        throw err;
      }

      // Map responses and save to cache
      for (let i = 0; i < batch.length; i++) {
        const original = batch[i];
        const translated = batchTranslations[i] !== undefined ? batchTranslations[i] : original;
        translationsMap.set(original, translated);
        cache[original.trim()] = translated;
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
async function fetchWithRetryAndTimeout(url, options = {}, timeoutMs = 60000, maxRetries = 3, presentationId = null, useLock = false, cooldownMs = 4200) {
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
function extractJsonBlock(str) {
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
 * Helper to robustly parse JSON from LLM responses even if they have trailing markdown or text
 */
function parseJsonRobustly(str) {
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
      throw e; // rethrow the original parsing error if extraction fails
    }
  }
}

/**
 * Google Gemini API
 */
async function translateGemini(texts, targetLangName, config) {
  const presentationId = config?.presentationId;
  const model = config.modelName || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

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
          text: `You are a professional translator. Translate the given array of text strings into the target language: "${targetLangName}".
Return a JSON object containing a single key "translations", which is a JSON array of the translated strings in the exact same order and length.
Preserve the exact tone, layout spacing placeholders, and technical terminology. Do not explain anything.
Do not translate, modify, or corrupt any URLs (links starting with http/https/www) or email addresses. Keep them exactly as they are in the original text.`
        }
      ]
    },
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetchWithRetryAndTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  const systemPrompt = `You are a professional translator. Translate the given array of text strings into the target language: "${targetLangName}".
Return a JSON object containing a single key "translations", which is a JSON array of the translated strings in the exact same order and length.
Preserve the exact tone, layout spacing placeholders, and technical terminology. Do not explain anything.
Do not translate, modify, or corrupt any URLs (links starting with http/https/www) or email addresses. Keep them exactly as they are in the original text.`;

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

  const systemPrompt = `You are a professional translator. Translate the given array of text strings into the target language: "${targetLangName}".
Return a JSON object containing a single key "translations", which is a JSON array of the translated strings in the exact same order and length.
Preserve the exact tone, layout spacing placeholders, and technical terminology. Do not explain anything.
Do not translate, modify, or corrupt any URLs (links starting with http/https/www) or email addresses. Keep them exactly as they are in the original text.`;

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

  const systemPrompt = `You are a professional translator. Translate the given array of text strings into the target language: "${targetLangName}".
Return a JSON object containing a single key "translations", which is a JSON array of the translated strings in the exact same order and length.
Preserve the exact tone, layout spacing placeholders, and technical terminology. Do not explain anything.
Do not translate, modify, or corrupt any URLs (links starting with http/https/www) or email addresses. Keep them exactly as they are in the original text.`;

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
