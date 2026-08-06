/**
 * Single source of truth for every language this extension knows about.
 *
 * ADDING A LANGUAGE: add one entry here, drop in i18n/locales/<code>.json, run
 * `node i18n/validate.mjs`. No other file should need to change. If you find
 * yourself editing popup.js / popup.css / background.js to add a language,
 * something regressed — see docs/06-多語系介面設計.md §10.
 *
 * Field contract:
 *   code        BCP 47 tag. Doubles as the locales/<code>.json filename.
 *   endonym     Native name. Shown in language pickers; NEVER translated, so a
 *               user who picked a script they can't read can still find their way back.
 *   english     English name. Fed to the LLM as the target language name.
 *   dir         'ltr' | 'rtl'. Written to <html dir>. Adding an RTL language also
 *               requires the CSS to use logical properties (it already does).
 *   fallback    Locale to borrow missing keys from; null marks the root locale.
 *               Chain example: zh-HK -> zh-TW -> en.
 *   ui          Selectable as the interface language. Requires locales/<code>.json.
 *   target      Selectable as a translation target language. Needs no locale file.
 *   lineHeight  Base line-height. Thai needs extra room for its stacked marks.
 *   fontStack   Key into the --font-* custom properties in popup.css.
 */
export const LANGUAGES = [
  { code: 'en',    endonym: 'English',    english: 'English',             dir: 'ltr', fallback: null, ui: true,  target: true, lineHeight: 1.4,  fontStack: 'latin'  },
  { code: 'zh-TW', endonym: '繁體中文',    english: 'Traditional Chinese', dir: 'ltr', fallback: 'en', ui: true,  target: true, lineHeight: 1.5,  fontStack: 'cjk-tc' },
  { code: 'zh-CN', endonym: '简体中文',    english: 'Simplified Chinese',  dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.5,  fontStack: 'cjk-sc' },
  { code: 'ja',    endonym: '日本語',      english: 'Japanese',            dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.5,  fontStack: 'jp'     },
  { code: 'ko',    endonym: '한국어',      english: 'Korean',              dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.5,  fontStack: 'kr'     },
  { code: 'es',    endonym: 'Español',    english: 'Spanish',             dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.4,  fontStack: 'latin'  },
  { code: 'fr',    endonym: 'Français',   english: 'French',              dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.4,  fontStack: 'latin'  },
  { code: 'de',    endonym: 'Deutsch',    english: 'German',              dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.4,  fontStack: 'latin'  },
  { code: 'vi',    endonym: 'Tiếng Việt', english: 'Vietnamese',          dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.5,  fontStack: 'latin'  },
  { code: 'th',    endonym: 'ไทย',        english: 'Thai',                dir: 'ltr', fallback: 'en', ui: true , target: true, lineHeight: 1.65, fontStack: 'thai'   },
];

/** The root locale. Every fallback chain terminates here. */
export const ROOT_LOCALE = 'en';

/** Languages offering a translated interface (i.e. shipping a locales/<code>.json). */
export const UI_LANGUAGES = LANGUAGES.filter((l) => l.ui);

/** Languages offering themselves as a translation target. */
export const TARGET_LANGUAGES = LANGUAGES.filter((l) => l.target);

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || null;
}

/**
 * Label for the TARGET language picker: "Traditional Chinese (繁體中文)".
 * Collapses to just the English name when the two are identical ("English").
 */
export function targetLabel(lang) {
  return lang.endonym === lang.english ? lang.english : `${lang.english} (${lang.endonym})`;
}

/**
 * Label for the INTERFACE language picker: the endonym alone.
 * Deliberately not localised — see the `endonym` note above.
 */
export function uiLabel(lang) {
  return lang.endonym;
}

/**
 * Missing-key lookup order for a locale, e.g. 'zh-HK' -> ['zh-HK', 'zh-TW', 'en'].
 * Guards against a cyclic `fallback` and always terminates at the root locale.
 */
export function fallbackChain(code) {
  const chain = [];
  let cur = code;
  while (cur && !chain.includes(cur)) {
    chain.push(cur);
    cur = getLanguage(cur)?.fallback ?? null;
  }
  if (!chain.includes(ROOT_LOCALE)) chain.push(ROOT_LOCALE);
  return chain;
}

/**
 * Decide which interface language to use.
 * Priority: the user's stored choice > exact browser locale > same primary
 * subtag as the browser ('ja-JP' -> 'ja', 'zh-CN' -> 'zh-TW' while zh-CN has no
 * locale file yet) > the root locale.
 */
export function resolveUiLang(stored) {
  const isAvailable = (code) => UI_LANGUAGES.some((l) => l.code === code);
  if (stored && isAvailable(stored)) return stored;

  let browser = ROOT_LOCALE;
  try {
    browser = chrome?.i18n?.getUILanguage?.() || ROOT_LOCALE;
  } catch {
    // Not in an extension context (e.g. running under Node for validation)
  }

  if (isAvailable(browser)) return browser;

  const primary = browser.split('-')[0];
  const near = UI_LANGUAGES.find((l) => l.code.split('-')[0] === primary);
  return near ? near.code : ROOT_LOCALE;
}
