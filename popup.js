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
  
  // Batch & Schedule Elements
  const btnBatchSchedule = document.getElementById('btn-batch-schedule');
  const batchPanel = document.getElementById('batch-panel');
  const btnCloseBatch = document.getElementById('btn-close-batch');
  const btnCancelBatch = document.getElementById('btn-cancel-batch');
  const btnSaveBatch = document.getElementById('btn-save-batch');
  
  const batchSourceType = document.getElementById('batch-source-type');
  const groupFolderId = document.getElementById('group-folder-id');
  const batchFolderId = document.getElementById('batch-folder-id');
  
  const batchOutputMode = document.getElementById('batch-output-mode');
  const groupTargetFolderId = document.getElementById('group-target-folder-id');
  const batchTargetFolderId = document.getElementById('batch-target-folder-id');
  
  const batchLangCheckboxes = document.getElementById('batch-lang-checkboxes');
  const batchFrequencyBtns = document.getElementById('batch-frequency-btns');
  const groupScheduleInterval = document.getElementById('group-schedule-interval');
  const scheduleIntervalVal = document.getElementById('schedule-interval-val');
  const groupScheduleTime = document.getElementById('group-schedule-time');
  const scheduleTime = document.getElementById('schedule-time');
  const scheduleTimezone = document.getElementById('schedule-timezone');
  const batchTriggerPrompt = document.getElementById('batch-trigger-prompt');
  const batchJobList = document.getElementById('batch-job-list');
  
  // Visual Target Selector and Preset variables
  let selectedTargetType = 'current'; // 'current' or 'folder' or 'file'
  let selectedTargetId = '';
  let selectedTargetName = '';
  let selectedTargetMimeType = '';
  let hasManuallySelectedTarget = false;

  const driveExplorerPanel = document.getElementById('drive-explorer-panel');
  const btnChangeTarget = document.getElementById('btn-change-target');
  const btnCloseExplorer = document.getElementById('btn-close-explorer');
  const btnCancelExplorer = document.getElementById('btn-cancel-explorer');
  const btnSelectExplorer = document.getElementById('btn-select-explorer');
  const explorerBreadcrumbs = document.getElementById('explorer-breadcrumbs');
  const explorerList = document.getElementById('explorer-list');
  const explorerLoading = document.getElementById('explorer-loading');
  const batchSelectedTargetName = document.getElementById('batch-selected-target-name');
  const batchTargetIcon = document.getElementById('batch-target-icon');
  const batchPresetBtns = document.getElementById('batch-preset-btns');
  
  // Folder Detected banner elements
  const folderDetectedBanner = document.getElementById('folder-detected-banner');
  const detectedFolderName = document.getElementById('detected-folder-name');
  const btnTranslateDetectedFolder = document.getElementById('btn-translate-detected-folder');

  let selectedDriveItem = null; // Current selected item in the explorer view
  let explorerPathStack = [{ id: 'root', name: 'My Drive' }]; // Folder navigation stack
  let selectedPreset = 'now'; // 'now', 'tonight', or 'weekly'
  
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

  const selectUiLang = document.getElementById('select-ui-lang');

  // 1. Check storage for existing settings
  chrome.storage.local.get([
    'translationEngine',
    'apiKey',
    'modelName',
    'customUrl',
    'apiKeyStatus',
    'uiLang'
  ], (items) => {
    const uiLang = items.uiLang || 'en';
    if (selectUiLang) selectUiLang.value = uiLang;
    applyLanguage(uiLang);

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
    
    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || {
      statusActive: 'Active',
      statusInvalid: 'Invalid',
      statusUnverified: 'Unverified'
    };

    let resolvedStatus = status;
    const engine = selectEngine ? selectEngine.value : 'gemini';
    const key = inputApiKey ? inputApiKey.value.trim() : '';
    if (engine === 'free' || !key) {
      resolvedStatus = 'unverified';
    }

    if (inputApiKey) {
      inputApiKey.classList.remove('key-status-active', 'key-status-invalid', 'key-status-unverified');
    }

    if (resolvedStatus === 'active') {
      dot.classList.add('status-active');
      text.textContent = translations.statusActive || 'Active';
      text.style.color = 'var(--accent)';
      if (inputApiKey) inputApiKey.classList.add('key-status-active');
    } else if (resolvedStatus === 'invalid') {
      dot.classList.add('status-invalid');
      text.textContent = translations.statusInvalid || 'Invalid';
      text.style.color = '#ff7675';
      if (inputApiKey) inputApiKey.classList.add('key-status-invalid');
    } else {
      dot.classList.add('status-unverified');
      text.textContent = translations.statusUnverified || 'Unverified';
      text.style.color = '#fdcb6e';
      if (inputApiKey) inputApiKey.classList.add('key-status-unverified');
    }
  }

  function resetApiStatus() {
    if (selectEngine.value === 'free') return;
    updateStatusBadge('unverified');
    const msg = document.getElementById('test-result-msg');
    if (msg) { msg.textContent = ''; msg.className = 'test-result-msg'; }
  }

  function localizeApiError(errMsg, lang) {
    if (!errMsg) return '';
    const lower = errMsg.toLowerCase();
    
    // Gemini/OpenAI invalid key
    if (lower.includes('api key not valid') || lower.includes('key not valid') || lower.includes('api key is invalid') || lower.includes('invalid api key')) {
      const translations = {
        'en': 'API key not valid. Please pass a valid API key.',
        'zh-TW': 'API 金鑰無效。請輸入有效的 API 金鑰。',
        'zh-CN': 'API 密钥无效。请输入有效的 API 密钥。',
        'ja': 'API キーが無効です。有効な API キーを入力してください。',
        'ko': 'API 키가 유효하지 않습니다. 유효한 API 키를 입력하십시오.',
        'es': 'Clave API no válida. Por favor, introduzca una clave API válida.',
        'fr': 'Clé API non valide. Veuillez saisir une clé API valide.',
        'de': 'API-Schlüssel nicht gültig. Bitte geben Sie einen gültigen API-Schlüssel ein.',
        'vi': 'Khóa API không hợp lệ. Vui lòng nhập khóa API hợp lệ.',
        'th': 'คีย์ API ไม่ถูกต้อง โปรดป้อนคีย์ API ที่ถูกต้อง'
      };
      return translations[lang] || translations['en'];
    }
    
    // Model not found / deprecated
    if (lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('not exist'))) {
      const translations = {
        'en': 'Model not found or not accessible.',
        'zh-TW': '找不到該模型或無法存取。',
        'zh-CN': '找不到该模型或无法访问。',
        'ja': 'モデルが見つからないか、アクセスできません。',
        'ko': '모델을 찾을 수 없거나 액세스할 수 없습니다.',
        'es': 'Modelo no encontrado o no accesible.',
        'fr': 'Modèle introuvable ou inaccessible.',
        'de': 'Modell nicht gefunden oder nicht zugänglich.',
        'vi': 'Không tìm thấy mô hình hoặc không thể truy cập.',
        'th': 'ไม่พบรุ่นหรือไม่สามารถเข้าถึงได้'
      };
      return translations[lang] || translations['en'];
    }

    // Quota/billing issues
    if (lower.includes('quota') || lower.includes('billing') || lower.includes('rate limit')) {
      const translations = {
        'en': 'Quota exceeded or billing account issue.',
        'zh-TW': '已超出配額或帳單帳戶問題。',
        'zh-CN': '已超出配额或账单账户问题。',
        'ja': 'クォータを超過したか、支払いアカウントの問題です。',
        'ko': '할당량이 초과되었거나 결제 계정 문제입니다.',
        'es': 'Cuota excedida o problema con la cuenta de facturación.',
        'fr': 'Quota dépassé ou problème de compte de facturation.',
        'de': 'Kontingent überschritten oder Problem mit dem Abrechnungskonto.',
        'vi': 'Đã vượt quá hạn mức hoặc sự cố tài khoản thanh toán.',
        'th': 'เกินโควตาหรือมีปัญหาเกี่ยวกับบัญชีการชำระเงิน'
      };
      return translations[lang] || translations['en'];
    }

    return errMsg;
  }

  // ── Real API Connection Test ──────────────────────────────────────────────
  async function testApiConnection(engine, apiKey, modelName, customUrl, lang = 'en') {
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
        return { success: null, code: 'conn_bad_request', params: { error: 'Unsupported engine' }, message: '⚠ Unsupported engine.', suggestion: '' };
      }
      clearTimeout(timer);

      // 429 = quota hit but key is valid ─ treat as success
      if (resp.ok || resp.status === 429) {
        const suffix = resp.status === 429 ? ' (Rate limit reached, but credentials are valid.)' : '';
        return {
          success: true,
          code: 'conn_success',
          params: {},
          message: `✅ Connection successful! API key and model are working.${suffix}`,
          suggestion: ''
        };
      }

      let body = {};
      try { body = await resp.json(); } catch (_) {}
      const errMsg = body?.error?.message || body?.message || resp.statusText || `HTTP ${resp.status}`;
      
      const keyHints = {
        gemini: 'Get/check your key at aistudio.google.com → "Get API key". Keys start with AIzaSy...',
        openai: 'Get/check your key at platform.openai.com/api-keys. Keys start with sk-...',
        claude: 'Get/check your key at console.anthropic.com/api-keys. Keys start with sk-ant-...',
        custom: 'Verify the API key format required by your custom LLM provider.'
      };

      const lowerErr = errMsg.toLowerCase();
      const isInvalidKey = resp.status === 401 || resp.status === 403 || lowerErr.includes('key not valid') || lowerErr.includes('api key not valid') || lowerErr.includes('invalid api key');

      if (isInvalidKey) {
        return {
          success: false,
          code: 'conn_invalid_key',
          params: { error: localizeApiError(errMsg, lang) },
          message: `❌ Invalid API key: ${errMsg}`,
          suggestionCode: 'conn_hint_key',
          suggestion: keyHints[engine] || ''
        };
      } else if (resp.status === 404) {
        return {
          success: false,
          code: 'conn_model_not_found',
          params: { model: modelName },
          message: `❌ Model not found: "${modelName}"`,
          suggestion: `Verify model name at Google AI / OpenAI / Anthropic documentation.`
        };
      } else if (resp.status === 400) {
        return {
          success: false,
          code: 'conn_bad_request',
          params: { error: localizeApiError(errMsg, lang) },
          message: `❌ Bad request: ${errMsg}`,
          suggestionCode: 'conn_hint_key',
          suggestion: 'Double-check the API key and model name are correctly entered.'
        };
      } else if (resp.status === 402) {
        return {
          success: true,
          code: 'conn_billing_issue',
          params: {},
          message: '✅ API key is valid (billing issue detected, but key itself works).',
          suggestionCode: 'conn_billing_suggestion',
          suggestion: 'Add credits to your account to use this API.'
        };
      } else if (resp.status >= 500) {
        return {
          success: null,
          code: 'conn_server_error',
          params: {},
          message: `⚠ Server error (${resp.status}): ${errMsg}. The service may be temporarily unavailable. Try again later.`,
          suggestion: ''
        };
      }
      return {
        success: false,
        code: 'conn_bad_request',
        params: { error: localizeApiError(errMsg, lang) },
        message: `❌ Error (${resp.status}): ${errMsg}`,
        suggestion: ''
      };

    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return {
          success: null,
          code: 'conn_timeout',
          params: {},
          message: '⚠ Request timed out (15s). Check your internet connection.',
          suggestion: ''
        };
      }
      return {
        success: null,
        code: 'conn_network_error',
        params: { error: err.message },
        message: `⚠ Network error: ${err.message}`,
        suggestion: 'Check your internet connection or the custom endpoint URL.'
      };
    }
  }

  // ── Pre-translation modal ─────────────────────────────────────────────────
  function showApiWarningModal(reason) {
    const modal = document.getElementById('api-warning-modal');
    const title = document.getElementById('modal-title');
    const msg = document.getElementById('modal-msg');
    if (!modal) return;

    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

    if (reason === 'missing') {
      title.textContent = translations.modalTitleMissing || 'API Key Required';
      msg.textContent = translations.modalMsgMissing || 'An API key is required...';
    } else if (reason === 'unverified') {
      title.textContent = translations.modalTitleNotVerified || 'API Key Not Verified';
      msg.textContent = translations.modalMsgNotVerified || 'Your API key has not been tested...';
    } else {
      title.textContent = translations.modalTitleInvalid || 'API Key Invalid';
      msg.textContent = translations.modalMsgInvalid || 'Your API key is marked as invalid...';
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

    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

    const engineNameMap = {
      gemini: 'Gemini',
      openai: 'OpenAI',
      claude: 'Claude',
      custom: 'Custom'
    };
    const engineDisplayName = engineNameMap[engine] || 'API';

    if (engine === 'gemini') {
      if (key.startsWith('AIzaSy') && key.length >= 35) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = translations.valKeyFormatMatch
          ? translations.valKeyFormatMatch.replace('{engine}', engineDisplayName)
          : `✓ ${engineDisplayName} API Key format matches specifications`;
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = translations.valKeyFormatMismatch
          ? translations.valKeyFormatMismatch.replace('{engine}', engineDisplayName).replace('{prefix}', 'AIzaSy')
          : `⚠ Format mismatch: ${engineDisplayName} keys typically start with AIzaSy`;
      }
    } else if (engine === 'openai') {
      if ((key.startsWith('sk-') || key.startsWith('sk-proj-')) && key.length >= 20) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = translations.valKeyFormatMatch
          ? translations.valKeyFormatMatch.replace('{engine}', engineDisplayName)
          : `✓ ${engineDisplayName} API Key format matches specifications`;
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = translations.valKeyFormatMismatch
          ? translations.valKeyFormatMismatch.replace('{engine}', engineDisplayName).replace('{prefix}', 'sk-')
          : `⚠ Format mismatch: ${engineDisplayName} keys typically start with sk-`;
      }
    } else if (engine === 'claude') {
      if (key.startsWith('sk-ant-') && key.length >= 25) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = translations.valKeyFormatMatch
          ? translations.valKeyFormatMatch.replace('{engine}', engineDisplayName)
          : `✓ ${engineDisplayName} API Key format matches specifications`;
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = translations.valKeyFormatMismatch
          ? translations.valKeyFormatMismatch.replace('{engine}', engineDisplayName).replace('{prefix}', 'sk-ant-')
          : `⚠ Format mismatch: ${engineDisplayName} keys typically start with sk-ant-`;
      }
    } else {
      if (key.length >= 10) {
        apiKeyIndicator.className = 'val-indicator valid';
        apiKeyIndicator.textContent = translations.valKeyLooksValid || '✓ API Key looks valid';
      } else {
        apiKeyIndicator.className = 'val-indicator invalid';
        apiKeyIndicator.textContent = translations.valKeyTooShort || '⚠ API Key is extremely short';
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
    batchPanel.classList.remove('active');   // close batch if open
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
      'apiKeyStatus',
      'uiLang'
    ], (items) => {
      const uiLang = items.uiLang || 'en';
      if (selectUiLang) selectUiLang.value = uiLang;
      applyLanguage(uiLang);

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

  // Batch & Schedule Panel Event Handlers
  batchSourceType.addEventListener('change', () => {
    if (batchSourceType.value === 'folder') {
      groupFolderId.classList.remove('hidden');
    } else {
      groupFolderId.classList.add('hidden');
    }
  });

  batchOutputMode.addEventListener('change', () => {
    if (batchOutputMode.value === 'target') {
      groupTargetFolderId.classList.remove('hidden');
    } else {
      groupTargetFolderId.classList.add('hidden');
    }
  });

  // Target Card and Drive Explorer Logic
  function updateSelectedTargetUI() {
    if (!batchSelectedTargetName || !batchTargetIcon) return;
    
    batchSelectedTargetName.textContent = selectedTargetName || 'None selected';
    
    let icon = '📄';
    if (selectedTargetType === 'folder') {
      icon = '📁';
    } else if (selectedTargetMimeType === 'application/vnd.google-apps.presentation') {
      icon = '📊';
    } else if (selectedTargetMimeType === 'application/vnd.google-apps.document') {
      icon = '📝';
    } else if (selectedTargetMimeType === 'application/vnd.google-apps.spreadsheet') {
      icon = '📈';
    } else if (selectedTargetMimeType === 'application/vnd.google-apps.form') {
      icon = '📋';
    }
    batchTargetIcon.textContent = icon;

    // Set hidden elements
    if (batchSourceType) batchSourceType.value = selectedTargetType === 'folder' ? 'folder' : 'current';
    if (batchFolderId) batchFolderId.value = selectedTargetId;
  }

  // Visual Drive Explorer Functions
  function loadDriveFolder(folderId) {
    if (!explorerLoading || !explorerList || !btnSelectExplorer) return;
    explorerLoading.classList.remove('hidden');
    explorerList.innerHTML = '';
    btnSelectExplorer.disabled = true;
    selectedDriveItem = null;

    chrome.runtime.sendMessage({ action: 'listDriveFolder', folderId }, (response) => {
      explorerLoading.classList.add('hidden');
      if (response && response.success) {
        renderExplorerList(response.files);
      } else {
        const errorMsg = response ? response.error : 'Unknown error';
        explorerList.innerHTML = `<div style="padding:20px; color:#ff7675; font-size:11px; text-align:center;">Failed to load folder: ${errorMsg}</div>`;
      }
    });
  }

  function renderExplorerList(files) {
    if (!explorerList) return;
    if (!files || files.length === 0) {
      explorerList.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted); font-size:11px;">Folder is empty</div>`;
      return;
    }

    explorerList.innerHTML = '';
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'explorer-item';
      
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
      
      let icon = '📄';
      if (isFolder) icon = '📁';
      else if (file.mimeType === 'application/vnd.google-apps.presentation') icon = '📊';
      else if (file.mimeType === 'application/vnd.google-apps.document') icon = '📝';
      else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') icon = '📈';
      else if (file.mimeType === 'application/vnd.google-apps.form') icon = '📋';

      item.innerHTML = `
        <span class="explorer-item-icon">${icon}</span>
        <span class="explorer-item-name">${escapeHtml(file.name)}</span>
        <span class="explorer-item-meta">${isFolder ? 'Folder' : ''}</span>
      `;

      item.addEventListener('click', () => {
        document.querySelectorAll('.explorer-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedDriveItem = file;
        btnSelectExplorer.disabled = false;
      });

      if (isFolder) {
        item.addEventListener('dblclick', () => {
          explorerPathStack.push({ id: file.id, name: file.name });
          renderBreadcrumbs();
          loadDriveFolder(file.id);
        });
      }
      
      explorerList.appendChild(item);
    });
  }

  function renderBreadcrumbs() {
    if (!explorerBreadcrumbs) return;
    explorerBreadcrumbs.innerHTML = '';
    explorerPathStack.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.textContent = '>';
        explorerBreadcrumbs.appendChild(sep);
      }

      const item = document.createElement('span');
      if (index === explorerPathStack.length - 1) {
        item.className = 'breadcrumb-current';
        item.textContent = crumb.name;
      } else {
        item.className = 'breadcrumb-item';
        item.textContent = crumb.name;
        item.addEventListener('click', () => {
          explorerPathStack = explorerPathStack.slice(0, index + 1);
          renderBreadcrumbs();
          loadDriveFolder(crumb.id);
        });
      }
      explorerBreadcrumbs.appendChild(item);
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

  // Bind change target button
  if (btnChangeTarget) {
    btnChangeTarget.addEventListener('click', () => {
      if (driveExplorerPanel) {
        driveExplorerPanel.classList.remove('hidden');
        // Trigger reflow to ensure slide transition works
        driveExplorerPanel.getBoundingClientRect();
        driveExplorerPanel.classList.add('active');
      }
      explorerPathStack = [{ id: 'root', name: 'My Drive' }];
      renderBreadcrumbs();
      loadDriveFolder('root');
    });
  }

  const closeExplorer = () => {
    if (driveExplorerPanel) {
      driveExplorerPanel.classList.remove('active');
      setTimeout(() => {
        driveExplorerPanel.classList.add('hidden');
      }, 300);
    }
  };

  if (btnCloseExplorer) btnCloseExplorer.addEventListener('click', closeExplorer);
  if (btnCancelExplorer) btnCancelExplorer.addEventListener('click', closeExplorer);

  if (btnSelectExplorer) {
    btnSelectExplorer.addEventListener('click', () => {
      if (selectedDriveItem) {
        selectedTargetType = selectedDriveItem.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file';
        selectedTargetId = selectedDriveItem.id;
        selectedTargetName = selectedDriveItem.name;
        selectedTargetMimeType = selectedDriveItem.mimeType;
        hasManuallySelectedTarget = true;

        updateSelectedTargetUI();
        closeExplorer();
      }
    });
  }

  // Frequency/Intervals logic (Advanced Settings)
  let selectedFrequency = 'once';
  const freqButtons = batchFrequencyBtns.querySelectorAll('.freq-btn');
  freqButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      freqButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFrequency = btn.getAttribute('data-freq');
      
      // Deactivate presets since custom options are picked
      const presetButtons = batchPresetBtns.querySelectorAll('.preset-btn');
      presetButtons.forEach(b => b.classList.remove('active'));
      selectedPreset = 'custom';
      
      if (selectedFrequency === 'minute' || selectedFrequency === 'hour') {
        groupScheduleInterval.classList.remove('hidden');
        groupScheduleTime.classList.add('hidden');
        const hintEl = document.getElementById('hint-schedule-interval');
        if (hintEl) {
          hintEl.textContent = selectedFrequency === 'minute' ? 'Run every N minutes' : 'Run every N hours';
        }
      } else if (selectedFrequency === 'once') {
        groupScheduleInterval.classList.add('hidden');
        groupScheduleTime.classList.add('hidden');
      } else {
        groupScheduleInterval.classList.add('hidden');
        groupScheduleTime.classList.remove('hidden');
      }
    });
  });

  // Preset buttons click handlers
  if (batchPresetBtns) {
    const presetButtons = batchPresetBtns.querySelectorAll('.preset-btn');
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        presetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPreset = btn.getAttribute('data-preset');
        
        if (selectedPreset === 'now') {
          selectedFrequency = 'once';
          freqButtons.forEach(b => {
            if (b.getAttribute('data-freq') === 'once') b.classList.add('active');
            else b.classList.remove('active');
          });
          groupScheduleInterval.classList.add('hidden');
          groupScheduleTime.classList.add('hidden');
        } else if (selectedPreset === 'tonight') {
          selectedFrequency = 'daily';
          freqButtons.forEach(b => {
            if (b.getAttribute('data-freq') === 'daily') b.classList.add('active');
            else b.classList.remove('active');
          });
          if (scheduleTime) scheduleTime.value = '23:00';
          groupScheduleInterval.classList.add('hidden');
          groupScheduleTime.classList.remove('hidden');
        } else if (selectedPreset === 'weekly') {
          selectedFrequency = 'weekly';
          freqButtons.forEach(b => {
            if (b.getAttribute('data-freq') === 'weekly') b.classList.add('active');
            else b.classList.remove('active');
          });
          if (scheduleTime) scheduleTime.value = '09:00';
          groupScheduleInterval.classList.add('hidden');
          groupScheduleTime.classList.remove('hidden');
        }
      });
    });
  }

  batchOutputMode.addEventListener('change', () => {
    if (batchOutputMode.value === 'target') {
      groupTargetFolderId.classList.remove('hidden');
    } else {
      groupTargetFolderId.classList.add('hidden');
    }
  });

  btnBatchSchedule.addEventListener('click', () => {
    settingsPanel.classList.remove('active');
    historyPanel.classList.remove('active');
    batchPanel.classList.add('active');
    loadBatchJobs();
  });

  const closeBatch = () => {
    batchPanel.classList.remove('active');
  };

  btnCloseBatch.addEventListener('click', closeBatch);
  btnCancelBatch.addEventListener('click', closeBatch);

  btnSaveBatch.addEventListener('click', () => {
    const sourceType = batchSourceType.value;
    const folderId = batchFolderId.value.trim();
    if (!folderId) {
      alert('Please select a file or folder.');
      return;
    }
    
    const outputMode = batchOutputMode.value;
    const targetFolderId = batchTargetFolderId.value.trim();
    if (outputMode === 'target' && !targetFolderId) {
      alert('Please enter a Target Folder ID.');
      return;
    }

    const selectedLangs = [];
    const checkboxes = batchLangCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
    checkboxes.forEach(cb => selectedLangs.push(cb.value));
    if (selectedLangs.length === 0) {
      alert('Please select at least one target language.');
      return;
    }

    const intervalVal = parseInt(scheduleIntervalVal.value) || 15;
    const startTime = scheduleTime.value;
    const timezone = scheduleTimezone.value;
    const prompt = batchTriggerPrompt.value.trim();

    const job = {
      id: 'job_' + Date.now(),
      sourceType,
      folderId: folderId,
      folderTitle: selectedTargetName || (sourceType === 'folder' ? 'Drive Folder' : 'Active Document'),
      fileType: selectedTargetType === 'folder' ? 'folder' : (currentFileType || 'presentation'),
      outputMode,
      targetFolderId: outputMode === 'target' ? targetFolderId : '',
      targetLangs: selectedLangs,
      schedule: {
        frequency: selectedFrequency,
        interval: intervalVal,
        startTime,
        timezone,
        prompt
      },
      status: 'idle',
      progress: 0,
      createdAt: Date.now()
    };

    chrome.runtime.sendMessage({ action: 'createBatchJob', job }, (response) => {
      if (response && response.success) {
        closeBatch();
        chrome.runtime.sendMessage({ action: 'syncSchedules' });
      } else {
        alert('Failed to save batch job.');
      }
    });
  });

  function loadBatchJobs() {
    chrome.storage.local.get(['batchJobs'], (data) => {
      const jobs = data.batchJobs || {};
      renderJobList(Object.values(jobs));
    });
  }

  function renderJobList(jobs) {
    if (jobs.length === 0) {
      batchJobList.innerHTML = '<div class="job-empty-state">No scheduled jobs.</div>';
      return;
    }
    batchJobList.innerHTML = '';
    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'job-card';
      
      const percent = Math.round(job.progress || 0);
      const freqLabel = job.schedule.frequency === 'once' ? 'One-Time' : job.schedule.frequency;
      
      card.innerHTML = `
        <div class="job-card-header">
          <div class="job-card-title">${job.sourceType === 'folder' ? 'Folder: ' + job.folderId : job.folderTitle}</div>
          <span class="job-card-badge badge-${job.status}">${job.status}</span>
        </div>
        <div class="job-card-meta">
          Langs: ${job.targetLangs.join(', ')} | Mode: ${freqLabel}
        </div>
        <div class="job-card-progress">
          <div class="job-progress-bar-container">
            <div class="job-progress-bar-fill" style="width: ${percent}%"></div>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-muted);">
            <span>Progress: ${percent}%</span>
            <span>${job.schedule.startTime || ''}</span>
          </div>
        </div>
        <div class="job-card-actions">
          ${job.status === 'running' || job.status === 'idle' ? 
            `<button class="job-action-btn" data-action="pause" data-id="${job.id}">Pause</button>` : 
            job.status === 'paused' ? 
            `<button class="job-action-btn" data-action="resume" data-id="${job.id}">Resume</button>` : ''
          }
          <button class="job-action-btn danger" data-action="delete" data-id="${job.id}">Delete</button>
        </div>
      `;
      
      card.querySelectorAll('.job-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.target.getAttribute('data-action');
          const jobId = e.target.getAttribute('data-id');
          if (action === 'delete') {
            if (confirm('Delete this job?')) {
              chrome.runtime.sendMessage({ action: 'deleteBatchJob', jobId }, () => {
                loadBatchJobs();
              });
            }
          } else if (action === 'pause') {
            chrome.runtime.sendMessage({ action: 'pauseBatchJob', jobId }, () => {
              loadBatchJobs();
            });
          } else if (action === 'resume') {
            chrome.runtime.sendMessage({ action: 'resumeBatchJob', jobId }, () => {
              loadBatchJobs();
            });
          }
        });
      });
      
      batchJobList.appendChild(card);
    });
  }

  btnCloseSettings.addEventListener('click', closeSettings);
  btnCancelSettings.addEventListener('click', closeSettings);

  btnSaveSettings.addEventListener('click', () => {
    const translationEngine = selectEngine.value;
    const apiKey = inputApiKey.value.trim();
    const modelName = inputModelName.value.trim();
    const customUrl = inputCustomUrl.value.trim();
    const uiLang = selectUiLang ? selectUiLang.value : 'en';

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
        
        const translations = LOCALES[uiLang] || LOCALES['en'];
        if (isFailed) {
          errorBanner.innerHTML = translations.warningBannerFailed;
        } else {
          errorBanner.innerHTML = translations.warningBannerNotVerified;
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
      customUrl,
      uiLang,
      apiKeyStatus: (translationEngine === 'free' || !apiKey) ? 'unverified' : (document.getElementById('api-status-dot')?.classList.contains('status-active') ? 'active' : 'unverified')
    }, () => {
      applyLanguage(uiLang);
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
      const selectUiLang = document.getElementById('select-ui-lang');
      const lang = (selectUiLang && selectUiLang.value) || 'en';
      const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

      if (!apiKey) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = translations.errEnterKey || '⚠️ Please enter your API key first.';
        return;
      }
      if (!modelName) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = translations.errEnterModel || '⚠️ Please enter a model name first.';
        return;
      }
      if (engine === 'custom' && !customUrl) {
        testResultMsg.className = 'test-result-msg result-invalid';
        testResultMsg.textContent = translations.errEnterUrl || '⚠️ Please enter a Base Endpoint URL first.';
        return;
      }
      // Show loading state
      btnTestApi.disabled = true;
      btnTestApi.innerHTML = `<svg class="btn-icon-spin" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a10 10 0 0 1 10 10"></path></svg> ${translations.btnTesting || 'Testing...'}`;
      testResultMsg.className = 'test-result-msg';
      testResultMsg.textContent = '';

      const result = await testApiConnection(engine, apiKey, modelName, customUrl, lang);

      // Restore button
      btnTestApi.disabled = false;
      btnTestApi.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ${translations.btnTestConnection || 'Test Connection'}`;

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

      // Store in dataset for dynamic re-translation on UI language change
      testResultMsg.dataset.code = result.code || '';
      testResultMsg.dataset.params = result.params ? JSON.stringify(result.params) : '';
      testResultMsg.dataset.suggestionCode = result.suggestionCode || '';
      testResultMsg.dataset.fallbackMessage = result.message || '';
      testResultMsg.dataset.fallbackSuggestion = result.suggestion || '';

      // Format initial message in current language
      let translatedMsg = '';
      if (result.code) {
        let template = translations[result.code] || result.message;
        if (result.params) {
          for (const [k, v] of Object.entries(result.params)) {
            template = template.replace(`{${k}}`, v);
          }
        }
        translatedMsg = template;
      } else {
        translatedMsg = result.message;
      }

      let translatedSuggestion = '';
      if (result.suggestionCode) {
        translatedSuggestion = translations[result.suggestionCode] || result.suggestion;
      } else {
        translatedSuggestion = result.suggestion;
      }

      testResultMsg.innerHTML = translatedMsg +
        (translatedSuggestion ? `<br><span class="test-suggestion">${translatedSuggestion}</span>` : '');

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
      // Clean Google Workspace / Office suffixes from the tab title across all 10 supported languages
      let cleanTitle = tabTitle;
      const googleSuffixRegex = /\s*-\s*Google\s+(Slides|Docs|Sheets|Forms|簡報|文件|試算表|表單|幻灯片|文档|表格|表单|スライド|ドキュメント|スプレッドシート|フォーム|프레젠테이션|문서|스프레드시트|설문지|Presentaciones|Documentos|Hojas de cálculo|Formularios|Présentations|Documents|Feuilles de calcul|Formulaires|Präsentationen|Dokumente|Tabellen|Formulare|Trang trình bày|Tài liệu|Trang tính|Biểu mẫu|สไลด์|เอกสาร|ชีต|ฟอร์ม)$/i;
      cleanTitle = cleanTitle.replace(googleSuffixRegex, "");
      
      // Also strip Office extensions from Drive viewer titles
      const officeExtensions = [".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt"];
      for (const ext of officeExtensions) {
        if (cleanTitle.toLowerCase().endsWith(ext)) {
          cleanTitle = cleanTitle.slice(0, -ext.length);
        }
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
      
      if (currentPresentationId !== newPresentationId || currentFileType !== newFileType) {
        currentPresentationId = newPresentationId;
        currentPresentationTitle = newPresentationTitle;
        currentFileType = newFileType;
        
        slideTitleEl.textContent = currentPresentationTitle;
        
        // Dynamically adjust icon
        const slideIconEl = document.getElementById('slide-icon');
        
        if (isDoc) {
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(52, 152, 219, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
          }
        } else if (isSheet) {
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(46, 204, 113, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;
          }
        } else if (isForm) {
          if (slideIconEl) {
            slideIconEl.style.background = "rgba(155, 89, 182, 0.1)";
            slideIconEl.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#9b59b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="8" x2="17" y2="8"></line><line x1="9" y1="13" x2="17" y2="13"></line><line x1="9" y1="18" x2="15" y2="18"></line><circle cx="6" cy="8" r="0.5" fill="currentColor"></circle><circle cx="6" cy="13" r="0.5" fill="currentColor"></circle><circle cx="6" cy="18" r="0.5" fill="currentColor"></circle></svg>`;
          }
        } else {
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
        
        // Apply localization
        applyLanguage((selectUiLang && selectUiLang.value) || 'en');
      } else if (currentPresentationTitle !== newPresentationTitle) {
        currentPresentationTitle = newPresentationTitle;
        slideTitleEl.textContent = currentPresentationTitle;
      }
      
      if (folderDetectedBanner) folderDetectedBanner.classList.add('hidden');
      
      // Auto-select active file if target has not been manually changed
      if (!hasManuallySelectedTarget) {
        selectedTargetType = 'current';
        selectedTargetId = currentPresentationId;
        selectedTargetName = currentPresentationTitle;
        selectedTargetMimeType = (currentFileType === 'document') ? 'application/vnd.google-apps.document' :
                                 (currentFileType === 'spreadsheet') ? 'application/vnd.google-apps.spreadsheet' :
                                 (currentFileType === 'form') ? 'application/vnd.google-apps.form' :
                                 'application/vnd.google-apps.presentation';
        updateSelectedTargetUI();
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

      // Check if it's a folder tab:
      const driveFolderMatch = url.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/)([a-zA-Z0-9_-]+)/);
      if (driveFolderMatch) {
        const folderId = driveFolderMatch[1];
        const tabTitle = tab.title || '';
        const folderName = tabTitle.replace(/\s*-\s*Google\s+Drive/i, "").trim() || 'Drive Folder';
        
        if (folderDetectedBanner) folderDetectedBanner.classList.remove('hidden');
        if (detectedFolderName) detectedFolderName.textContent = folderName;
        
        // Setup direct translation click handler for this banner
        if (btnTranslateDetectedFolder) {
          btnTranslateDetectedFolder.onclick = () => {
            selectedTargetType = 'folder';
            selectedTargetId = folderId;
            selectedTargetName = folderName;
            selectedTargetMimeType = 'application/vnd.google-apps.folder';
            hasManuallySelectedTarget = true;
            
            updateSelectedTargetUI();
            
            // Open batch panel
            if (btnBatchSchedule) btnBatchSchedule.click();
          };
        }
        
        // Auto-select folder if target has not been manually customized
        if (!hasManuallySelectedTarget) {
          selectedTargetType = 'folder';
          selectedTargetId = folderId;
          selectedTargetName = folderName;
          selectedTargetMimeType = 'application/vnd.google-apps.folder';
          updateSelectedTargetUI();
        }
      } else {
        if (folderDetectedBanner) folderDetectedBanner.classList.add('hidden');
      }

      if (logCheckInterval) {
        clearInterval(logCheckInterval);
        logCheckInterval = null;
      }
    }
  }

  function checkCurrentTab() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
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
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0 && tabs[0].id === activeInfo.tabId) {
        handleTabChange(tabs[0]);
      }
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only respond if the updated tab is the active tab in the current window of the side panel
    // Also respect the post-translation lock (prevents bad auto-loaded titles like 管理員警告)
    if (tabChangeLocked) return;
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
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
    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

    const isHidden = logConsoleContent.classList.contains('hidden');
    if (isHidden) {
      logConsoleContent.classList.remove('hidden');
      btnToggleLogs.textContent = translations.btnHide || 'Hide';
    } else {
      logConsoleContent.classList.add('hidden');
      btnToggleLogs.textContent = translations.btnShow || 'Show';
    }
  });

  function updateLogDisplay(logs) {
    if (!logs || logs.length === 0) {
      const selectUiLang = document.getElementById('select-ui-lang');
      const lang = (selectUiLang && selectUiLang.value) || 'en';
      const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];
      logConsoleContent.textContent = translations.waitingForLogs || 'Waiting for logs...';
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
    
    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];
    logConsoleContent.textContent = translations.waitingForLogs || 'Waiting for logs...';
    
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
        const selectUiLangInner = document.getElementById('select-ui-lang');
        const langInner = (selectUiLangInner && selectUiLangInner.value) || 'en';
        const translationsInner = (typeof LOCALES !== 'undefined' && LOCALES[langInner]) || LOCALES['en'];
        progressStatus.textContent = translationsInner.takingLonger || 'Taking longer than expected. Check connection/logs...';
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
        const selectUiLang = document.getElementById('select-ui-lang');
        const lang = (selectUiLang && selectUiLang.value) || 'en';
        const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];
        logConsoleContent.textContent = translations.initiatingConnection || 'Initiating connection...';
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
            alert(translations.errUnknown || 'Communication with background worker failed. Please try again.');
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
      const selectUiLang = document.getElementById('select-ui-lang');
      const lang = (selectUiLang && selectUiLang.value) || 'en';
      const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];
      btnCancelTranslation.textContent = translations.stopping || 'Stopping...';
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
    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

    progressStatus.textContent = translations.connecting || 'Connecting...';
    progressStatus.style.color = 'var(--text-muted)';
    progressPct.textContent = '0%';
    progressBarFill.style.width = '0%';
    
    if (btnCancelTranslation) {
      btnCancelTranslation.disabled = false;
      btnCancelTranslation.style.display = 'block';
      btnCancelTranslation.innerHTML = `<span>${translations.btnCancelTranslation || 'Stop Translation'}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>`;
    }

    stepCopy.className = 'pending';
    stepExtract.className = 'pending';
    stepApi.className = 'pending';
    stepWrite.className = 'pending';
  }

  // Helper to translate raw developer API error stacks into actionable human-friendly bilingual messages
  function translateErrorToHuman(errorStr, engine) {
    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

    if (!errorStr) return translations.errUnknown || "發生未知錯誤，請重試。";
    
    const err = errorStr.toString();
    const upperEngine = engine.toUpperCase();
    
    // 429 Rate Limit / Quota Exceeded
    if (err.includes("429") || err.includes("RESOURCE_EXHAUSTED") || err.includes("quota")) {
      if (engine === 'gemini') {
        return translations.errGeminiQuota || "Gemini API 每日免費額度已達上限 (429)。";
      }
      return (translations.errGeneralQuota || "{engine} API 呼叫頻率已達上限 (429)。").replace('{engine}', upperEngine);
    }
    
    // 403 Forbidden / Invalid API Key / API Not Enabled
    if (err.includes("403") || err.includes("key not valid") || err.includes("API_KEY_INVALID") || err.includes("USER_LIMIT_EXCEEDED")) {
      return translations.errForbidden || "API 金鑰無效或未啟用 (403)。";
    }
    
    // 400 Bad Request
    if (err.includes("400") || err.includes("INVALID_ARGUMENT") || err.includes("Invalid value")) {
      return translations.errBadRequest || "檔案結構或屬性要求無效 (400)。";
    }
    
    // Network Timeout
    if (err.includes("timed out") || err.includes("Timeout") || err.includes("Abort")) {
      return translations.errTimeout || "API 請求連線逾時。";
    }
    
    // Browser or Extension Restart Interruption
    if (err.includes("interrupted") || err.includes("restart")) {
      return translations.errInterrupted || "翻譯已被瀏覽器或擴充功能重啟中斷。";
    }

    // User Stop / Cancellation
    if (err.includes("stopped by user") || err.includes("Stop")) {
      return translations.errUserStop || "翻譯已由使用者停止。";
    }
    
    // Default fallback but clean
    const cleanErr = errorStr.replace(/^Error:\s*/i, '');
    return (translations.errFailed || "翻譯失敗: {error}").replace('{error}', cleanErr);
  }

  function localizeProgressStatus(status, translations) {
    if (!status) return '';
    const lower = status.toLowerCase();
    
    if (lower.includes('authenticating')) {
      return translations.statusAuth || 'Authenticating with Google...';
    }
    if (lower.includes('duplicating')) {
      let typeTranslated = '';
      if (lower.includes('presentation') || lower.includes('slide')) typeTranslated = translations.presentation || 'presentation';
      else if (lower.includes('document')) typeTranslated = translations.document || 'document';
      else if (lower.includes('spreadsheet')) typeTranslated = translations.spreadsheet || 'spreadsheet';
      else if (lower.includes('form')) typeTranslated = translations.form || 'form';
      return (translations.statusDuplicating || 'Duplicating {type} on Google Drive...').replace('{type}', typeTranslated);
    }
    if (lower.includes('extracting spreadsheet')) {
      return translations.statusExtractSpreadsheet || 'Extracting spreadsheet structure...';
    }
    if (lower.includes('extracting form')) {
      return translations.statusExtractForm || 'Extracting form structure...';
    }
    if (lower.includes('extracting document')) {
      return translations.statusExtractDoc || 'Extracting document elements & text...';
    }
    if (lower.includes('extracting layout')) {
      return translations.statusExtractLayout || 'Extracting layout elements & text...';
    }
    if (lower.includes('no translatable text')) {
      return translations.statusNoText || 'No translatable text found. Opening copy...';
    }
    if (lower.includes('translating texts using')) {
      const engine = status.split('using').pop().trim();
      return (translations.statusTranslating || 'Translating texts using {engine}...').replace('{engine}', engine);
    }
    if (lower.includes('applying translations')) {
      return translations.statusApplying || 'Applying translations and formatting preservation...';
    }
    if (lower.includes('opening translated')) {
      let typeTranslated = '';
      if (lower.includes('presentation') || lower.includes('slide')) typeTranslated = translations.presentation || 'presentation';
      else if (lower.includes('document')) typeTranslated = translations.document || 'document';
      else if (lower.includes('spreadsheet')) typeTranslated = translations.spreadsheet || 'spreadsheet';
      else if (lower.includes('form')) typeTranslated = translations.form || 'form';
      return (translations.statusOpening || 'Opening translated {type}!').replace('{type}', typeTranslated);
    }
    
    return status;
  }

  // Progress message handler
  function handleProgress(message) {
    if (message.type !== 'translationProgress') return;

    const { step, status, pct, error, finalUrl } = message;

    lastProgressTime = Date.now(); // Reset warning timer

    const selectUiLang = document.getElementById('select-ui-lang');
    const lang = (selectUiLang && selectUiLang.value) || 'en';
    const translations = (typeof LOCALES !== 'undefined' && LOCALES[lang]) || LOCALES['en'];

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
      btnToggleLogs.textContent = translations.btnHide || 'Hide';
      
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
    progressStatus.textContent = localizeProgressStatus(status, translations);
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
      
      progressStatus.textContent = translations.translationComplete || 'Translation Complete!';
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
    batchPanel.classList.remove('active');   // close batch if open
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

  // ── UI Localization Logic ────────────────────────────────────────────────
  if (selectUiLang) {
    selectUiLang.addEventListener('change', (e) => {
      applyLanguage(e.target.value);
    });
  }

  function applyLanguage(lang) {
    if (typeof LOCALES === 'undefined') return;
    const translations = LOCALES[lang] || LOCALES['en'];
    
    // Header actions titles
    if (btnHelp) btnHelp.setAttribute('title', translations.btnHelpTitle);
    if (btnHistory) btnHistory.setAttribute('title', translations.btnHistoryTitle);
    if (btnSettings) btnSettings.setAttribute('title', translations.btnSettingsTitle);
    
    // Warning Panel
    const warningHeader = document.querySelector('#warning-panel h3');
    if (warningHeader) warningHeader.textContent = translations.warningHeader;
    const warningText = document.querySelector('#warning-panel p:nth-of-type(1)');
    if (warningText) warningText.textContent = translations.warningText;
    
    const btnCreateSlides = document.getElementById('btn-create-slides');
    if (btnCreateSlides) btnCreateSlides.textContent = translations.btnCreateSlides;
    const btnCreateDocs = document.getElementById('btn-create-docs');
    if (btnCreateDocs) btnCreateDocs.textContent = translations.btnCreateDocs;
    const btnCreateSheets = document.getElementById('btn-create-sheets');
    if (btnCreateSheets) btnCreateSheets.textContent = translations.btnCreateSheets;
    const btnCreateForms = document.getElementById('btn-create-forms');
    if (btnCreateForms) btnCreateForms.textContent = translations.btnCreateForms;
    
    // Main Panel Active File Label
    const metaLabel = document.getElementById('meta-label');
    if (metaLabel) {
      if (currentFileType === 'presentation') metaLabel.textContent = translations.activePresentation;
      else if (currentFileType === 'document') metaLabel.textContent = translations.activeDocument;
      else if (currentFileType === 'spreadsheet') metaLabel.textContent = translations.activeSheet;
      else if (currentFileType === 'form') metaLabel.textContent = translations.activeForm;
    }
    
    if (slideTitleEl && (slideTitleEl.textContent === 'Loading title...' || slideTitleEl.textContent === '載入標題中...' || slideTitleEl.textContent === '正在加载标题...')) {
      slideTitleEl.textContent = translations.loadingTitle;
    }
    
    const selectLangLabel = document.querySelector('.control-group label[for="select-lang"]');
    if (selectLangLabel) selectLangLabel.textContent = translations.selectLangLabel;
    
    const btnTranslateSpan = document.querySelector('#btn-translate span');
    if (btnTranslateSpan) btnTranslateSpan.textContent = translations.btnTranslate;
    
    // Progress Section
    const progressWarningText = document.querySelector('.warning-banner-text');
    if (progressWarningText) progressWarningText.innerHTML = translations.progressWarningText;
    
    // Progress Steps (Dynamic translations)
    updateStepLanguage(translations);
    
    const btnCancelTranslationSpan = document.querySelector('#btn-cancel-translation span');
    if (btnCancelTranslationSpan) btnCancelTranslationSpan.textContent = translations.btnCancelTranslation;
    
    const logConsoleHeaderSpan = document.querySelector('.log-console-header span');
    if (logConsoleHeaderSpan) logConsoleHeaderSpan.textContent = translations.logConsoleHeader;
    
    // Settings panel
    const settingsHeader = document.querySelector('.settings-panel .settings-header-bar h3');
    if (settingsHeader) settingsHeader.textContent = translations.settingsHeader;
    
    const labelGeneralSettings = document.getElementById('label-general-settings');
    if (labelGeneralSettings) labelGeneralSettings.textContent = translations.generalSettings;
    const labelUiLanguage = document.getElementById('label-ui-language');
    if (labelUiLanguage) labelUiLanguage.textContent = translations.selectUiLangLabel;
    
    const labelTranslationEngine = document.getElementById('label-translation-engine');
    if (labelTranslationEngine) labelTranslationEngine.textContent = translations.engineSettings;
    const selectEngineLabel = document.querySelector('.settings-panel label[for="select-engine"]');
    if (selectEngineLabel) selectEngineLabel.textContent = translations.selectEngineLabel;
    
    const labelApiKey = document.querySelector('.settings-panel label[for="api-key"]');
    if (labelApiKey) labelApiKey.textContent = translations.labelApiKey;
    if (inputApiKey) inputApiKey.setAttribute('placeholder', translations.placeholderApiKey);
    
    const labelModelName = document.querySelector('.settings-panel label[for="model-name"]');
    if (labelModelName) labelModelName.textContent = translations.labelModelName;
    
    const modelSunsetTip = document.querySelector('#model-sunset-tip span');
    if (modelSunsetTip) modelSunsetTip.innerHTML = translations.modelSunsetTip;
    const quotaTip = document.querySelector('#group-quota-tip span');
    if (quotaTip) quotaTip.innerHTML = translations.quotaTip;
    
    const labelCustomUrl = document.querySelector('.settings-panel label[for="custom-url"]');
    if (labelCustomUrl) labelCustomUrl.textContent = translations.labelCustomUrl;
    
    const btnTestApi = document.getElementById('btn-test-api');
    if (btnTestApi && !btnTestApi.disabled) {
      btnTestApi.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ${translations.btnTestConnection}`;
    }
    
    const btnCancelSettings = document.getElementById('btn-cancel-settings');
    if (btnCancelSettings) btnCancelSettings.textContent = translations.btnCancel;
    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) btnSaveSettings.textContent = translations.btnSave;
    
    // History Panel
    const historyHeader = document.querySelector('.history-panel .settings-header-bar h3');
    if (historyHeader) historyHeader.textContent = translations.historyHeader;
    const btnClearHistory = document.getElementById('btn-clear-history');
    if (btnClearHistory) btnClearHistory.textContent = translations.btnClearHistory;
    
    // Batch & Schedule Panel
    if (btnBatchSchedule) btnBatchSchedule.setAttribute('title', translations.btnBatchScheduleTitle || 'Batch & Schedule');
    const batchHeader = document.getElementById('label-batch-header');
    if (batchHeader) batchHeader.textContent = translations.batchHeader || 'Batch & Schedule';

    const DRIVE_LOCALES = {
      'en': {
        selectedSource: 'Selected Source',
        schedulePreset: 'Schedule Preset',
        presetNow: '🚀 Now',
        presetTonight: '🌙 Tonight (11:00 PM)',
        presetWeekly: '📅 Weekly (Mon 9:00 AM)',
        advancedSettings: '⚙️ Advanced Settings',
        explorerTitle: 'Google Drive Explorer',
        loadingFiles: 'Loading files...',
        btnSelect: 'Select',
        btnChoose: '📁 Choose...',
        activeDocument: 'Active Document',
        promptPlaceholder: 'Input prompt that the agent will receive at scheduled time...'
      },
      'zh-TW': {
        selectedSource: '已選擇來源',
        schedulePreset: '排程預設',
        presetNow: '🚀 立即執行',
        presetTonight: '🌙 今晚 (11:00 PM)',
        presetWeekly: '📅 每週 (週一 9:00 AM)',
        advancedSettings: '⚙️ 進階設定',
        explorerTitle: 'Google 雲端硬碟瀏覽器',
        loadingFiles: '載入檔案中...',
        btnSelect: '選擇',
        btnChoose: '📁 選擇...',
        activeDocument: '目前文件',
        promptPlaceholder: '請輸入代理人在排程時間執行時所接收的提示詞指令...'
      },
      'zh-CN': {
        selectedSource: '已选择来源',
        schedulePreset: '日程预设',
        presetNow: '🚀 立即执行',
        presetTonight: '🌙 今晚 (11:00 PM)',
        presetWeekly: '📅 每周 (周一 9:00 AM)',
        advancedSettings: '⚙️ 高级设置',
        explorerTitle: 'Google 云端硬盘浏览器',
        loadingFiles: '正在加载文件...',
        btnSelect: '选择',
        btnChoose: '📁 选择...',
        activeDocument: '当前文档',
        promptPlaceholder: '请输入代理人在日程时间执行时所接收的提示词指令...'
      },
      'ja': {
        selectedSource: '選択されたソース',
        schedulePreset: 'スケジュールプリセット',
        presetNow: '🚀 今すぐ',
        presetTonight: '🌙 今夜 (23:00)',
        presetWeekly: '📅 毎週 (月曜 9:00 AM)',
        advancedSettings: '⚙️ 詳細設定',
        explorerTitle: 'Google ドライブエクスプローラー',
        loadingFiles: 'ファイルを読み込み中...',
        btnSelect: '選択',
        btnChoose: '📁 選択...',
        activeDocument: '現在ドキュメント',
        promptPlaceholder: 'スケジュール実行時にエージェントが受け取るプロンプトを入力してください...'
      },
      'ko': {
        selectedSource: '선택된 소스',
        schedulePreset: '일정 프리셋',
        presetNow: '🚀 지금 실행',
        presetTonight: '🌙 오늘 밤 (오후 11:00)',
        presetWeekly: '📅 매주 (월요일 오전 9:00)',
        advancedSettings: '⚙️ 고급 설정',
        explorerTitle: 'Google 드라이브 탐색기',
        loadingFiles: '파일 로ด 중...',
        btnSelect: '선택',
        btnChoose: '📁 선택...',
        activeDocument: '현재 문서',
        promptPlaceholder: '예약된 시간에 에이전트가 수신할 프롬프트를 입력하세요...'
      },
      'es': {
        selectedSource: 'Origen Seleccionado',
        schedulePreset: 'Preselección de Horario',
        presetNow: '🚀 Ahora',
        presetTonight: '🌙 Esta noche (11:00 PM)',
        presetWeekly: '📅 Semanal (Lun 9:00 AM)',
        advancedSettings: '⚙️ Configuración Avanzada',
        explorerTitle: 'Explorador de Google Drive',
        loadingFiles: 'Cargando archivos...',
        btnSelect: 'Seleccionar',
        btnChoose: '📁 Elegir...',
        activeDocument: 'Documento Activo',
        promptPlaceholder: 'Ingrese las instrucciones que el agente recibirá en el momento programado...'
      },
      'fr': {
        selectedSource: 'Source Sélectionnée',
        schedulePreset: 'Planification Prédéfinie',
        presetNow: '🚀 Maintenant',
        presetTonight: '🌙 Ce soir (23:00)',
        presetWeekly: '📅 Hebdomadaire (Lun 9h00)',
        advancedSettings: '⚙️ Paramètres Avancés',
        explorerTitle: 'Explorateur Google Drive',
        loadingFiles: 'Chargement des fichiers...',
        btnSelect: 'Sélectionner',
        btnChoose: '📁 Choisir...',
        activeDocument: 'Document Actif',
        promptPlaceholder: 'Saisissez les instructions que l\'agent recevra à l\'heure programmée...'
      },
      'de': {
        selectedSource: 'Ausgewählte Quelle',
        schedulePreset: 'Zeitplan-Voreinstellung',
        presetNow: '🚀 Jetzt',
        presetTonight: '🌙 Heute Nacht (23:00)',
        presetWeekly: '📅 Wöchentlich (Mo 9:00)',
        advancedSettings: '⚙️ Erweiterte Einstellungen',
        explorerTitle: 'Google Drive Explorer',
        loadingFiles: 'Dateien werden geladen...',
        btnSelect: 'Auswählen',
        btnChoose: '📁 Auswählen...',
        activeDocument: 'Aktives Dokument',
        promptPlaceholder: 'Geben Sie die Anweisungen ein, die der Agent zum geplanten Zeitpunkt erhält...'
      },
      'vi': {
        selectedSource: 'Nguồn Đã Chọn',
        schedulePreset: 'Lịch Trình Có Sẵn',
        presetNow: '🚀 Ngay bây giờ',
        presetTonight: '🌙 Tối nay (11:00 CH)',
        presetWeekly: '📅 Hàng tuần (T2 9:00 SA)',
        advancedSettings: '⚙️ Cài đặt Nâng cao',
        explorerTitle: 'Trình duyệt Google Drive',
        loadingFiles: 'Đang tải tệp...',
        btnSelect: 'Chọn',
        btnChoose: '📁 Chọn...',
        activeDocument: 'Tài liệu Hiện tại',
        promptPlaceholder: 'Nhập câu lệnh hướng dẫn mà tác nhân sẽ nhận vào thời gian lên lịch...'
      },
      'th': {
        selectedSource: 'แหล่งข้อมูลที่เลือก',
        schedulePreset: 'กำหนดเวลาล่วงหน้า',
        presetNow: '🚀 ตอนนี้',
        presetTonight: '🌙 คืนนี้ (23:00 น.)',
        presetWeekly: '📅 ทุกสัปดาห์ (จันทร์ 9:00 น.)',
        advancedSettings: '⚙️ ตั้งค่าขั้นสูง',
        explorerTitle: 'เครื่องมือค้นหา Google Drive',
        loadingFiles: 'กำลังโหลดไฟล์...',
        btnSelect: 'เลือก',
        btnChoose: '📁 เลือก...',
        activeDocument: 'เอกสารปัจจุบัน',
        promptPlaceholder: 'กรอกคำสั่งที่เอเจนต์จะได้รับเมื่อถึงเวลาที่กำหนดไว้...'
      }
    };

    const driveTrans = DRIVE_LOCALES[lang] || DRIVE_LOCALES['en'];
    
    const labelSelectedSource = document.getElementById('label-selected-source');
    if (labelSelectedSource) labelSelectedSource.textContent = driveTrans.selectedSource;
    
    const labelBatchSchedulePreset = document.getElementById('label-batch-schedule-preset');
    if (labelBatchSchedulePreset) labelBatchSchedulePreset.textContent = driveTrans.schedulePreset;
    
    const btnPresetNow = document.getElementById('btn-preset-now');
    if (btnPresetNow) btnPresetNow.textContent = driveTrans.presetNow;
    const btnPresetTonight = document.getElementById('btn-preset-tonight');
    if (btnPresetTonight) btnPresetTonight.textContent = driveTrans.presetTonight;
    const btnPresetWeekly = document.getElementById('btn-preset-weekly');
    if (btnPresetWeekly) btnPresetWeekly.textContent = driveTrans.presetWeekly;
    
    const labelAdvancedSettings = document.getElementById('label-advanced-settings');
    if (labelAdvancedSettings) labelAdvancedSettings.textContent = driveTrans.advancedSettings;
    
    const labelExplorerTitle = document.getElementById('label-explorer-title');
    if (labelExplorerTitle) labelExplorerTitle.textContent = driveTrans.explorerTitle;
    
    const labelLoadingFiles = document.getElementById('label-loading-files');
    if (labelLoadingFiles) labelLoadingFiles.textContent = driveTrans.loadingFiles;
    
    const btnCancelExplorerEl = document.getElementById('btn-cancel-explorer');
    if (btnCancelExplorerEl) btnCancelExplorerEl.textContent = translations.btnCancel || 'Cancel';
    const btnSelectExplorerEl = document.getElementById('btn-select-explorer');
    if (btnSelectExplorerEl) btnSelectExplorerEl.textContent = driveTrans.btnSelect;
    
    const btnChangeTargetEl = document.getElementById('btn-change-target');
    if (btnChangeTargetEl) btnChangeTargetEl.textContent = driveTrans.btnChoose;

    const labelFolderDetected = document.getElementById('label-folder-detected');
    if (labelFolderDetected) {
      labelFolderDetected.textContent = lang === 'zh-TW' ? '偵測到 Google 雲端硬碟資料夾' :
                                       lang === 'zh-CN' ? '检测到 Google 云端硬盘文件夹' :
                                       lang === 'ja' ? 'Google ドライブのフォルダが検出されました' :
                                       lang === 'ko' ? 'Google 드라이브 폴더 감지됨' :
                                       'Google Drive Folder Detected';
    }
    const btnTranslateDetectedFolderEl = document.getElementById('btn-translate-detected-folder');
    if (btnTranslateDetectedFolderEl) {
      btnTranslateDetectedFolderEl.textContent = lang === 'zh-TW' ? '📁 翻譯資料夾' :
                                                 lang === 'zh-CN' ? '📁 翻译文件夹' :
                                                 lang === 'ja' ? '📁 フォルダを翻訳' :
                                                 lang === 'ko' ? '📁 폴더 번역' :
                                                 '📁 Translate Folder';
    }
    
    if (batchTriggerPrompt) {
      batchTriggerPrompt.placeholder = driveTrans.promptPlaceholder;
    }

    // Update selected target text if it matches current document/presentation default text
    if (!hasManuallySelectedTarget) {
      selectedTargetName = (currentFileType === 'document') ? (driveTrans.activeDocument || translations.activeDocument) :
                           (currentFileType === 'spreadsheet') ? translations.activeSheet :
                           (currentFileType === 'form') ? translations.activeForm :
                           translations.activePresentation;
      if (batchSelectedTargetName) batchSelectedTargetName.textContent = selectedTargetName;
    }

    const labelBatchSec1 = document.getElementById('label-batch-sec1');
    if (labelBatchSec1) labelBatchSec1.textContent = translations.batchSec1 || '1. Select Workspace Files';
    const labelBatchSec2 = document.getElementById('label-batch-sec2');
    if (labelBatchSec2) labelBatchSec2.textContent = translations.batchSec2 || '2. Output Destination';
    const labelBatchSec3 = document.getElementById('label-batch-sec3');
    if (labelBatchSec3) labelBatchSec3.textContent = translations.batchSec3 || '3. Translation Target Languages';
    const labelBatchSec4 = document.getElementById('label-batch-sec4');
    if (labelBatchSec4) labelBatchSec4.textContent = translations.batchSec4 || '4. Schedule Setting';
    const labelBatchSec5 = document.getElementById('label-batch-sec5');
    if (labelBatchSec5) labelBatchSec5.textContent = translations.batchSec5 || 'Active Schedules & Jobs';
    
    const labelBatchSourceType = document.getElementById('label-batch-source-type');
    if (labelBatchSourceType) labelBatchSourceType.textContent = translations.batchSourceType || 'Source Type';
    const optBatchCurrent = document.getElementById('opt-batch-current');
    if (optBatchCurrent) optBatchCurrent.textContent = translations.optBatchCurrent || 'Current Document/Presentation';
    const optBatchFolder = document.getElementById('opt-batch-folder');
    if (optBatchFolder) optBatchFolder.textContent = translations.optBatchFolder || 'Google Drive Folder';
    const labelBatchFolderId = document.getElementById('label-batch-folder-id');
    if (labelBatchFolderId) labelBatchFolderId.textContent = translations.batchFolderId || 'Drive Folder ID';
    const hintBatchFolderId = document.getElementById('hint-batch-folder-id');
    if (hintBatchFolderId) hintBatchFolderId.textContent = translations.hintBatchFolderId || 'Files in this folder will be processed sequentially';
    
    const labelBatchOutputMode = document.getElementById('label-batch-output-mode');
    if (labelBatchOutputMode) labelBatchOutputMode.textContent = translations.batchOutputMode || 'Save Mode';
    const optOutputSame = document.getElementById('opt-output-same');
    if (optOutputSame) optOutputSame.textContent = translations.optOutputSame || 'Same Folder as Original';
    const optOutputSubfolder = document.getElementById('opt-output-subfolder');
    if (optOutputSubfolder) optOutputSubfolder.textContent = translations.optOutputSubfolder || 'Create Subfolder (e.g. [Translated])';
    const optOutputTarget = document.getElementById('opt-output-target');
    if (optOutputTarget) optOutputTarget.textContent = translations.optOutputTarget || 'Specify Central Folder ID';
    const labelBatchTargetFolderId = document.getElementById('label-batch-target-folder-id');
    if (labelBatchTargetFolderId) labelBatchTargetFolderId.textContent = translations.batchTargetFolderId || 'Target Folder ID';

    const labelBatchLangs = document.getElementById('label-batch-langs');
    if (labelBatchLangs) labelBatchLangs.textContent = translations.batchLangs || 'Select Languages (Multi-select)';

    const labelBatchFreq = document.getElementById('label-batch-freq');
    if (labelBatchFreq) labelBatchFreq.textContent = translations.batchFreq || 'Repeat Frequency';
    const btnFreqOnce = document.getElementById('btn-freq-once');
    if (btnFreqOnce) btnFreqOnce.textContent = translations.freqOnce || 'One-Time';
    const btnFreqMinute = document.getElementById('btn-freq-minute');
    if (btnFreqMinute) btnFreqMinute.textContent = translations.freqMinute || 'Minutes';
    const btnFreqHour = document.getElementById('btn-freq-hour');
    if (btnFreqHour) btnFreqHour.textContent = translations.freqHour || 'Hours';
    const btnFreqDaily = document.getElementById('btn-freq-daily');
    if (btnFreqDaily) btnFreqDaily.textContent = translations.freqDaily || 'Daily';
    const btnFreqWeekly = document.getElementById('btn-freq-weekly');
    if (btnFreqWeekly) btnFreqWeekly.textContent = translations.freqWeekly || 'Weekly';
    const btnFreqMonthly = document.getElementById('btn-freq-monthly');
    if (btnFreqMonthly) btnFreqMonthly.textContent = translations.freqMonthly || 'Monthly';

    const labelScheduleInterval = document.getElementById('label-schedule-interval');
    if (labelScheduleInterval) labelScheduleInterval.textContent = translations.scheduleInterval || 'Interval Value';
    const hintScheduleInterval = document.getElementById('hint-schedule-interval');
    if (hintScheduleInterval) {
      hintScheduleInterval.textContent = selectedFrequency === 'minute' ? 
        (translations.hintScheduleIntervalMinute || 'Run every N minutes') : 
        (translations.hintScheduleIntervalHour || 'Run every N hours');
    }

    const labelScheduleTime = document.getElementById('label-schedule-time');
    if (labelScheduleTime) labelScheduleTime.textContent = translations.scheduleTime || 'Start Time';
    const labelScheduleTimezone = document.getElementById('label-schedule-timezone');
    if (labelScheduleTimezone) labelScheduleTimezone.textContent = translations.scheduleTimezone || 'Timezone';

    const labelBatchPrompt = document.getElementById('label-batch-prompt');
    if (labelBatchPrompt) labelBatchPrompt.textContent = translations.batchPrompt || 'Trigger Prompt (Custom instructions)';
    const hintBatchPrompt = document.getElementById('hint-batch-prompt');
    if (hintBatchPrompt) hintBatchPrompt.textContent = translations.hintBatchPrompt || 'e.g. \'Use professional tone. Leave product names untranslated.\'';
    
    if (btnCancelBatch) btnCancelBatch.textContent = translations.btnCancel || 'Cancel';
    if (btnSaveBatch) btnSaveBatch.textContent = translations.btnSaveBatch || 'Add Schedule';
    
    // Reload Status Badge to apply current language immediately
    chrome.storage.local.get('apiKeyStatus', (items) => {
      updateStatusBadge(items.apiKeyStatus || 'unverified');
    });

    // Translate format validation indicator
    validateApiKey();

    // Translate connection test result message if present
    const testResultMsg = document.getElementById('test-result-msg');
    if (testResultMsg && testResultMsg.dataset.code) {
      const code = testResultMsg.dataset.code;
      const paramsStr = testResultMsg.dataset.params;
      const suggestionCode = testResultMsg.dataset.suggestionCode;
      
      let template = translations[code] || testResultMsg.dataset.fallbackMessage;
      if (paramsStr) {
        try {
          const params = JSON.parse(paramsStr);
          for (const [k, v] of Object.entries(params)) {
            template = template.replace(`{${k}}`, v);
          }
        } catch(e) {}
      }
      
      let suggestion = '';
      if (suggestionCode) {
        suggestion = translations[suggestionCode] || testResultMsg.dataset.fallbackSuggestion;
      } else {
        suggestion = testResultMsg.dataset.fallbackSuggestion;
      }
      
      testResultMsg.innerHTML = template + (suggestion ? `<br><span class="test-suggestion">${suggestion}</span>` : '');
    }

    // Translate the Show/Hide logs button text based on current visibility state
    if (btnToggleLogs && logConsoleContent) {
      const isHidden = logConsoleContent.classList.contains('hidden');
      btnToggleLogs.textContent = isHidden ? (translations.btnShow || 'Show') : (translations.btnHide || 'Hide');
    }
  }

  function updateStepLanguage(translations) {
    const stepCopySpan = document.querySelector('#step-copy span:not(.step-bullet)');
    if (stepCopySpan) {
      const typeTranslated = translations[currentFileType] || currentFileType;
      stepCopySpan.textContent = translations.stepCopy.replace('{type}', typeTranslated);
    }
    const stepExtractSpan = document.querySelector('#step-extract span:not(.step-bullet)');
    if (stepExtractSpan) stepExtractSpan.textContent = translations.stepExtract;
    const stepApiSpan = document.querySelector('#step-api span:not(.step-bullet)');
    if (stepApiSpan) stepApiSpan.textContent = translations.stepApi;
    const stepWriteSpan = document.querySelector('#step-write span:not(.step-bullet)');
    if (stepWriteSpan) stepWriteSpan.textContent = translations.stepWrite;
  }
});
