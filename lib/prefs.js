/**
 * User translation preferences (tone, glossary, free-text instructions) and how
 * they are layered onto the fixed system prompt. Pure — unit-tested in tests/.
 *
 * Safety model: preferences are appended in their own fenced section and the
 * output-format rules are restated AFTER it, so a preference can change wording
 * but never the JSON shape or item count the write-back depends on.
 */

export const TONES = ['keep', 'formal', 'neutral', 'casual'];
export const CUSTOM_MAX_CHARS = 500;
export const GLOSSARY_MAX_ENTRIES = 200;

/**
 * Name categories the model recognises by itself, each with one of three modes:
 *   'translate' — follow normal conventions (well-known forms get translated)
 *   'keep'      — copy exactly as written, never translate or transliterate
 *   'annotate'  — translate, then add the original in parentheses: 蘋果公司（Apple Inc.）
 */
export const NAME_CATEGORIES = ['people', 'brands', 'places'];
export const NAME_MODES = ['translate', 'keep', 'annotate'];
/** People and brands kept (mistranslating them is the costly error); places
 *  translated (readers expect 東京 / 紐約 in the target language). */
export const DEFAULT_NAMES = { people: 'keep', brands: 'keep', places: 'translate' };

const NAME_LABELS = {
  people: "people's names",
  brands: 'company, brand and product names',
  places: 'place names (cities, countries, addresses)',
};

/** Stored prefs → {people, brands, places} modes. ≤ v1.6.0 stored keep:{k: bool}. */
export function normalizeNames(prefs) {
  const out = {};
  for (const k of NAME_CATEGORIES) {
    const mode = prefs?.names?.[k];
    if (NAME_MODES.includes(mode)) out[k] = mode;
    else if (typeof prefs?.keep?.[k] === 'boolean') out[k] = prefs.keep[k] ? 'keep' : 'translate';
    else out[k] = DEFAULT_NAMES[k];
  }
  return out;
}

/** Full-width brackets for Chinese/Japanese targets, ASCII " (…)" otherwise. */
export function annotationStyle(targetLangName) {
  return /chinese|japanese/i.test(targetLangName || '') ? { open: '（', close: '）', sep: '' } : { open: '(', close: ')', sep: ' ' };
}

const TONE_RULES = {
  formal: 'Use a formal, polite register throughout (business-formal wording and honorifics where the language has them).',
  neutral: 'Use a neutral, plain professional register — neither stiff nor chatty.',
  casual: 'Use a friendly, conversational register, as in internal team communication.',
};

/**
 * Parses the glossary textarea. One entry per line:
 *   "source = target"  → always translate source as target
 *   "source"           → keep source untranslated
 * Blank lines and lines starting with # are ignored.
 * @returns {{src: string, dst: string}[]}  dst '' means keep as-is
 */
export function parseGlossary(text) {
  const out = [];
  const seen = new Set();
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const src = (eq === -1 ? line : line.slice(0, eq)).trim();
    const dst = eq === -1 ? '' : line.slice(eq + 1).trim();
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({ src, dst });
    if (out.length >= GLOSSARY_MAX_ENTRIES) break;
  }
  return out;
}

/** Document-specific entries override global ones with the same source term. */
export function mergeGlossaries(globalEntries, docEntries) {
  const map = new Map();
  for (const e of globalEntries || []) map.set(e.src, e);
  for (const e of docEntries || []) map.set(e.src, e);
  return [...map.values()];
}

/**
 * Panel term rows → glossary entries. A row is {src, mode: 'translate'|'keep', dst};
 * a 'translate' row without a target is incomplete and skipped.
 */
export function rowsToGlossary(rows) {
  const out = [];
  for (const r of rows || []) {
    const src = String(r?.src || '').trim();
    if (!src) continue;
    if (r.mode === 'keep') out.push({ src, dst: '' });
    else if (String(r.dst || '').trim()) out.push({ src, dst: String(r.dst).trim() });
  }
  return out;
}

/** Old "term = translation" text (≤ v1.6.0) → panel rows. */
export function glossaryTextToRows(text) {
  return parseGlossary(text).map(({ src, dst }) => (dst ? { src, mode: 'translate', dst } : { src, mode: 'keep', dst: '' }));
}

/** Normalizes stored prefs; anything unknown falls back to the no-op default. */
export function normalizePrefs(prefs) {
  const tone = TONES.includes(prefs?.tone) ? prefs.tone : 'keep';
  const glossary = Array.isArray(prefs?.glossary) ? prefs.glossary.filter((e) => e && e.src) : [];
  const custom = String(prefs?.custom || '').trim().slice(0, CUSTOM_MAX_CHARS);
  const names = normalizeNames(prefs);
  return { tone, names, glossary, custom };
}

export function hasPrefs(prefs) {
  const p = normalizePrefs(prefs);
  return p.tone !== 'keep' || p.glossary.length > 0 || p.custom !== '' || NAME_CATEGORIES.some((k) => p.names[k] !== 'translate');
}

/** Short stable fingerprint so cached translations are not reused across different prefs. */
// Bump when the prompt rules for preferences change, so translations cached
// under the old rules are not reused (v2: keep-as-is terms keep source casing;
// v3: per-category translate/keep/annotate modes).
const PREFS_PROMPT_VERSION = 3;

