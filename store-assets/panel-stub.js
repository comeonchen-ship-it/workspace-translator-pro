// Store screenshots only (not shipped). Runs the real side panel (popup.html)
// with a fake chrome.* and puts it into the state named by ?state=…
(function () {
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || 'main';
  const ui = params.get('ui') || 'en';
  const store = {
    uiLang: ui, translationEngine: 'gemini', apiKey: 'AQ.Ab8RN6JKgdqSM1fl1Z8aEaRArL', apiKeyStatus: 'active',
    modelName: 'gemini-3.1-flash-lite', setupSkipped: true, lastSelectedLang: 'ja',
    translationPrefs: {
      tone: 'keep', names: { people: 'keep', brands: 'annotate', places: 'translate' },
      terms: [{ src: 'Roadmap', mode: 'translate', dst: 'ロードマップ' }, { src: 'Acme Cloud', mode: 'keep', dst: '' }],
      custom: 'Audience: Japanese enterprise customers. Keep sentences short.',
    },
  };
  if (state === 'setup') { delete store.apiKey; store.setupSkipped = false; }
  const get = (keys, cb) => {
    const out = {};
    const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    for (const k of list) if (k in store) out[k] = store[k];
    if (cb) setTimeout(() => cb(out)); return Promise.resolve(out);
  };
  const ev = { addListener() {} };
  window.chrome = {
    storage: { local: { get, set: (o, cb) => { Object.assign(store, o); cb && cb(); return Promise.resolve(); }, remove: (k, cb) => { cb && cb(); return Promise.resolve(); } }, onChanged: ev },
    runtime: { getManifest: () => ({ version: '1.6.0' }), getURL: (p) => '/' + p, connect: () => ({ postMessage() {}, onMessage: ev, onDisconnect: ev }), onMessage: ev, sendMessage: () => Promise.resolve(), lastError: null },
    tabs: { query: (q, cb) => setTimeout(() => cb([{ id: 1, url: 'https://docs.google.com/presentation/d/demo/edit', title: 'Q3 Product Roadmap - Google Slides' }])), onActivated: ev, onUpdated: ev, create() {}, get: () => Promise.resolve({ url: '' }) },
    permissions: { request: () => Promise.resolve(true), contains: () => Promise.resolve(true) },
    windows: { onFocusChanged: ev, WINDOW_ID_NONE: -1 },
    i18n: { getUILanguage: () => ui },
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const finish = () => document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) {} });

  async function apply() {
    await wait(700);
    if (state === 'main' || state === 'done') {
      $('#extra-langs-box').open = true;
      for (const code of ['ko', 'zh-TW']) document.querySelector(`.lang-chip[data-code="${code}"]`)?.click();
      $('#slide-range').value = '1-12';
    }
    if (state === 'done') {
      $('#extra-langs-box').open = false;
      const card = $('#completion-card');
      card.classList.remove('hidden');
      $('#completion-stats').textContent = '128 text segments · 2 min 14 s · GEMINI · gemini-3.1-flash-lite · 6 text boxes shrunk to fit';
      const ul = $('#completion-results'); ul.innerHTML = '';
      for (const name of ['日本語', '한국어', '繁體中文']) {
        const li = document.createElement('li'); const a = document.createElement('a'); a.textContent = '↗ ' + name; li.append(a); ul.append(li);
      }
      $('#btn-open-result').hidden = true;
    }
    if (state === 'progress') {
      $('#main-panel').classList.add('is-busy');
      $('#progress-section').style.display = 'flex';
      $('#progress-status').textContent = 'Translating… batch 7/11, about 1 min left';
      $('#progress-pct').textContent = '73%';
      $('#progress-bar-fill').style.width = '73%';
      $('#step-copy').className = 'success'; $('#step-extract').className = 'success'; $('#step-api').className = 'active';
      $('#btn-cancel-translation').style.display = 'flex';
      $('#log-console-wrapper').style.display = 'none';
    }
    if (state === 'prefs') {
      $('#settings-panel').classList.add('active');
      finish();
      await wait(100);
      document.querySelector('#prefs-card').scrollIntoView({ block: 'start' });
      document.querySelector('#settings-panel .settings-scroll-container').scrollTop += 40;
    }
    if (state === 'setup') {
      $('#setup-panel').classList.add('active');
      const key = $('#setup-key'); key.value = 'AQ.Ab8RN6JKgdqSM1fl1Z8aEaRArL';
      const res = $('#setup-result'); res.className = 'test-result-msg result-active';
      res.textContent = '✅ Key works and is saved. You\'re ready to translate!';
      $('#btn-setup-done').disabled = false;
      // Show all three steps, not the comparison box.
      const sc = document.querySelector('#setup-panel .settings-scroll-container');
      sc.scrollTop = sc.scrollHeight;
    }
    finish();
    document.documentElement.dataset.ready = '1';
  }
  document.addEventListener('DOMContentLoaded', () => { apply(); });
})();
