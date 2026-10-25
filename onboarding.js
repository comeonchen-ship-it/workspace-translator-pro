// User guide page. Renders every [data-i18n-guide] element through the shared i18n layer
// (same locale files as the side panel) and fills {placeholders} with the
// panel's own UI labels, so the button names the guide quotes are always exact.
import { TARGET_LANGUAGES, UI_LANGUAGES, uiLabel, resolveUiLang } from './i18n/languages.js';
import { loadLocale, t, getStoredUiLang, setStoredUiLang } from './i18n/i18n.js';

// Placeholder → side-panel message key. Values are rendered as highlighted UI labels.
const UI_LABELS = {
  quickSetup: 'setup.title',
  openStudio: 'setup.step1.btn',
  start: 'setup.start',
  useFree: 'setup.useFree',
  target: 'main.targetLangLabel',
  multi: 'multi.summary',
  slides: 'scope.slides.label',
  sheet: 'scope.sheet.currentOnly',
  fileTerms: 'prefs.docGlossary.summary',
  translate: 'main.btnTranslate',
  stop: 'main.btnStop',
  done: 'done.title',
  after: 'settings.section.result',
  history: 'history.title',
  fit: 'settings.fitText',
  section: 'settings.section.prefs',
  save: 'settings.btnSave',
  tone: 'prefs.tone.label',
  toneKeep: 'prefs.tone.keep',
  names: 'prefs.names.label',
  mTranslate: 'prefs.mode.translate',
  mKeep: 'prefs.mode.keep',
  mAnnotate: 'prefs.mode.annotate',
  terms: 'prefs.terms.label',
  termTranslate: 'prefs.terms.mode.translate',
  termKeep: 'prefs.terms.mode.keep',
  custom: 'prefs.custom.label',
  preview: 'prefs.preview.title',
  engine: 'settings.section.engine',
  test: 'settings.testConnection',
  active: 'settings.status.active',
  customUrl: 'settings.customUrl.label',
  model: 'settings.modelName.label',
  uiLang: 'settings.section.uiLanguage',
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function uiLabelParams() {
  const params = {};
  for (const [name, key] of Object.entries(UI_LABELS)) {
    params[name] = `<b class="ui-label">${escapeHtml(t(key))}</b>`;
  }
  return params;
}

function render() {
  const params = uiLabelParams();
  for (const el of document.querySelectorAll('[data-i18n-guide]')) {
    // Guide strings are our own (locale files); only the UI labels are inserted,
    // and those are escaped above.
    const html = escapeHtml(t(el.dataset.i18nGuide)).replace(/\{(\w+)\}/g, (m, name) => params[name] ?? m);
    if (el.tagName === 'TITLE') document.title = t(el.dataset.i18nGuide);
    else el.innerHTML = html;
  }

  const list = document.getElementById('lang-list');
  list.innerHTML = '';
  for (const lang of TARGET_LANGUAGES) {
    const li = document.createElement('li');
    const native = document.createElement('b');
    native.textContent = lang.endonym;
    li.append(native);
    if (lang.english !== lang.endonym) {
      const en = document.createElement('span');
      en.textContent = lang.english;
      li.append(en);
    }
    list.appendChild(li);
  }
}

function highlightToc() {
  const links = [...document.querySelectorAll('#toc a')];
  const current = [...document.querySelectorAll('main section')]
    .filter((s) => s.getBoundingClientRect().top < window.innerHeight * 0.35)
    .pop();
  for (const a of links) a.classList.toggle('active', current && a.getAttribute('href') === `#${current.id}`);
}

document.addEventListener('DOMContentLoaded', async () => {
  const code = resolveUiLang(await getStoredUiLang(), navigator.language);
  await loadLocale(code);

  const version = chrome?.runtime?.getManifest?.().version;
  if (version) document.getElementById('guide-version').textContent = `v${version}`;

  const picker = document.getElementById('guide-lang');
  for (const lang of UI_LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = uiLabel(lang);
    picker.appendChild(opt);
  }
  picker.value = code;
  // Same setting as the side panel: switching here switches both.
  picker.addEventListener('change', async () => {
    await setStoredUiLang(picker.value);
    await loadLocale(picker.value);
    render();
  });

  render();
  highlightToc();
  window.addEventListener('scroll', highlightToc, { passive: true });

  document.getElementById('btn-done').addEventListener('click', () => window.close());

  // Opened from the "what's new" badge: mark this version as seen.
  if (location.hash === '#changelog' && version) {
    chrome.storage?.local?.set({ whatsNewSeen: version });
  }
});
