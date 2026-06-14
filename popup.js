document.addEventListener('DOMContentLoaded', () => {
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
        btnToggleApiKey.setAttribute('title', 'Hide API Key');
      } else {
        btnToggleApiKey.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        btnToggleApiKey.setAttribute('title', 'Show API Key');
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
      text.textContent = '生效 · Active';
      text.style.color = 'var(--accent)';
    } else if (status === 'invalid') {
      dot.classList.add('status-invalid');
      text.textContent = '失效 · Invalid';
      text.style.color = '#ff7675';
    } else {
      dot.classList.add('status-unverified');
      text.textContent = '未验证 · Unverified';
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

  // ── Real API Connection Test ──────────────────────────────────────────────
  async function testApiConnection(engine, apiKey, modelName, customUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      let resp;
      if (engine === 'gemini') {
        resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${apiKey}`,
          { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
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
        return { success: null, message: '⚠ Unsupported engine.', suggestion: '' };
      }
      clearTimeout(timer);

      // 429 = quota hit but key is valid ─ treat as success
      if (resp.ok || resp.status === 429) {
        const suffix = resp.status === 429 ? ' (Rate limit reached, but credentials are valid.)' : '';
        return { success: true, message: `✅ Connection successful! API key and model are working.${suffix}`, suggestion: '' };
      }

      let body = {};
      try { body = await resp.json(); } catch (_) {}
      const errMsg = body?.error?.message || body?.message || resp.statusText || `HTTP ${resp.status}`;
      const modelLinks = {
        gemini: 'https://ai.google.dev/gemini-api/docs/models',
        openai: 'https://platform.openai.com/docs/models',
        claude: 'https://docs.anthropic.com/claude/docs/models-overview',
        custom: 'your provider’s documentation'
      };
      const keyHints = {
        gemini: 'Get/check your key at aistudio.google.com → "Get API key". Keys start with AIzaSy...',
        openai: 'Get/check your key at platform.openai.com/api-keys. Keys start with sk-...',
        claude: 'Get/check your key at console.anthropic.com/api-keys. Keys start with sk-ant-...',
        custom: 'Verify the API key format required by your custom LLM provider.'
      };

      if (resp.status === 401 || resp.status === 403) {
        return { success: false, message: `❌ Invalid API key: ${errMsg}`, suggestion: keyHints[engine] || '' };
      } else if (resp.status === 404) {
        return { success: false, message: `❌ Model not found: "${modelName}"`, suggestion: `Verify model name at ${modelLinks[engine] || 'your provider docs'}.` };
      } else if (resp.status === 400) {
        return { success: false, message: `❌ Bad request: ${errMsg}`, suggestion: 'Double-check the API key and model name are correctly entered.' };
      } else if (resp.status === 402) {
        return { success: true, message: '✅ API key is valid (billing issue detected, but key itself works).', suggestion: 'Add credits to your account to use this API.' };
      } else if (resp.status >= 500) {
        return { success: null, message: `⚠ Server error (${resp.status}): ${errMsg}. The service may be temporarily unavailable. Try again later.`, suggestion: '' };
      }
      return { success: false, message: `❌ Error (${resp.status}): ${errMsg}`, suggestion: '' };

    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return { success: null, message: '⚠ Request timed out (15s). Check your internet connection.', suggestion: '' };
      }
      return { success: null, message: `⚠ Network error: ${err.message}`, suggestion: 'Check your internet connection or the custom endpoint URL.' };
    }
  }

  // ── Pre-translation modal ─────────────────────────────────────────────────
  function showApiWarningModal(reason) {
    const modal = document.getElementById('api-warning-modal');
    const title = document.getElementById('modal-title');
    const msg = document.getElementById('modal-msg');
    if (!modal) return;
    if (reason === 'missing' || reason === 'unverified') {
      title.textContent = reason === 'missing' ? 'API Key Required' : 'API Key Not Verified';
      msg.textContent = reason === 'missing'
        ? 'An API key is required for the selected translation provider. Please go to Settings, enter your API key, and click "Test Connection" to verify.'
        : 'Your API key has not been tested yet. Please go to Settings and click "Test Connection" to verify your credentials before translating.';
    } else {
      title.textContent = 'API Key Invalid';
      msg.textContent = 'Your API key is marked as invalid or the model name is incorrect. Please go to Settings, fix the issue, and run "Test Connection" again.';
    }
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

    if (engine === 'gemini') {
      if (key.startsWith('AIzaSy') && key.length >= 35) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = '✓ Gemini API Key format matches specifications';
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = '⚠ Format mismatch: Gemini keys typically start with AIzaSy';
      }
    } else if (engine === 'openai') {
      if ((key.startsWith('sk-') || key.startsWith('sk-proj-')) && key.length >= 20) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = '✓ OpenAI API Key format matches specifications';
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = '⚠ Format mismatch: OpenAI keys typically start with sk-';
      }
    } else if (engine === 'claude') {
      if (key.startsWith('sk-ant-') && key.length >= 25) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = '✓ Claude API Key format matches specifications';
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = '⚠ Format mismatch: Claude keys typically start with sk-ant-';
      }
    } else {
      if (key.length >= 10) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = '✓ API Key looks valid';
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = '⚠ API Key is extremely short';
      }
    }
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
    
    // Clean up highlights and error banners
    inputApiKey.classList.remove('validation-highlight');
    const btnTestApi = document.getElementById('btn-test-api');
    if (btnTestApi) btnTestApi.classList.remove('validation-highlight');
    const errorBanner = document.getElementById('settings-error-banner');
    if (errorBanner) errorBanner.remove();
    
    // Restore settings from storage
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
      
      setTimeout(() => {
        validateApiKey();
      }, 100);
    });
  };

  btnCloseSettings.addEventListener('click', closeSettings);
  btnCancelSettings.addEventListener('click', closeSettings);

  btnSaveSettings.addEventListener('click', () => {
    const translationEngine = selectEngine.value;
    const apiKey = inputApiKey.value.trim();
    const modelName = inputModelName.value.trim();
    const customUrl = inputCustomUrl.value.trim();

    if (translationEngine !== 'free') {
      const dot = document.getElementById('api-status-dot');
      const isVerified = dot && dot.classList.contains('status-active');
      const isFailed = dot && dot.classList.contains('status-invalid');
      
      if (!isVerified) {
        // Show dynamic warning banner fixed at the top of the settings panel (outside scroll container)
        const scrollContainer = document.querySelector('.settings-scroll-container');
        let errorBanner = document.getElementById('settings-error-banner');
        if (!errorBanner) {
          errorBanner = document.createElement('div');
          errorBanner.id = 'settings-error-banner';
          errorBanner.className = 'settings-error-banner';
          settingsPanel.insertBefore(errorBanner, scrollContainer);
        }
        
        if (isFailed) {
          errorBanner.innerHTML = `
            <strong>⚠️ API Key Verification Failed</strong>
            <span>您的 API 金鑰連線測試失敗。請確認輸入正確的金鑰與模型名稱，並重新測試。<br>Connection test failed for your API key. Please verify the key and model name, then test again.</span>
          `;
        } else {
          errorBanner.innerHTML = `
            <strong>⚠️ API Key Not Verified</strong>
            <span>請先點擊下方<strong>「Test Connection」</strong>按鈕以驗證您的 API 金鑰。未經驗證的金鑰無法儲存設定。<br>Please click the <strong>"Test Connection"</strong> button below to verify your API key before saving.</span>
          `;
        }
        
        // Highlight inputs and test button
        inputApiKey.classList.add('validation-highlight');
        const btnTestApi = document.getElementById('btn-test-api');
        if (btnTestApi) btnTestApi.classList.add('validation-highlight');
        
        // Scroll to group-test-api so user sees the failure message
        const groupTestApi = document.getElementById('group-test-api');
        if (groupTestApi) {
          groupTestApi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        // Focus input field without letting browser auto-scroll back to top
        inputApiKey.focus({ preventScroll: true });
        
        // Clear warnings when they start typing or click test
        const clearWarnings = () => {
          inputApiKey.classList.remove('validation-highlight');
          if (btnTestApi) btnTestApi.classList.remove('validation-highlight');
          const banner = document.getElementById('settings-error-banner');
          if (banner) banner.remove();
        };
        
        inputApiKey.removeEventListener('input', clearWarnings);
        inputApiKey.addEventListener('input', clearWarnings);
        
        if (btnTestApi) {
          btnTestApi.removeEventListener('click', clearWarnings);
          btnTestApi.addEventListener('click', clearWarnings);
        }
        
        return; // BLOCK SAVING
      }
    }

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
      if (!apiKey) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = '\u26a0\ufe0f Please enter your API key first.';
        return;
      }
      if (!modelName) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = '\u26a0\ufe0f Please enter a model name first.';
        return;
      }
      if (engine === 'custom' && !customUrl) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = '\u26a0\ufe0f Please enter a Base Endpoint URL first.';
        return;
      }
      // Show loading state
      btnTestApi.disabled = true;
      btnTestApi.innerHTML = '<svg class="btn-icon-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg> Testing...';
      testResultMsg.className = 'test-result-msg';
      testResultMsg.textContent = '';

      const result = await testApiConnection(engine, apiKey, modelName, customUrl);

      // Restore button
      btnTestApi.disabled = false;
      btnTestApi.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Test Connection';

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
      testResultMsg.innerHTML = result.message +
        (result.suggestion ? `<br><span class="test-suggestion">${result.suggestion}</span>` : '');

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
        stepCopyEl.textContent = `Duplicate original ${newFileType}`;
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
          if (metaLabelEl) metaLabelEl.textContent = "Active Document";
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(52, 152, 219, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
          }
        } else if (isSheet) {
          if (metaLabelEl) metaLabelEl.textContent = "Active Sheet";
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(46, 204, 113, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;
          }
        } else if (isForm) {
          if (metaLabelEl) metaLabelEl.textContent = "Active Form";
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(155, 89, 182, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#9b59b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="8" x2="17" y2="8"></line><line x1="9" y1="13" x2="17" y2="13"></line><line x1="9" y1="18" x2="15" y2="18"></line><circle cx="6" cy="8" r="0.5" fill="currentColor"></circle><circle cx="6" cy="13" r="0.5" fill="currentColor"></circle><circle cx="6" cy="18" r="0.5" fill="currentColor"></circle></svg>`;
          }
        } else {
          if (metaLabelEl) metaLabelEl.textContent = "Active Presentation";
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
      btnToggleLogs.textContent = 'Hide';
    } else {
      logConsoleContent.classList.add('hidden');
      btnToggleLogs.textContent = 'Show';
    }
  });

  function updateLogDisplay(logs) {
    if (!logs || logs.length === 0) {
      logConsoleContent.textContent = 'Waiting for logs...';
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
    
    logConsoleContent.textContent = 'Waiting for logs...';
    
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
        progressStatus.textContent = 'Taking longer than expected. Check connection/logs...';
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

      // Start translation UI state
      btnTranslate.disabled = true;
      btnSettings.disabled = true;
      btnHelp.disabled = true;
      progressSection.style.display = 'flex';
      
      resetProgress();

      const key = `debugLogs_${currentPresentationId}`;
      chrome.storage.local.set({ [key]: [] }, () => {
        logConsoleContent.textContent = 'Initiating connection...';
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
            alert('Communication with background worker failed. Please try again.');
          }
        } else {
          alert('Not connected to background service. Attempting to reconnect...');
          connectToBackground();
        }
      });
    });
  });

  if (btnCancelTranslation) {
    btnCancelTranslation.addEventListener('click', () => {
      if (!currentPresentationId) return;
      btnCancelTranslation.disabled = true;
      btnCancelTranslation.textContent = 'Stopping...';
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
    progressStatus.textContent = 'Connecting...';
    progressStatus.style.color = 'var(--text-muted)';
    progressPct.textContent = '0%';
    progressBarFill.style.width = '0%';
    
    if (btnCancelTranslation) {
      btnCancelTranslation.disabled = false;
      btnCancelTranslation.style.display = 'block';
      btnCancelTranslation.innerHTML = '<span>Stop Translation</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>';
    }

    stepCopy.className = 'pending';
    stepExtract.className = 'pending';
    stepApi.className = 'pending';
    stepWrite.className = 'pending';
  }

  // Helper to translate raw developer API error stacks into actionable human-friendly bilingual messages
  function translateErrorToHuman(errorStr, engine) {
    if (!errorStr) return "發生未知錯誤，請重試。\nAn unknown error occurred. Please try again.";
    
    const err = errorStr.toString();
    const upperEngine = engine.toUpperCase();
    
    // 429 Rate Limit / Quota Exceeded
    if (err.includes("429") || err.includes("RESOURCE_EXHAUSTED") || err.includes("quota")) {
      if (engine === 'gemini') {
        return `[繁體中文]
Gemini API 每日免費額度已達上限 (429)。
建議您至設定 (⚙️) 將引擎切換為免金鑰的 'Free Google Translate' 繼續翻譯，或至 Google AI Studio 綁定信用卡提升配額。

───────────────────────────────────
[English]
Gemini API daily free quota limit reached (429).
We suggest going to Settings (⚙️) and switching the provider to keyless 'Free Google Translate' to continue, or upgrade your key on Google AI Studio.`;
      }
      return `[繁體中文]
${upperEngine} API 呼叫頻率已達上限 (429)。
請稍候重試，或至設定切換為 'Free Google Translate' 繼續翻譯。

───────────────────────────────────
[English]
${upperEngine} API rate limit reached (429).
Please wait and try again, or go to settings and switch to 'Free Google Translate' to continue.`;
    }
    
    // 403 Forbidden / Invalid API Key / API Not Enabled
    if (err.includes("403") || err.includes("key not valid") || err.includes("API_KEY_INVALID") || err.includes("USER_LIMIT_EXCEEDED")) {
      return `[繁體中文]
API 金鑰無效或未啟用 (403)。
請點擊設定 (⚙️) 檢查金鑰是否填寫正確，並確認已在 Google Cloud 控制台啟用對應的 API 服務。

───────────────────────────────────
[English]
API Key invalid or not activated (403).
Please click Settings (⚙️) to check your key format, and ensure the corresponding APIs are enabled on your Google Cloud Console.`;
    }
    
    // 400 Bad Request
    if (err.includes("400") || err.includes("INVALID_ARGUMENT") || err.includes("Invalid value")) {
      return `[繁體中文]
檔案結構或屬性要求無效 (400)。
這可能是由於文件包含特殊不相容樣式所致。建議切換為 'Free Google Translate' 引擎繞過格式限制。

───────────────────────────────────
[English]
Invalid file structure or API parameter error (400).
This usually happens due to incompatible custom document styles. Try switching to 'Free Google Translate' to bypass formatting limits.`;
    }
    
    // Network Timeout
    if (err.includes("timed out") || err.includes("Timeout") || err.includes("Abort")) {
      return `[繁體中文]
API 請求連線逾時。
請檢查您的網際網路連線，或於稍後網路通暢時再次嘗試。

───────────────────────────────────
[English]
API request timed out.
Please check your internet connection, or try again later when the network is stable.`;
    }
    
    // Browser or Extension Restart Interruption
    if (err.includes("interrupted") || err.includes("restart")) {
      return `[繁體中文]
翻譯已被瀏覽器或擴充功能重啟中斷。
請點擊頂部的「開始翻譯」按鈕以重新發起翻譯。

───────────────────────────────────
[English]
Translation was interrupted by browser or extension restart.
Please click the "Start Translation" button at the top to retry.`;
    }

    // User Stop / Cancellation
    if (err.includes("stopped by user") || err.includes("Stop")) {
      return `[繁體中文]
翻譯已由使用者停止。
如果您需要再次翻譯，請重新點擊「開始翻譯」按鈕。

───────────────────────────────────
[English]
Translation stopped by user.
If you need to translate again, please click the "Start Translation" button.`;
    }
    
    // Default fallback but clean
    const cleanErr = errorStr.replace(/^Error:\s*/i, '');
    return `[繁體中文]
翻譯失敗: ${cleanErr}

───────────────────────────────────
[English]
Translation Failed: ${cleanErr}`;
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
      btnToggleLogs.textContent = 'Hide';
      
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
    progressStatus.textContent = status;
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
      
      progressStatus.textContent = 'Translation Complete!';
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
    if (confirm('Are you sure you want to clear all translation history?')) {
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
      historyScrollContainer.innerHTML = '<div class="history-empty-state">No completed translations yet.</div>';
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

      const dateStr = new Date(item.timestamp).toLocaleString();

      card.innerHTML = `
        <div class="history-item-info">
          <div class="history-item-icon" style="background: ${iconBg}">
            ${iconSvg}
          </div>
          <div class="history-item-meta">
            <div class="history-item-title" title="Open translation">${escapeHtml(item.originalTitle)}</div>
            <div class="history-item-date">${dateStr}</div>
          </div>
        </div>
        <div class="history-item-actions">
          <button class="history-del-btn" title="Remove from history">
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
