// Demo mode for the side panel (popup.html?demo=<state>&ui=<lang>&hl=1).
// Used by the user guide (live, localized illustrations) and by the store-image
// build. Does nothing unless ?demo= is present, so the real side panel is
// unaffected. Classic script: must run before popup.js reads `chrome`.
//
// The panel runs its normal code against a sample, in-memory chrome.* — this
// stub plays the background service (progress/completion messages) and answers
// the API-key test like Gemini would, so every text is rendered by the panel
// itself in the requested language. Nothing is read from or written to the
// user's real settings. Classic script: must run before the panel's modules.
(function () {
  const params = new URLSearchParams(location.search);
  const state = params.get('demo');
  if (!state) return;
  const ui = params.get('ui') || 'en';
  const highlight = params.get('hl') === '1';
  // Optional: which file the panel is looking at, and the chosen target language.
  const fileType = params.get('type') || 'presentation';
  const fileTitle = params.get('title') || 'Q3 Product Roadmap';
  const TYPE_URL = { presentation: 'presentation', document: 'document', spreadsheet: 'spreadsheets', form: 'forms' };
  const TYPE_SUFFIX = { presentation: 'Google Slides', document: 'Google Docs', spreadsheet: 'Google Sheets', form: 'Google Forms' };

  // Version shown in the panel header: read from the real manifest.
  let realManifest = { version: '' };
  try { const x = new XMLHttpRequest(); x.open('GET', new URL('manifest.json', location.href).href, false); x.send(); realManifest = JSON.parse(x.responseText); } catch (_) { /* keep blank */ }

  const store = {
    uiLang: ui, translationEngine: 'gemini', apiKey: 'AQ.Ab8RN6JKgdqSM1fl1Z8aEaRArL', apiKeyStatus: 'active',
    modelName: 'gemini-3.1-flash-lite', setupSkipped: true, lastSelectedLang: params.get('lang') || (ui === 'ja' ? 'en' : 'ja'),
    autoOpenResult: true, fitTextToBoxes: true,
    translationPrefs: {
      tone: params.get('tone') || 'keep',
      names: JSON.parse(params.get('names') || 'null') || { people: 'keep', brands: 'annotate', places: 'translate' },
      terms: JSON.parse(params.get('terms') || 'null') || [{ src: 'Roadmap', mode: 'translate', dst: 'ロードマップ' }, { src: 'Acme Cloud', mode: 'keep', dst: '' }],
      custom: '',
    },
  };
  if (state === 'setup' || state === 'setup-done') { delete store.apiKey; store.apiKeyStatus = 'unverified'; store.setupSkipped = false; }

  const pick = (keys) => {
    const out = {};
    const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
    return out;
  };
  const reply = (value, cb) => { if (cb) { setTimeout(() => cb(value)); return undefined; } return Promise.resolve(value); };
  const ev = { addListener() {} };

  // The sample "background service": answers registerView with this demo's state.
  let panelListener = null;
  const send = (msg) => setTimeout(() => panelListener && panelListener({ type: 'translationProgress', ...msg }), 0);
  const port = {
    postMessage(msg) {
      if (msg.action !== 'registerView') return;
      if (state === 'progress') {
        send({ step: 'translate', pct: 73, status: { key: 'progress.batchesEtaMin', params: { done: 7, total: 11, m: 1 } } });
      }
      if (state === 'done') {
        send({ step: 'done', pct: 100, status: { key: 'progress.complete' }, finalUrl: '#',
          summary: { segments: 128, durationMs: 134000, engine: 'gemini', model: 'gemini-3.1-flash-lite', overflowFixed: 6,
            // A single requested language shows a single result; otherwise a multi-language sample.
            ...(params.get('lang') ? {} : { results: [{ lang: 'ja', url: '#' }, { lang: 'ko', url: '#' }, { lang: 'zh-TW', url: '#' }] }) } });
      }
    },
    onMessage: { addListener: (fn) => { panelListener = fn; } },
    onDisconnect: ev,
  };

  const stub = {
    storage: { local: {
      get: (keys, cb) => reply(pick(keys), cb),
      set: (obj, cb) => { Object.assign(store, structuredClone(obj)); return reply(undefined, cb); },
      remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; return reply(undefined, cb); },
    }, onChanged: ev },
    runtime: {
      getManifest: () => realManifest, getURL: (p) => new URL(p, location.href).href,
      connect: () => port, onMessage: ev, sendMessage: () => Promise.resolve(), lastError: null,
    },
    tabs: {
      query: (q, cb) => setTimeout(() => cb([{ id: 1, url: `https://docs.google.com/${TYPE_URL[fileType] || 'presentation'}/d/demo/edit`, title: `${fileTitle} - ${TYPE_SUFFIX[fileType] || 'Google Slides'}` }])),
      onActivated: ev, onUpdated: ev, create() {}, get: () => Promise.resolve({ url: '' }),
    },
    permissions: { request: () => Promise.resolve(true), contains: () => Promise.resolve(true) },
    scripting: { executeScript: () => Promise.resolve([{ result: null }]) },
    windows: { onFocusChanged: ev, WINDOW_ID_NONE: -1 },
    i18n: { getUILanguage: () => ui },
  };
  // popup.js / i18n.js / languages.js read `globalThis.__demoChrome ?? chrome`, so the
  // panel uses this sample API without touching the real extension APIs.
  window.__demoChrome = stub;

  // The key test in Quick setup succeeds without any network call.
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => (String(url).includes('generativelanguage.googleapis.com')
    ? Promise.resolve(new Response('{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}', { status: 200 }))
    : realFetch(url, opts));

  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const finish = () => document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) {} });
  const mark = (sel) => { if (highlight) $(sel)?.classList.add('demo-highlight'); };
  // Optional explicit outlines (?marks=lang,range,…) — used by the store photos.
  const MARKS = {
    job: '#job-options', lang: '#select-lang', range: '#scope-slides', sheet: '#scope-sheet', translate: '#btn-translate',
    names: '.name-modes', terms: '#terms-global', tone: '#tone-seg', done: '#completion-card', result: '#fit-text',
    concise: '#scope-concise', length: '.pref-length',
  };
  const explicitMarks = (params.get('marks') || '').split(',').filter((k) => MARKS[k]);

  async function apply() {
    document.documentElement.classList.add('demo-mode');
    await wait(600); // let popup.js load the locale and render
    if (state === 'main') {
      if (params.has('range')) {
        $('#slide-range').value = params.get('range');
      } else {
        $('#extra-langs-box').open = true;
        for (const code of ['ko', 'zh-TW']) document.querySelector(`.lang-chip[data-code="${code}"]`)?.click();
        $('#slide-range').value = '1-12';
      }
      mark('#btn-translate');
    }
    if (params.get('concise') === '1') { const box = $('#job-concise'); if (box) box.checked = true; }
    if (params.get('sheetOnly') === '1') { const box = $('#sheet-current-only'); if (box) box.checked = true; }
    if (state === 'setup') mark('#btn-setup-getkey');
    if (state === 'setup-done') {
      const key = $('#setup-key');
      key.value = 'AQ.Ab8RN6JKgdqSM1fl1Z8aEaRArL';
      key.dispatchEvent(new Event('input'));
      await wait(300);
      const sc = document.querySelector('#setup-panel .settings-scroll-container');
      sc.scrollTop = sc.scrollHeight;
      mark('#btn-setup-done');
    }
    if (state === 'progress') { const logs = $('#log-console-wrapper'); if (logs) logs.style.display = 'none'; }
    if (state === 'done') mark('#completion-card');
    if (state === 'prefs' || state === 'engine') {
      $('#settings-panel').classList.add('active');
      finish();
      await wait(100);
      if (state === 'prefs') {
        // Scroll only the settings list. scrollIntoView() would also scroll the
        // page that embeds this panel (the user guide).
        const sc = document.querySelector('#settings-panel .settings-scroll-container');
        const scrollTo = params.get('scroll');
        const target = scrollTo === 'terms' ? document.querySelector('#terms-global').parentElement
          : scrollTo === 'names' ? document.querySelector('.name-modes').closest('.pref-section')
          : scrollTo === 'result' ? document.querySelector('#fit-text').closest('.setting-group-card')
          : document.querySelector('#prefs-card');
        sc.scrollTop += target.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
        mark('.name-modes');
      } else {
        mark('#btn-test-api');
      }
    }
    for (const key of explicitMarks) {
      const el = $(MARKS[key]);
      // a checkbox mark spotlights its whole settings card
      (key === 'result' ? el?.closest('.setting-group-card') : el)?.classList.add('demo-highlight');
    }
    finish();
    document.documentElement.dataset.demoReady = '1';
  }
  document.addEventListener('DOMContentLoaded', apply);
})();
