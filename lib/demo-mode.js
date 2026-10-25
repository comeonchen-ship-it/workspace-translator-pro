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

  const store = {
    uiLang: ui, translationEngine: 'gemini', apiKey: 'AQ.Ab8RN6JKgdqSM1fl1Z8aEaRArL', apiKeyStatus: 'active',
    modelName: 'gemini-3.1-flash-lite', setupSkipped: true, lastSelectedLang: ui === 'ja' ? 'en' : 'ja',
    autoOpenResult: true, fitTextToBoxes: true,
    translationPrefs: {
      tone: 'keep', names: { people: 'keep', brands: 'annotate', places: 'translate' },
      terms: [{ src: 'Roadmap', mode: 'translate', dst: 'ロードマップ' }, { src: 'Acme Cloud', mode: 'keep', dst: '' }],
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
            results: [{ lang: 'ja', url: '#' }, { lang: 'ko', url: '#' }, { lang: 'zh-TW', url: '#' }] } });
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
      getManifest: () => ({ version: '1.6.0' }), getURL: (p) => new URL(p, location.href).href,
      connect: () => port, onMessage: ev, sendMessage: () => Promise.resolve(), lastError: null,
    },
    tabs: {
      query: (q, cb) => setTimeout(() => cb([{ id: 1, url: 'https://docs.google.com/presentation/d/demo/edit', title: 'Q3 Product Roadmap - Google Slides' }])),
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

  async function apply() {
    document.documentElement.classList.add('demo-mode');
    await wait(600); // let popup.js load the locale and render
    if (state === 'main') {
      $('#extra-langs-box').open = true;
      for (const code of ['ko', 'zh-TW']) document.querySelector(`.lang-chip[data-code="${code}"]`)?.click();
      $('#slide-range').value = '1-12';
      mark('#btn-translate');
    }
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
        const card = document.querySelector('#prefs-card');
        sc.scrollTop += card.getBoundingClientRect().top - sc.getBoundingClientRect().top;
        mark('.name-modes');
      } else {
        mark('#btn-test-api');
      }
    }
    finish();
    document.documentElement.dataset.demoReady = '1';
  }
  document.addEventListener('DOMContentLoaded', apply);
})();
