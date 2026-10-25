import { TARGET_LANGUAGES, UI_LANGUAGES, targetLabel, uiLabel, resolveUiLang } from './i18n/languages.js';
import {
  loadLocale, t, tStatus, applyI18n, formatDateTime,
  getStoredUiLang, setStoredUiLang,
} from './i18n/i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
  // i18n must be ready before anything renders, otherwise the user sees a flash of
  // English. Everything below this point may call t().
  const uiLang = resolveUiLang(await getStoredUiLang());
  await loadLocale(uiLang);
  applyI18n();

  // Populate version badge from manifest
  const appVersionEl = document.getElementById('app-version');
  if (appVersionEl) {
    const { version } = chrome.runtime.getManifest();
    appVersionEl.textContent = `v${version}`;
  }

  // UI Elements
  const warningPanel = document.getElementById('warning-panel');
  const mainPanel = document.getElementById('main-panel');
  const settingsPanel = document.getElementById('settings-panel');
  
  const slideTitleEl = document.getElementById('slide-title');
  const selectLang = document.getElementById('select-lang');
  const btnTranslate = document.getElementById('btn-translate');
  
  const btnSettings = document.getElementById('btn-settings');
  const btnHelp = document.getElementById('btn-help');
  const btnHistory = document.getElementById('btn-history');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnCancelSettings = document.getElementById('btn-cancel-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  
  // History Elements
  const historyPanel = document.getElementById('history-panel');
  const btnCloseHistory = document.getElementById('btn-close-history');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const historyScrollContainer = document.getElementById('history-scroll-container');
  
  // Settings Form Elements
  const selectEngine = document.getElementById('select-engine');
  const inputApiKey = document.getElementById('api-key');
  const inputModelName = document.getElementById('model-name');
  const inputCustomUrl = document.getElementById('custom-url');
  const groupCustomUrl = document.getElementById('group-custom-url');
  const groupApiKey = document.getElementById('group-api-key');
  const groupModelName = document.getElementById('group-model-name');
  const groupQuotaTip = document.getElementById('group-quota-tip');
  
  const btnToggleApiKey = document.getElementById('btn-toggle-api-key');
  const apiKeyIndicator = document.getElementById('api-key-indicator');
  
  // Progress Elements
  const progressSection = document.getElementById('progress-section');
  const progressStatus = document.getElementById('progress-status');
  const progressPct = document.getElementById('progress-pct');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const btnCancelTranslation = document.getElementById('btn-cancel-translation');
  
  const stepCopy = document.getElementById('step-copy');
  const stepExtract = document.getElementById('step-extract');
  const stepApi = document.getElementById('step-api');
  const stepWrite = document.getElementById('step-write');

  let currentPresentationId = null;
  let currentPresentationTitle = "";
  let currentFileType = "presentation";
  let currentTabId = null;
  
  // Define default models
  const DEFAULT_MODELS = {
    gemini: 'gemini-3.1-flash-lite',
    openai: 'gpt-5.4-mini',
    claude: 'claude-haiku-4-5-20251001',
    custom: '',
    free: ''
  };

  // ── Language pickers ──────────────────────────────────────────────────────
  // Both lists come from i18n/languages.js. Adding a language must never require
  // touching this file — see docs/06 §10.9.
  const selectUiLang = document.getElementById('select-ui-lang');

  function populateLanguagePickers() {
    selectLang.innerHTML = '';
    for (const lang of TARGET_LANGUAGES) {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = targetLabel(lang);
      selectLang.appendChild(opt);
    }
    if (selectUiLang) {
      selectUiLang.innerHTML = '';
      for (const lang of UI_LANGUAGES) {
        const opt = document.createElement('option');
        opt.value = lang.code;
        // Endonym only, deliberately never localised, so a user who picked a
        // script they can't read can still find their way back.
        opt.textContent = uiLabel(lang);
        selectUiLang.appendChild(opt);
      }
      selectUiLang.value = uiLang;
    }
  }
  populateLanguagePickers();

  /**
   * Re-render every string that JS writes at runtime. applyI18n() only covers
   * elements carrying data-i18n, so anything set via textContent must be redone
   * here or the UI ends up half in the old language.
   */
  function refreshDynamicTexts() {
    applyI18n();
    refreshFileTypeTexts();
    chrome.storage.local.get('apiKeyStatus', (items) => {
      updateStatusBadge(items.apiKeyStatus || 'unverified');
    });
    validateApiKey();
    loadHistory();
  }

  /**
   * The two strings that depend on the detected file type. Kept separate because
   * `steps.copy` carries a {fileType} param that applyI18n() cannot fill, and
   * because applyI18n() would otherwise reset the meta label to "Active Presentation".
   * Must run AFTER applyI18n().
   */
  function refreshFileTypeTexts() {
    const type = currentFileType || 'presentation';
    const metaLabelEl = document.getElementById('meta-label');
    if (metaLabelEl && currentPresentationId) {
      metaLabelEl.textContent = t(`main.metaLabel.${type}`);
    }
    const stepCopyEl = document.querySelector('#step-copy span:not(.step-bullet)');
    if (stepCopyEl) {
      stepCopyEl.textContent = t('steps.copy', { fileType: t(`fileType.${type}`) });
    }
  }

  if (selectUiLang) {
    selectUiLang.addEventListener('change', async (e) => {
      const code = e.target.value;
      await setStoredUiLang(code);
      await loadLocale(code);
      refreshDynamicTexts();
    });
  }

  // 1. Check storage for existing settings
  chrome.storage.local.get([
    'translationEngine',
    'apiKey',
    'modelName',
    'customUrl',
    'apiKeyStatus'
  ], (items) => {
    selectEngine.value = items.translationEngine || 'gemini';
    inputApiKey.value = items.apiKey || '';
    inputModelName.value = items.modelName || DEFAULT_MODELS.gemini;
    inputCustomUrl.value = items.customUrl || '';
    
    toggleEngineFields(selectEngine.value);
    updateStatusBadge(items.apiKeyStatus || 'unverified');
    
    // Meticulous User Experience: Run initial checks on loaded values
    setTimeout(() => {
      validateApiKey();
    }, 100);
  });

  // Toggle visible fields based on engine
  function toggleEngineFields(engine) {
    const groupTestApi = document.getElementById('group-test-api');
    if (engine === 'free') {
      groupApiKey.classList.add('hidden');
      groupModelName.classList.add('hidden');
      groupCustomUrl.classList.add('hidden');
      if (groupQuotaTip) groupQuotaTip.classList.add('hidden');
      if (groupTestApi) groupTestApi.classList.add('hidden');
    } else if (engine === 'custom') {
      groupApiKey.classList.remove('hidden');
      groupModelName.classList.remove('hidden');
      groupCustomUrl.classList.remove('hidden');
      if (groupQuotaTip) groupQuotaTip.classList.remove('hidden');
      if (groupTestApi) groupTestApi.classList.remove('hidden');
      if (!inputModelName.value || Object.values(DEFAULT_MODELS).includes(inputModelName.value)) {
        inputModelName.value = '';
      }
    } else {
      groupApiKey.classList.remove('hidden');
      groupModelName.classList.remove('hidden');
      groupCustomUrl.classList.add('hidden');
      if (groupQuotaTip) groupQuotaTip.classList.remove('hidden');
      if (groupTestApi) groupTestApi.classList.remove('hidden');
      // If the model is empty or matches another engine's model, update it to the default
      if (!inputModelName.value || Object.values(DEFAULT_MODELS).includes(inputModelName.value)) {
        inputModelName.value = DEFAULT_MODELS[engine];
      }
    }
  }

  selectEngine.addEventListener('change', (e) => {
    toggleEngineFields(e.target.value);
  });

  // Meticulous User Experience: API Key Password Reveal / Mask Toggle
  if (btnToggleApiKey && inputApiKey) {
    btnToggleApiKey.addEventListener('click', () => {
      const type = inputApiKey.getAttribute('type') === 'password' ? 'text' : 'password';
      inputApiKey.setAttribute('type', type);
      if (type === 'text') {
        btnToggleApiKey.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        btnToggleApiKey.setAttribute('title', t('settings.apiKey.hide'));
      } else {
        btnToggleApiKey.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        btnToggleApiKey.setAttribute('title', t('settings.apiKey.show'));
      }
    });
  }

  // ── Status Badge ─────────────────────────────────────────────────────────
  function updateStatusBadge(status) {
    const dot = document.getElementById('api-status-dot');
    const text = document.getElementById('api-status-text');
    if (!dot || !text) return;
    dot.className = 'status-dot';
    if (status === 'active') {
      dot.classList.add('status-active');
      text.textContent = t('settings.status.active');
      text.style.color = 'var(--accent)';
    } else if (status === 'invalid') {
      dot.classList.add('status-invalid');
      text.textContent = t('settings.status.invalid');
      text.style.color = '#ff7675';
    } else {
      dot.classList.add('status-unverified');
      text.textContent = t('settings.status.unverified');
      text.style.color = 'var(--text-muted)';
    }
  }

  function resetApiStatus() {
    if (selectEngine.value === 'free') return;
    chrome.storage.local.set({ apiKeyStatus: 'unverified' });
    updateStatusBadge('unverified');
    const msg = document.getElementById('test-result-msg');
    if (msg) { msg.textContent = ''; msg.className = 'test-result-msg'; }
  }

  // Custom endpoints are not in host_permissions; each origin is granted on demand
  // (optional_host_permissions) so the default install needs no all-sites access.
  function customOriginPattern(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return `${u.protocol}//${u.host}/*`;
    } catch (_) { return null; }
  }

  function requestCustomOriginPermission(url) {
    const origin = customOriginPattern(url);
    if (!origin) return Promise.resolve(false);
    // Must run inside the click's user gesture — call before any other await.
    return chrome.permissions.request({ origins: [origin] }).catch(() => false);
  }

  function hasCustomOriginPermission(url) {
    const origin = customOriginPattern(url);
    if (!origin) return Promise.resolve(false);
    return chrome.permissions.contains({ origins: [origin] }).catch(() => false);
  }

  // ── Real API Connection Test ──────────────────────────────────────────────
  async function testApiConnection(engine, apiKey, modelName, customUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      let resp;
      if (engine === 'gemini') {
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
          { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply ok.' }] }], generationConfig: { maxOutputTokens: 5 } }) }
        );
      } else if (engine === 'openai') {
        resp = await fetch('https://api.openai.com/v1/chat/completions',
          { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: 'Reply ok.' }], max_tokens: 5 }) }
        );
      } else if (engine === 'claude') {
        resp = await fetch('https://api.anthropic.com/v1/messages',
          { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: 'Reply ok.' }], max_tokens: 5 }) }
        );
      } else if (engine === 'custom') {
        const base = (customUrl || '').replace(/\/$/, '');
        resp = await fetch(`${base}/chat/completions`,
          { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: 'Reply ok.' }], max_tokens: 5 }) }
        );
      } else {
        return { success: null, message: t('settings.test.unsupportedEngine'), suggestion: '' };
      }
      clearTimeout(timer);

      // 429 = quota hit but key is valid ─ treat as success
      if (resp.ok || resp.status === 429) {
        const suffix = resp.status === 429 ? t('settings.test.successRateLimited') : '';
        return { success: true, message: t('settings.test.success', { suffix }), suggestion: '' };
      }

      let body = {};
      try { body = await resp.json(); } catch (_) {}
      const errMsg = body?.error?.message || body?.message || resp.statusText || `HTTP ${resp.status}`;
      const modelLinks = {
        gemini: 'https://ai.google.dev/gemini-api/docs/models',
        openai: 'https://platform.openai.com/docs/models',
        claude: 'https://docs.anthropic.com/claude/docs/models-overview',
        custom: t('settings.test.suggest.providerDocs')
      };

      if (resp.status === 401 || resp.status === 403) {
        return { success: false, message: t('settings.test.invalidKey', { error: errMsg }), suggestion: t(`settings.test.keyHint.${engine}`) };
      } else if (resp.status === 404) {
        return {
          success: false,
          message: t('settings.test.modelNotFound', { model: modelName }),
          suggestion: t('settings.test.suggest.modelDocs', { url: modelLinks[engine] || t('settings.test.suggest.providerDocs') })
        };
      } else if (resp.status === 400) {
        return { success: false, message: t('settings.test.badRequest', { error: errMsg }), suggestion: t('settings.test.suggest.badRequest') };
      } else if (resp.status === 402) {
        return { success: true, message: t('settings.test.billingIssue'), suggestion: t('settings.test.suggest.billing') };
      } else if (resp.status >= 500) {
        return { success: null, message: t('settings.test.serverError', { status: resp.status, error: errMsg }), suggestion: '' };
      }
      return { success: false, message: t('settings.test.genericError', { status: resp.status, error: errMsg }), suggestion: '' };

    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return { success: null, message: t('settings.test.timeout'), suggestion: '' };
      }
      return { success: null, message: t('settings.test.networkError', { error: err.message }), suggestion: t('settings.test.suggest.network') };
    }
  }

  // ── Pre-translation modal ─────────────────────────────────────────────────
  function showApiWarningModal(reason) {
    const modal = document.getElementById('api-warning-modal');
    const title = document.getElementById('modal-title');
    const msg = document.getElementById('modal-msg');
    if (!modal) return;
    const variant = reason === 'missing' ? 'apiKeyRequired'
      : reason === 'unverified' ? 'apiKeyUnverified'
      : 'apiKeyInvalid';
    title.textContent = t(`modal.${variant}.title`);
    msg.textContent = t(`modal.${variant}.msg`);
    modal.classList.remove('hidden');
  }

  // Meticulous User Experience: Real-time API Key validation
  function validateApiKey() {
    if (!apiKeyIndicator) return;
    const key = inputApiKey.value.trim();
    const engine = selectEngine.value;
    if (!key || engine === 'free') {
      apiKeyIndicator.className = 'val-indicator';
      apiKeyIndicator.textContent = '';
      return;
    }

    // Known key prefixes are only hints: providers change formats (e.g. Gemini AIzaSy… → AQ.…),
    // so an unrecognized shape is never treated as an error — the real connection test decides.
    const KNOWN_PREFIXES = {
      gemini: ['AIzaSy', 'AQ.'],
      openai: ['sk-'],
      claude: ['sk-ant-'],
    };
    let state;
    if (key.length < 10) state = 'bad';
    else if ((KNOWN_PREFIXES[engine] || []).some((p) => key.startsWith(p))) state = 'ok';
    else state = KNOWN_PREFIXES[engine] ? 'unknown' : 'ok';

    const group = KNOWN_PREFIXES[engine] ? engine : 'generic';
    apiKeyIndicator.className = `val-indicator ${{ ok: 'valid', bad: 'invalid', unknown: 'neutral' }[state]}`;
    apiKeyIndicator.textContent = state === 'unknown'
      ? t('settings.keyFormat.unknown')
      : t(`settings.keyFormat.${state === 'bad' ? 'generic' : group}.${state}`);
  }

  inputApiKey.addEventListener('input', () => { validateApiKey(); resetApiStatus(); });
  selectEngine.addEventListener('change', () => {
    setTimeout(validateApiKey, 50);
    resetApiStatus();
  });
  if (inputModelName) inputModelName.addEventListener('input', resetApiStatus);
  if (inputCustomUrl) inputCustomUrl.addEventListener('input', resetApiStatus);

  selectLang.addEventListener('change', (e) => {
    const langVal = e.target.value;
    console.log('[WorkspaceTranslator] Target language dropdown changed to:', langVal, 'for ID:', currentPresentationId);
    if (currentPresentationId) {
      const key = `targetLang_${currentPresentationId}`;
      chrome.storage.local.set({
        [key]: langVal,
        'lastSelectedLang': langVal
      });
    } else {
      chrome.storage.local.set({
        'lastSelectedLang': langVal
      });
    }
  });

  // 2. Settings views toggles
  btnSettings.addEventListener('click', () => {
    historyPanel.classList.remove('active'); // close history if open
    settingsPanel.classList.add('active');
    // Refresh status badge from storage in case it changed
    chrome.storage.local.get('apiKeyStatus', (items) => {
      updateStatusBadge(items.apiKeyStatus || 'unverified');
    });
    const testMsg = document.getElementById('test-result-msg');
    if (testMsg) { testMsg.textContent = ''; testMsg.className = 'test-result-msg'; }
  });

  const closeSettings = () => {
    settingsPanel.classList.remove('active');
  };

  btnCloseSettings.addEventListener('click', closeSettings);
  btnCancelSettings.addEventListener('click', closeSettings);

  btnSaveSettings.addEventListener('click', () => {
    const translationEngine = selectEngine.value;
    const apiKey = inputApiKey.value.trim();
    const modelName = inputModelName.value.trim();
    const customUrl = inputCustomUrl.value.trim();

    chrome.storage.local.set({
      translationEngine,
      apiKey,
      modelName,
      customUrl
    }, () => {
      chrome.runtime.sendMessage({ action: 'settingsUpdated' });
      closeSettings();
    });
  });

  // Open Help Guide
  btnHelp.addEventListener('click', () => {
    chrome.tabs.create({ url: 'onboarding.html' });
  });

  // ── Test Connection Button ────────────────────────────────────────────────
  const btnTestApi = document.getElementById('btn-test-api');
  const testResultMsg = document.getElementById('test-result-msg');
  if (btnTestApi) {
    btnTestApi.addEventListener('click', async () => {
      const engine = selectEngine.value;
      if (engine === 'free') return;
      const apiKey = inputApiKey.value.trim();
      const modelName = inputModelName.value.trim();
      const customUrl = inputCustomUrl.value.trim();
      // Ask for the custom origin first, while the click still counts as a user gesture.
      const customPermission = engine === 'custom' && customUrl
        ? requestCustomOriginPermission(customUrl) : null;
      if (!apiKey) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = t('settings.test.needKey');
        return;
      }
      if (!modelName) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = t('settings.test.needModel');
        return;
      }
      if (engine === 'custom' && !customUrl) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = t('settings.test.needUrl');
        return;
      }
      if (customPermission && !(await customPermission)) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = t('settings.test.permissionDenied');
        return;
      }
      // Show loading state. Swap only the label text and spin the existing icon, so
      // the button keeps its data-i18n span and survives a mid-test language switch.
      const testLabel = document.getElementById('btn-test-api-label');
      const testIcon = document.getElementById('btn-test-api-icon');
      btnTestApi.disabled = true;
      if (testLabel) testLabel.textContent = t('settings.testConnection.busy');
      if (testIcon) testIcon.classList.add('btn-icon-spin');
      testResultMsg.className = 'test-result-msg';
      testResultMsg.textContent = '';

      const result = await testApiConnection(engine, apiKey, modelName, customUrl);

      // Restore button
      btnTestApi.disabled = false;
      if (testLabel) testLabel.textContent = t('settings.testConnection');
      if (testIcon) testIcon.classList.remove('btn-icon-spin');

      // Determine new status
      let newStatus;
      if (result.success === true) {
        newStatus = 'active';
        testResultMsg.className = 'test-result-msg result-active';
      } else if (result.success === false) {
        newStatus = 'invalid';
        testResultMsg.className = 'test-result-msg result-invalid';
      } else {
        newStatus = 'unverified';
        testResultMsg.className = 'test-result-msg result-warning';
      }
      // API error text is untrusted — build with textContent, never innerHTML.
      testResultMsg.textContent = result.message;
      if (result.suggestion) {
        const sugg = document.createElement('span');
        sugg.className = 'test-suggestion';
        sugg.textContent = result.suggestion;
        testResultMsg.append(document.createElement('br'), sugg);
      }

      chrome.storage.local.set({ apiKeyStatus: newStatus });
      updateStatusBadge(newStatus);
    });
  }

  // ── Modal Button Handlers ─────────────────────────────────────────────────
  const apiWarningModal = document.getElementById('api-warning-modal');
  const modalGoSettings = document.getElementById('modal-go-settings');
  const modalDismiss = document.getElementById('modal-dismiss');
  if (modalGoSettings) {
    modalGoSettings.addEventListener('click', () => {
      if (apiWarningModal) apiWarningModal.classList.add('hidden');
      historyPanel.classList.remove('active');
      settingsPanel.classList.add('active');
      chrome.storage.local.get('apiKeyStatus', (items) => {
        updateStatusBadge(items.apiKeyStatus || 'unverified');
      });
    });
  }
  if (modalDismiss) {
    modalDismiss.addEventListener('click', () => {
      if (apiWarningModal) apiWarningModal.classList.add('hidden');
    });
  }

  // Establish port connection to background with auto-reconnect and ping keep-alive
  let port = null;
  let pingInterval = null;

  function connectToBackground() {
    try {
      port = chrome.runtime.connect({ name: 'translation-channel' });
      
      port.onMessage.addListener((message) => {
        handleProgress(message);
      });

      port.onDisconnect.addListener(() => {
        console.log('Port disconnected. Attempting to reconnect...');
        if (pingInterval) clearInterval(pingInterval);
        setTimeout(connectToBackground, 1000);
      });

      // Register current view immediately on connection
      if (currentPresentationId) {
        port.postMessage({
          action: 'registerView',
          presentationId: currentPresentationId
        });
      }

      // Keep service worker alive by pinging every 10 seconds
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        try {
          if (port) {
            port.postMessage({ action: 'ping' });
          }
        } catch (err) {
          console.warn('Failed to send keep-alive ping:', err);
          clearInterval(pingInterval);
        }
      }, 10000);

    } catch (err) {
      console.error('Failed to connect to background:', err);
      setTimeout(connectToBackground, 2000);
    }
  }

  connectToBackground();

  // Prevent tab-switch from overwriting the UI immediately after translation
  // completes (e.g. the newly opened translated file triggering a title change).
  let tabChangeLocked = false;

  // 3. Tab slide/document recognition and listeners
  function handleTabChange(tab) {
    if (!tab) return;
    currentTabId = tab.id;
    const url = tab.url || '';
    console.log('[WorkspaceTranslator] handleTabChange - Tab ID:', tab.id, 'URL:', url, 'Title:', tab.title);
    
    const slideMatch = url.match(/docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    const docMatch = url.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    const sheetMatch = url.match(/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    const formMatch = url.match(/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/);
    // Additional: Drive file viewer for Office files (xlsx, docx, pptx) opened directly from Google Drive
    // Supports standard URL: drive.google.com/file/d/{id}
    // Supports multi-account URL: drive.google.com/file/u/0/d/{id} (BUG FIX: added (?:u/\d+/)? )
    // Supports share link: drive.google.com/open?id={id}
    const driveFileMatch = url.match(/drive\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/|open\?id=)([a-zA-Z0-9_-]+)/);
    
    if (slideMatch || docMatch || sheetMatch || formMatch || driveFileMatch) {
      let isDoc = false;
      let isSheet = false;
      let isForm = false;
      let newPresentationId = "";
      let newFileType = "presentation";
      let fileTypeName = "Presentation";
      
      if (docMatch) {
        isDoc = true;
        newPresentationId = docMatch[1];
        newFileType = "document";
        fileTypeName = "Document";
      } else if (sheetMatch) {
        isSheet = true;
        newPresentationId = sheetMatch[1];
        newFileType = "spreadsheet";
        fileTypeName = "Spreadsheet";
      } else if (formMatch) {
        isForm = true;
        newPresentationId = formMatch[1];
        newFileType = "form";
        fileTypeName = "Form";
      } else if (driveFileMatch) {
        // Detect Office file type from tab title extension (.xlsx/.xls, .docx/.doc, .pptx/.ppt)
        const tabTitleForDetect = (tab.title || '').toLowerCase();
        newPresentationId = driveFileMatch[1];
        if (tabTitleForDetect.includes('.xlsx') || tabTitleForDetect.includes('.xls')) {
          isSheet = true;
          newFileType = "spreadsheet";
          fileTypeName = "Spreadsheet (Excel)";
        } else if (tabTitleForDetect.includes('.docx') || tabTitleForDetect.includes('.doc')) {
          isDoc = true;
          newFileType = "document";
          fileTypeName = "Document (Word)";
        } else if (tabTitleForDetect.includes('.pptx') || tabTitleForDetect.includes('.ppt')) {
          newFileType = "presentation";
          fileTypeName = "Presentation (PowerPoint)";
        } else {
          // Unknown Drive file type - show warning panel
          currentPresentationId = null;
          currentPresentationTitle = "";
          currentFileType = "presentation";
          document.body.className = '';
          warningPanel.style.display = 'flex';
          mainPanel.style.display = 'none';
          return;
        }
      } else {
        newPresentationId = slideMatch[1];
        newFileType = "presentation";
        fileTypeName = "Presentation";
      }
      
      const tabTitle = tab.title || '';
      const suffixes = [
        " - Google Docs", " - Google 文件",
        " - Google Slides", " - Google 簡報",
        " - Google Sheets", " - Google 試算表",
        " - Google Forms", " - Google 表單",
        ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt"  // Strip all Office file extensions from Drive viewer titles
      ];
      
      let cleanTitle = tabTitle;
      for (const suffix of suffixes) {
        cleanTitle = cleanTitle.replace(suffix, "");
      }

      // ── Second-layer guard ────────────────────────────────────────────────
      // Tier 1 – Specific phrases: safe to substring-match (these phrases
      //   will never appear as part of a real document title).
      const SUBSTRING_BAD_TITLES = [
        '管理員警告', 'Administrator Warning',
        '存取遭拒',   'Access denied', 'Access Denied',
        '未经验证',   'Unverified app',
      ];
      // Tier 2 – Short / common words: only block when the ENTIRE cleaned
      //   title equals one of these (e.g. the page title is literally "Error").
      //   This avoids blocking "Error Report", "Sign in Procedures", etc.
      const EXACT_BAD_TITLES = [
        '登入', 'Sign in', 'Sign In',
        'Error', '錯誤',
        'Loading…', 'Loading...', '載入中',
      ];
      if (
        SUBSTRING_BAD_TITLES.some(p => cleanTitle.includes(p)) ||
        EXACT_BAD_TITLES.some(p => cleanTitle.trim() === p)
      ) {
        console.log('[WorkspaceTranslator] Skipping bad page title:', cleanTitle);
        return;
      }
      // ─────────────────────────────────────────────────────────────────────


      const newPresentationTitle = cleanTitle || fileTypeName;
      
      // Apply body class for dynamic theme variables
      document.body.className = `theme-${newFileType}`;
      
      // Dynamically adjust step description text
      const stepCopyEl = document.querySelector('#step-copy span:not(.step-bullet)');
      if (stepCopyEl) {
        stepCopyEl.textContent = t('steps.copy', { fileType: t(`fileType.${newFileType}`) });
      }
      
      if (currentPresentationId !== newPresentationId || currentFileType !== newFileType) {
        currentPresentationId = newPresentationId;
        currentPresentationTitle = newPresentationTitle;
        currentFileType = newFileType;
        
        slideTitleEl.textContent = currentPresentationTitle;
        
        // Dynamically adjust icon and label
        const metaLabelEl = document.getElementById('meta-label');
        const slideIconEl = document.getElementById('slide-icon');
        
        if (isDoc) {
          if (metaLabelEl) metaLabelEl.textContent = t('main.metaLabel.document');
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(52, 152, 219, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
          }
        } else if (isSheet) {
          if (metaLabelEl) metaLabelEl.textContent = t('main.metaLabel.spreadsheet');
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(46, 204, 113, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;
          }
        } else if (isForm) {
          if (metaLabelEl) metaLabelEl.textContent = t('main.metaLabel.form');
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(155, 89, 182, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#9b59b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="8" x2="17" y2="8"></line><line x1="9" y1="13" x2="17" y2="13"></line><line x1="9" y1="18" x2="15" y2="18"></line><circle cx="6" cy="8" r="0.5" fill="currentColor"></circle><circle cx="6" cy="13" r="0.5" fill="currentColor"></circle><circle cx="6" cy="18" r="0.5" fill="currentColor"></circle></svg>`;
          }
        } else {
          if (metaLabelEl) metaLabelEl.textContent = t('main.metaLabel.presentation');
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(241, 196, 15, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>`;
          }
        }
        
        // Register this view with the background worker
        if (port) {
          try {
            port.postMessage({
              action: 'registerView',
              presentationId: currentPresentationId
            });
          } catch (err) {
            console.warn('Failed to send registerView message:', err);
          }
        }
        
        // Restore / Reset UI for this presentation
        resetUIForPresentation(currentPresentationId);
      }
      
      warningPanel.style.display = 'none';
      mainPanel.style.display = 'flex';
    } else {
      currentPresentationId = null;
      currentPresentationTitle = "";
      currentFileType = "presentation";
      document.body.className = ''; // Reset theme
      warningPanel.style.display = 'flex';
      mainPanel.style.display = 'none';
      if (logCheckInterval) {
        clearInterval(logCheckInterval);
        logCheckInterval = null;
      }
    }
  }

  function checkCurrentTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        handleTabChange(tabs[0]);
      }
    });
  }

  // Run initial tab check
  checkCurrentTab();

  // Monitor active tab switches, updates, and window focus changes
  chrome.tabs.onActivated.addListener((activeInfo) => {
    // User manually switched tabs — always unlock and respond immediately
    tabChangeLocked = false;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id === activeInfo.tabId) {
        handleTabChange(tabs[0]);
      }
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only respond if the updated tab is the active tab in the current window of the side panel
    // Also respect the post-translation lock (prevents bad auto-loaded titles like 管理員警告)
    if (tabChangeLocked) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id === tabId) {
        if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
          handleTabChange(tabs[0]);
        }
      }
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    chrome.windows.getCurrent((currentWindow) => {
      if (windowId === currentWindow.id) {
        checkCurrentTab();
      }
    });
  });

  // 4. Translate operation trigger
  let logCheckInterval = null;
  let lastProgressTime = 0;
  
  const logConsoleContent = document.getElementById('log-console-content');
  const btnToggleLogs = document.getElementById('btn-toggle-logs');

  btnToggleLogs.addEventListener('click', () => {
    const isHidden = logConsoleContent.classList.contains('hidden');
    if (isHidden) {
      logConsoleContent.classList.remove('hidden');
      btnToggleLogs.textContent = t('logs.hide');
    } else {
      logConsoleContent.classList.add('hidden');
      btnToggleLogs.textContent = t('logs.show');
    }
  });

  function updateLogDisplay(logs) {
    if (!logs || logs.length === 0) {
      logConsoleContent.textContent = t('logs.waiting');
      return;
    }
    logConsoleContent.textContent = logs.join('\n');
    logConsoleContent.scrollTop = logConsoleContent.scrollHeight;
  }

  function resetUIForPresentation(presentationId) {
    if (logCheckInterval) clearInterval(logCheckInterval);
    
    // Restore saved target language for this presentation/document
    const langKey = `targetLang_${presentationId}`;
    chrome.storage.local.get([langKey, 'lastSelectedLang'], (items) => {
      const savedLang = items[langKey] || items['lastSelectedLang'] || 'zh-TW';
      console.log('[WorkspaceTranslator] resetUIForPresentation - ID:', presentationId, 'savedLang:', savedLang, 'langKeyExists:', !!items[langKey]);
      selectLang.value = savedLang;
      // Pin this language for the specific document if not already explicitly saved
      if (!items[langKey]) {
        chrome.storage.local.set({ [langKey]: savedLang });
      }
    });

    // Reset back to idle state until a background task state is pushed
    btnTranslate.disabled = false;
    btnSettings.disabled = false;
    btnHelp.disabled = false;
    progressSection.style.display = 'none';
    
    resetProgress();
    
    logConsoleContent.textContent = t('logs.waiting');
    
    // Start periodic log polling for this specific presentation
    lastProgressTime = Date.now();
    logCheckInterval = setInterval(async () => {
      if (currentPresentationId !== presentationId) return;
      const key = `debugLogs_${presentationId}`;
      const data = await chrome.storage.local.get(key);
      const logs = data[key] || [];
      updateLogDisplay(logs);

      // If no progress update for 12 seconds, display warning
      if (Date.now() - lastProgressTime > 12000 && btnTranslate.disabled) {
        progressStatus.textContent = t('progress.slow');
        progressStatus.style.color = 'var(--text-warning)';
      }
    }, 1500);
  }

  btnTranslate.addEventListener('click', () => {
    if (!currentPresentationId) return;

    // Check storage configurations before running
    chrome.storage.local.get([
      'translationEngine',
      'apiKey',
      'modelName',
      'customUrl',
      'apiKeyStatus'
    ], (items) => {
      const translationEngine = items.translationEngine || 'gemini';
      const apiKey = items.apiKey;
      const apiKeyStatus = items.apiKeyStatus || 'unverified';

      if (translationEngine !== 'free' && !apiKey) {
        showApiWarningModal('missing');
        return;
      }
      if (translationEngine !== 'free' && apiKeyStatus !== 'active') {
        showApiWarningModal(apiKeyStatus);
        return;
      }
      if (translationEngine === 'custom') {
        // Upgrades from <=1.4 had all-sites access; re-run the test to grant this origin.
        hasCustomOriginPermission(items.customUrl).then((ok) => {
          if (!ok) {
            chrome.storage.local.set({ apiKeyStatus: 'unverified' });
            updateStatusBadge('unverified');
            showApiWarningModal('unverified');
          } else {
            startTranslation(items, translationEngine, apiKey);
          }
        });
        return;
      }
      startTranslation(items, translationEngine, apiKey);
    });
  });

  function startTranslation(items, translationEngine, apiKey) {
    // Start translation UI state
    btnTranslate.disabled = true;
    btnSettings.disabled = true;
    btnHelp.disabled = true;
    progressSection.style.display = 'flex';
    
    resetProgress();

    const key = `debugLogs_${currentPresentationId}`;
    chrome.storage.local.set({ [key]: [] }, () => {
      logConsoleContent.textContent = t('logs.initiating');
      lastProgressTime = Date.now();
      
      // Send start translation message to service worker
      if (port) {
        try {
          port.postMessage({
            action: 'startTranslation',
            presentationId: currentPresentationId,
            presentationTitle: currentPresentationTitle,
            fileType: currentFileType,
            targetLang: selectLang.value,
            tabId: currentTabId,
            config: {
              translationEngine,
              apiKey,
              modelName: items.modelName || DEFAULT_MODELS[translationEngine],
              customUrl: items.customUrl
            }
          });
        } catch (err) {
          console.error('Failed to post startTranslation message:', err);
          alert(t('alert.commFailed'));
        }
      } else {
        alert(t('alert.notConnected'));
        connectToBackground();
      }
    });
  }

  if (btnCancelTranslation) {
    btnCancelTranslation.addEventListener('click', () => {
      if (!currentPresentationId) return;
      btnCancelTranslation.disabled = true;
      // Label only — setting textContent on the button would drop the icon.
      const cancelLabel = document.getElementById('btn-cancel-label');
      if (cancelLabel) cancelLabel.textContent = t('main.btnStopping');
      if (port) {
        try {
          port.postMessage({
            action: 'cancelTranslation',
            presentationId: currentPresentationId
          });
        } catch (err) {
          console.error('Failed to send cancel message:', err);
        }
      }
    });
  }

  function resetProgress() {
    progressStatus.textContent = t('progress.connecting');
    progressStatus.style.color = 'var(--text-muted)';
    progressPct.textContent = '0%';
    progressBarFill.style.width = '0%';
    
    if (btnCancelTranslation) {
      btnCancelTranslation.disabled = false;
      // Must be 'flex', not 'block'. The .btn class centres its icon + label with
      // flexbox; forcing display:block here dropped that centring AND turned the
      // label <span> back into an inline box (transform no-ops on inline), which is
      // why the Stop button's icon looked misaligned only during a live run.
      btnCancelTranslation.style.display = 'flex';
      // Restore the LABEL only. Rebuilding innerHTML here used to wipe the
      // data-i18n span, which is why this button stayed English after a switch.
      const cancelLabel = document.getElementById('btn-cancel-label');
      if (cancelLabel) cancelLabel.textContent = t('main.btnStop');
    }

    stepCopy.className = 'pending';
    stepExtract.className = 'pending';
    stepApi.className = 'pending';
    stepWrite.className = 'pending';
  }

  // Maps a raw API error onto an actionable, localised message.
  // Matching stays on the English/technical markers the APIs actually return, so the
  // user's interface language never affects which branch is taken.
  function translateErrorToHuman(errorStr, engine) {
    if (!errorStr) return t('error.unknown');

    const err = errorStr.toString();

    // 429 Rate Limit / Quota Exceeded
    if (err.includes("429") || err.includes("RESOURCE_EXHAUSTED") || err.includes("quota")) {
      return engine === 'gemini'
        ? t('error.429.gemini')
        : t('error.429.generic', { engine: engine.toUpperCase() });
    }

    // 403 Forbidden / Invalid API Key / API Not Enabled
    if (err.includes("403") || err.includes("key not valid") || err.includes("API_KEY_INVALID") || err.includes("USER_LIMIT_EXCEEDED")) {
      return t('error.403');
    }

    // 400 Bad Request
    if (err.includes("400") || err.includes("INVALID_ARGUMENT") || err.includes("Invalid value")) {
      return t('error.400');
    }

    // Our own guard in translate.js: the model returned a different array length.
    if (err.includes("Translation mismatch")) {
      return t('error.mismatch');
    }

    // Our own guard in translate.js: the model did not return a JSON array.
    if (err.includes("invalid response format")) {
      return t('error.invalidFormat');
    }

    // Network Timeout
    if (err.includes("timed out") || err.includes("Timeout") || err.includes("Abort")) {
      return t('error.timeout');
    }

    // Browser or Extension Restart Interruption
    if (err.includes("interrupted") || err.includes("restart")) {
      return t('error.interrupted');
    }

    // User Stop / Cancellation
    if (err.includes("stopped by user") || err.includes("Stop")) {
      return t('error.stopped');
    }

    return t('error.generic', { error: errorStr.replace(/^Error:\s*/i, '') });
  }

  // Progress message handler
  function handleProgress(message) {
    if (message.type !== 'translationProgress') return;

    const { step, status, pct, error, finalUrl } = message;

    lastProgressTime = Date.now(); // Reset warning timer

    if (error) {
      if (logCheckInterval) clearInterval(logCheckInterval);
      
      // Ensure the progress section remains visible to show the error message
      progressSection.style.display = 'flex';
      
      const humanError = translateErrorToHuman(error, selectEngine.value);
      progressStatus.textContent = humanError;
      progressStatus.style.color = '#ff7675';
      progressStatus.style.whiteSpace = 'pre-line';
      
      // Reset progress bar displays to 0% to prevent stuck visual indicators
      progressPct.textContent = '0%';
      progressBarFill.style.width = '0%';
      
      btnTranslate.disabled = false;
      btnSettings.disabled = false;
      btnHelp.disabled = false;
      
      if (btnCancelTranslation) {
        btnCancelTranslation.style.display = 'none';
      }
      
      logConsoleContent.classList.remove('hidden');
      btnToggleLogs.textContent = t('logs.hide');
      
      if (step === 'copy') {
        stepCopy.className = 'active';
      } else if (step === 'extract') {
        stepCopy.className = 'success';
        stepExtract.className = 'active';
      } else if (step === 'translate') {
        stepCopy.className = 'success';
        stepExtract.className = 'success';
        stepApi.className = 'active';
      } else if (step === 'write') {
        stepCopy.className = 'success';
        stepExtract.className = 'success';
        stepApi.className = 'success';
        stepWrite.className = 'active';
      }
      return;
    }

    progressSection.style.display = 'flex';
    btnTranslate.disabled = true;
    btnSettings.disabled = true;
    btnHelp.disabled = true;

    progressStatus.style.color = 'var(--text-muted)';
    // status is {key, params} from the service worker; plain strings still work
    // so a taskState_ persisted by an older build keeps rendering.
    progressStatus.textContent = tStatus(status);
    progressPct.textContent = `${pct}%`;
    progressBarFill.style.width = `${pct}%`;

    // Process steps classes
    if (step === 'copy') {
      stepCopy.className = 'active';
    } else if (step === 'extract') {
      stepCopy.className = 'success';
      stepExtract.className = 'active';
    } else if (step === 'translate') {
      stepCopy.className = 'success';
      stepExtract.className = 'success';
      stepApi.className = 'active';
    } else if (step === 'write') {
      stepCopy.className = 'success';
      stepExtract.className = 'success';
      stepApi.className = 'success';
      stepWrite.className = 'active';
    } else if (step === 'done') {
      stepCopy.className = 'success';
      stepExtract.className = 'success';
      stepApi.className = 'success';
      stepWrite.className = 'success';
      
      if (btnCancelTranslation) {
        btnCancelTranslation.style.display = 'none';
      }
      
      progressStatus.textContent = t('progress.complete');
      progressStatus.style.color = 'var(--accent)';
      
      // final fetch of logs to show complete history for this presentation
      const key = `debugLogs_${currentPresentationId}`;
      chrome.storage.local.get(key, (data) => {
        updateLogDisplay(data[key] || []);
      });

      const completedId = currentPresentationId;

      // Lock tab-change detection for 15 seconds so the newly opened
      // translated file doesn't hijack the UI title display.
      tabChangeLocked = true;
      setTimeout(() => { tabChangeLocked = false; }, 15000);

      setTimeout(() => {
        if (currentPresentationId === completedId) {
          progressSection.style.display = 'none';
          btnTranslate.disabled = false;
          btnSettings.disabled = false;
          btnHelp.disabled = false;
        }
      }, 3000);
    }
  }

  // 5. Translation History functionality
  btnHistory.addEventListener('click', () => {
    settingsPanel.classList.remove('active'); // close settings if open
    historyPanel.classList.add('active');
    loadHistory();
    
    // Trigger background sync checker — no longer needs a client ID (bundled)
    chrome.runtime.sendMessage({ action: 'syncHistoryFiles' });
  });

  const closeHistory = () => {
    historyPanel.classList.remove('active');
  };

  btnCloseHistory.addEventListener('click', closeHistory);

  btnClearHistory.addEventListener('click', () => {
    if (confirm(t('history.confirmClear'))) {
      chrome.storage.local.set({ completedTranslations: [] }, () => {
        loadHistory();
      });
    }
  });

  function loadHistory() {
    chrome.storage.local.get(['completedTranslations'], (data) => {
      const list = data.completedTranslations || [];
      renderHistoryList(list);
    });
  }

  function renderHistoryList(list) {
    if (list.length === 0) {
      historyScrollContainer.innerHTML = `<div class="history-empty-state">${escapeHtml(t('history.empty'))}</div>`;
      return;
    }

    historyScrollContainer.innerHTML = '';
    list.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'history-item-card';

      let iconBg = 'rgba(241, 196, 15, 0.15)';
      let iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>`;

      if (item.fileType === 'document') {
        iconBg = 'rgba(52, 152, 219, 0.15)';
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
      } else if (item.fileType === 'spreadsheet') {
        iconBg = 'rgba(46, 204, 113, 0.15)';
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;
      } else if (item.fileType === 'form') {
        iconBg = 'rgba(155, 89, 182, 0.15)';
        iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#9b59b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="8" x2="17" y2="8"></line><line x1="9" y1="13" x2="17" y2="13"></line><line x1="9" y1="18" x2="15" y2="18"></line><circle cx="6" cy="8" r="0.5" fill="currentColor"></circle><circle cx="6" cy="13" r="0.5" fill="currentColor"></circle><circle cx="6" cy="18" r="0.5" fill="currentColor"></circle></svg>`;
      }

      // Formatted in the active UI locale, not the browser's.
      const dateStr = formatDateTime(item.timestamp);

      card.innerHTML = `
        <div class="history-item-info">
          <div class="history-item-icon" style="background: ${iconBg}">
            ${iconSvg}
          </div>
          <div class="history-item-meta">
            <div class="history-item-title" title="${escapeHtml(t('history.openTooltip'))}">${escapeHtml(item.originalTitle)}</div>
            <div class="history-item-date">${escapeHtml(dateStr)}</div>
          </div>
        </div>
        <div class="history-item-actions">
          <button class="history-del-btn" title="${escapeHtml(t('history.deleteTooltip'))}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      `;

      card.querySelector('.history-item-title').addEventListener('click', () => {
        chrome.tabs.create({ url: item.url });
      });

      card.querySelector('.history-del-btn').addEventListener('click', () => {
        deleteHistoryItem(item.presentationId);
      });

      historyScrollContainer.appendChild(card);
    });
  }

  function deleteHistoryItem(presentationId) {
    chrome.storage.local.get(['completedTranslations'], (data) => {
      const list = data.completedTranslations || [];
      const filtered = list.filter(item => item.presentationId !== presentationId);
      chrome.storage.local.set({ completedTranslations: filtered }, () => {
        loadHistory();
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // Load history initially when DOM is ready
  loadHistory();

  // Listen to background sync notifications
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'historyUpdated') {
      loadHistory();
    }
  });
});