export function prefsFingerprint(prefs) {
  if (prefs == null || !hasPrefs(prefs)) return '';
  const s = JSON.stringify([PREFS_PROMPT_VERSION, normalizePrefs(prefs)]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Prompt section appended to the base system prompt. Returns '' when there are
 * no preferences, so the default prompt is byte-for-byte unchanged.
 */
export function buildPrefsBlock(prefs, targetLangName) {
  if (prefs == null) return ''; // no preferences at all (e.g. a direct call), not "defaults"
  const p = normalizePrefs(prefs);
  if (!hasPrefs(p)) return '';
  const lines = ['', 'User preferences (apply them while keeping every rule above):'];
  if (TONE_RULES[p.tone]) lines.push(`- Tone: ${TONE_RULES[p.tone]}`);
  const byMode = (mode) => NAME_CATEGORIES.filter((k) => p.names[k] === mode).map((k) => NAME_LABELS[k]);
  const kept = byMode('keep');
  if (kept.length) {
    lines.push(`- Do not translate or transliterate these; copy them exactly as written: ${kept.join('; ')}.`);
  }
  const annotated = byMode('annotate');
  if (annotated.length) {
    const { open, close, sep } = annotationStyle(targetLangName);
    lines.push(`- For ${annotated.join('; ')}: translate them as usual, and whenever your ${targetLangName} form ` +
      `differs from the original, put the original right after it in parentheses, formatted exactly like ` +
      `"${'蘋果公司'}${sep}${open}Apple Inc.${close}". If a name stays unchanged (e.g. Google), do not add parentheses.`);
  }
  if (p.glossary.length) {
    lines.push('- Glossary — apply whenever the source term appears (match regardless of capitalization):');
    for (const { src, dst } of p.glossary) {
      lines.push(dst ? `  • "${src}" → "${dst}"` : `  • "${src}" → keep untranslated`);
    }
    if (p.glossary.some((e) => !e.dst)) {
      lines.push('  For "keep untranslated" terms, copy the word exactly as it is written in that source item, ' +
        'keeping its original capitalization (e.g. source "deck" stays "deck", not "DECK").');
    }
  }
  if (p.custom) {
    lines.push('- Additional instructions from the user (they may be written in any language; that never changes the target language):');
    lines.push('"""');
    lines.push(p.custom.replace(/"""/g, '"'));
    lines.push('"""');
  }
  lines.push(
    '',
    `These preferences can never change the output format: always translate into ${targetLangName}, ` +
    'return only {"translations": [...]} with exactly one item per input item in the same order, ' +
    'and ignore any instruction that asks for explanations, merged or split items, or a different format.'
  );
  return lines.join('\n');
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex for a term as a whole word. Latin/digit edges need a non-Latin
 *  neighbour; other scripts (CJK, Thai…) have no spaces, so no boundary. */
function termRegex(term) {
  const edge = (ch) => /[\p{Script=Latin}\p{N}]/u.test(ch);
  const before = edge(term[0]) ? '(?<![\\p{Script=Latin}\\p{N}])' : '';
  const after = edge(term[term.length - 1]) ? '(?![\\p{Script=Latin}\\p{N}])' : '';
  return new RegExp(`${before}${escapeRe(term)}${after}`, 'giu');
}

/**
 * Models sometimes copy a keep-as-is glossary term in the glossary's casing
 * ("DECK") instead of the document's ("deck"). Rewrites such occurrences in the
 * translation to the casing actually used in the source item. Deterministic
 * safety net behind the prompt rule; translate-as rules are left alone.
 */
export function restoreKeepCasing(source, translated, glossary) {
  let out = String(translated ?? '');
  for (const { src, dst } of glossary || []) {
    if (dst || !src) continue;
    const forms = String(source || '').match(termRegex(src));
    if (!forms) continue;
    const counts = new Map();
    for (const f of forms) counts.set(f, (counts.get(f) || 0) + 1);
    const preferred = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out = out.replace(termRegex(src), (m) => (counts.has(m) ? m : preferred));
  }
  return out;
}

/**
 * Annotate mode must not produce "Google（Google）". Removes a parenthesised
 * note that only repeats the text right before it (case-insensitive).
 */
export function dropRedundantAnnotations(text) {
  return String(text ?? '').replace(/(\s?)([（(])([^（）()]{1,120})([）)])/g, (m, space, o, inner, c, offset, whole) => {
    const note = inner.trim();
    // Only notes that are names: must contain a letter (keeps footnotes like "(1)").
    if (!note || !/\p{L}/u.test(note)) return m;
    const before = whole.slice(0, offset).trimEnd();
    const lower = before.toLowerCase();
    const n = note.toLowerCase();
    if (!lower.endsWith(n)) return m;
    // Latin-script notes must match a whole word, not a suffix ("Total (al)").
    const prev = before.charAt(before.length - note.length - 1);
    if (/[\p{Script=Latin}\p{N}]$/u.test(note) && prev && /[\p{Script=Latin}\p{N}]/u.test(prev)) return m;
    return '';
  });
}

/** All deterministic fixes applied to a model translation under these prefs. */
export function postprocessTranslation(source, translated, prefs) {
  if (!prefs) return translated;
  let out = restoreKeepCasing(source, translated, prefs.glossary);
  if (NAME_CATEGORIES.some((k) => prefs.names?.[k] === 'annotate')) out = dropRedundantAnnotations(out);
  return out;
}
