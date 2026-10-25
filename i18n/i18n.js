/**
 * Runtime i18n for the extension UI.
 *
 * Why not chrome.i18n / _locales? chrome.i18n resolves against the BROWSER's UI
 * language and Chrome offers no way to override it at runtime, so it cannot back
 * an in-app language switcher. _locales is still used, but only for the manifest
 * name/description that Chrome itself renders. See docs/06-多語系介面設計.md §2.
 *
 * This module touches the DOM and is intended for extension pages (side panel,
 * onboarding) — not the service worker. background.js sends message keys and lets
 * the UI translate them.
 */
import { fallbackChain, getLanguage, ROOT_LOCALE } from './languages.js';

const fileCache = new Map();

/** Dictionaries in lookup order: [active, ...fallbacks, root]. */
let dicts = [];
let activeCode = ROOT_LOCALE;

async function fetchLocale(code) {
  if (fileCache.has(code)) return fileCache.get(code);
  const url = chrome.runtime.getURL(`i18n/locales/${code}.json`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Locale file not found: ${code}.json (HTTP ${res.status})`);
  const json = await res.json();
  fileCache.set(code, json);
  return json;
}

/**
 * Load `code` plus its fallback chain. A missing non-root locale file degrades to
 * the rest of the chain rather than throwing, so one bad file can never leave the
 * UI blank.
 */
export async function loadLocale(code) {
  const chain = fallbackChain(code);
  const loaded = [];
  for (const c of chain) {
    try {
      loaded.push(await fetchLocale(c));
    } catch (err) {
      if (c === ROOT_LOCALE) throw err; // the root locale is not optional
      console.warn(`[i18n] Skipping ${c} in fallback chain: ${err.message}`);
    }
  }
  dicts = loaded;
  activeCode = code;
  applyTypography(code);
  return code;
}

export function getActiveLocale() {
  return activeCode;
}

/**
 * Look up `key`, walking the fallback chain. Interpolates {named} params.
 *
 * Returns the key itself when nothing matches. That is deliberate: an untranslated
 * string shows up as "settings.title" — ugly but immediately visible — whereas
 * returning empty would silently blank the UI.
 */
export function t(key, params) {
  let s;
  for (const dict of dicts) {
    const v = dict[key];
    if (v != null) {
      s = v;
      break;
    }
  }
  if (s == null) {
    console.warn(`[i18n] Missing key: ${key}`);
    s = key;
  }
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      // A param prefixed with '@' is itself a message key. The service worker uses
      // this to pass translatable nouns (e.g. '@fileType.document') without knowing
      // which language the UI is in.
      const resolved =
        typeof value === 'string' && value.startsWith('@') ? t(value.slice(1)) : value;
      s = s.replaceAll(`{${name}}`, String(resolved));
    }
  }
  return s;
}

/**
 * Render a progress status coming from the service worker.
 * Accepts the {key, params} form, and plain strings for backward compatibility with
 * taskState_* entries persisted by an older version of the extension.
 */
export function tStatus(status) {
  if (status == null) return '';
  if (typeof status === 'string') return status;
  if (typeof status === 'object' && status.key) return t(status.key, status.params);
  return String(status);
}

/** True when the key exists in any dictionary of the chain. */
export function has(key) {
  return dicts.some((d) => d[key] != null);
}

/**
 * Translate every element carrying an i18n attribute.
 *
 *   data-i18n              -> textContent
 *   data-i18n-placeholder  -> placeholder
 *   data-i18n-title        -> title (tooltip)
 *   data-i18n-aria-label   -> aria-label
 *   data-i18n-html         -> innerHTML (authored strings ONLY, never API output)
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
}

/**
 * Push the registry's per-language typography onto the document so CSS never needs
 * a per-language rule. Adding a language is a data change, not a CSS change.
 */
function applyTypography(code) {
  if (typeof document === 'undefined') return;
  const lang = getLanguage(code);
  if (!lang) return;
  const root = document.documentElement;
  root.lang = lang.code;
  root.dir = lang.dir;
  root.dataset.fontStack = lang.fontStack;
  root.style.setProperty('--i18n-line-height', String(lang.lineHeight));
}

/** Format a timestamp in the ACTIVE UI locale (not the browser's). */
export function formatDateTime(ms) {
  try {
    return new Date(ms).toLocaleString(activeCode);
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/**
 * Short, human date for lists: "today 14:05", "yesterday 09:12", otherwise the
 * date without seconds. "today"/"yesterday" come from Intl.RelativeTimeFormat,
 * so they are localized without extra message keys.
 */
export function formatShortDateTime(ms, now = Date.now()) {
  const d = new Date(ms);
  const locale = activeCode;
  try {
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const startOf = (x) => new Date(new Date(x).toDateString()).getTime();
    const days = Math.round((startOf(ms) - startOf(now)) / 86400000);
    if (days === 0 || days === -1) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      return `${rtf.format(days, 'day')} ${time}`;
    }
    const sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleString(locale, {
      year: sameYear ? undefined : 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d.toLocaleString();
  }
}

export async function getStoredUiLang() {
  try {
    const { uiLang } = await chrome.storage.local.get('uiLang');
    return uiLang || null;
  } catch {
    return null;
  }
}

export async function setStoredUiLang(code) {
  await chrome.storage.local.set({ uiLang: code });
}
