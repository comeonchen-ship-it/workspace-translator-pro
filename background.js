import { translateTexts, logDebug } from './translate.js';

// Bundled OAuth 2.0 Client ID — users do not need to configure their own
const BUNDLED_CLIENT_ID = '770405736518-j64169msnu3npqh1p09k4rko4022c80f.apps.googleusercontent.com';

// Enable opening of Side Panel when clicking the extension action icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set Side Panel behavior:', error));

// Clean up any stale active or queued translation states on startup/reload
cleanUpStaleStates();

async function cleanUpStaleStates() {
  try {
    // 1. Reset active and queued task arrays
    await chrome.storage.local.set({ activeTranslationIds: [], queuedTranslations: [] });
    
    // 2. Scan and mark any unfinished task states as interrupted
    const allData = await chrome.storage.local.get(null);
    for (const key in allData) {
      if (key.startsWith('taskState_')) {
        const state = allData[key];
        if (state && state.step !== 'done' && !state.error) {
          state.step = 'error';
          state.pct = 0;
          state.error = 'Translation interrupted by browser or extension restart.';
          await chrome.storage.local.set({ [key]: state });
        }
      }
    }
  } catch (e) {
    console.error('Failed to clean up stale task states:', e);
  }
}

// Global state and helper functions to persist task states in chrome.storage.local
async function getTaskState(presentationId) {
  const key = `taskState_${presentationId}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

async function setTaskState(presentationId, state) {
  const key = `taskState_${presentationId}`;
  await chrome.storage.local.set({ [key]: state });
}

async function checkCancelledGlobal(presentationId) {
  const data = await chrome.storage.local.get('cancelledTasks');
  const cancelledTasks = data.cancelledTasks || [];
  if (cancelledTasks.includes(presentationId)) {
    throw new Error('Translation stopped by user.');
  }
}

async function registerTabMapping(tabId, presentationId) {
  try {
    const data = await chrome.storage.local.get('tabMappings');
    const tabMappings = data.tabMappings || {};
    tabMappings[tabId] = presentationId;
    await chrome.storage.local.set({ tabMappings });
  } catch (e) {
    // Ignore
  }
}

async function registerActiveCopy(presentationId, copyId, token) {
  try {
    const data = await chrome.storage.local.get('activeCopies');
    const copies = data.activeCopies || {};
    copies[presentationId] = { copyId, token };
    await chrome.storage.local.set({ activeCopies: copies });
  } catch (e) {
    // Ignore
  }
}

async function unregisterActiveCopy(presentationId) {
  try {
    const data = await chrome.storage.local.get('activeCopies');
    const copies = data.activeCopies || {};
    delete copies[presentationId];
    await chrome.storage.local.set({ activeCopies: copies });
  } catch (e) {
    // Ignore
  }
}

async function deleteGoogleFile(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  if (!response.ok && response.status !== 404) {
    const errText = await response.text();
    throw new Error(`Drive delete API error (${response.status}): ${errText}`);
  }
}

async function saveToHistory(copyId, title, fileType, url) {
  try {
    const data = await chrome.storage.local.get('completedTranslations');
    const list = data.completedTranslations || [];
    
    // Check if copyId is already in history to avoid duplication
    if (!list.some(item => item.presentationId === copyId)) {
      list.unshift({
        presentationId: copyId,
        originalTitle: title,
        fileType: fileType,
        url: url,
        timestamp: Date.now()
      });
      // Cap at 20 items
      if (list.length > 20) {
        list.pop();
      }
      await chrome.storage.local.set({ completedTranslations: list });
    }
  } catch (e) {
    // Ignore
  }
}

let activePort = null;
let activeViewPresentationId = null;

// Connection port listener to keep the Service Worker alive and push updates to Side Panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'translation-channel') {
    activePort = port;
    logDebug('Side panel connected to background via message port.');
    
    port.onMessage.addListener(async (message) => {
      if (message.action === 'ping') {
        try {
          port.postMessage({ type: 'pong' });
        } catch (err) {
          // Port might be closed
        }
        return;
      }

      if (message.action === 'registerView') {
        activeViewPresentationId = message.presentationId;
        logDebug(`Side panel registered to view presentation ID: ${activeViewPresentationId}`);
        
        // If there's an active or previous task for this presentation, send it immediately
        const taskState = await getTaskState(activeViewPresentationId);
        if (taskState) {
          try {
            port.postMessage({
              type: 'translationProgress',
              ...taskState
            });
          } catch (err) {
            // Port might be closed
          }
        }
      } else if (message.action === 'startTranslation') {
        const { presentationId, presentationTitle, fileType = 'presentation', targetLang, tabId, config } = message;
        logDebug(`Translation requested for presentation ID: ${presentationId} (${fileType}) via Tab ${tabId}`, presentationId);
        
        if (tabId) {
          registerTabMapping(tabId, presentationId);
        }
        
        const pushProgressToPort = (pid, state) => {
          if (activePort && activeViewPresentationId === pid) {
            try {
              activePort.postMessage({
                type: 'translationProgress',
                ...state
              });
            } catch (err) {
              logDebug(`Failed to push progress: ${err.message}`, pid);
            }
          }
        };

        requestTranslationStart(presentationId, presentationTitle, fileType, targetLang, config, pushProgressToPort);
      } else if (message.action === 'cancelTranslation') {
        const { presentationId } = message;
        logDebug(`Cancel request received for presentation ID: ${presentationId}`, presentationId);
        
        try {
          const data = await chrome.storage.local.get('cancelledTasks');
          const cancelledTasks = data.cancelledTasks || [];
          if (!cancelledTasks.includes(presentationId)) {
            cancelledTasks.push(presentationId);
            await chrome.storage.local.set({ cancelledTasks });
          }
        } catch (e) {
          logDebug(`Failed to save cancelled task status: ${e.message}`, presentationId);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      logDebug('Side panel port disconnected.');
      if (activePort === port) {
        activePort = null;
        activeViewPresentationId = null;
      }
    });
  }
});

// Settings update listener and History Sync listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'settingsUpdated') {
    logDebug('Extension settings were updated.');
  } else if (message.action === 'syncHistoryFiles') {
    logDebug('Initiating background sync for translated files in history...');
    
    (async () => {
      try {
        const token = await getAuthToken();
        const data = await chrome.storage.local.get('completedTranslations');
        const list = data.completedTranslations || [];
        
        if (list.length === 0) return;
        
        const updatedList = [];
        let listChanged = false;
        
        // Parallel check on Drive files
        await Promise.all(list.map(async (item) => {
          try {
            const url = `https://www.googleapis.com/drive/v3/files/${item.presentationId}?fields=id,trashed`;
            const res = await fetch(url, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (res.ok) {
              const fileInfo = await res.json();
              if (fileInfo.trashed) {
                await logDebug(`History sync: File ${item.presentationId} is trashed — removing from history.`, item.presentationId);
                listChanged = true;
                // Do NOT push — item is intentionally removed
              } else {
                updatedList.push(item);
              }
            } else if (res.status === 404) {
              // 404 = file confirmed non-existent; safe to remove
              await logDebug(`History sync: File ${item.presentationId} returned 404 (not found) — removing from history.`, item.presentationId);
              listChanged = true;
              // Do NOT push — file is gone
            } else {
              // 403 = Forbidden (token scope issue / Drive rate-limit / temporary error)
              // Any other non-OK status = transient error
              // NEVER remove history entries on ambiguous errors — keep them safe
              await logDebug(`History sync: File ${item.presentationId} returned ${res.status} — keeping in history (may be a permission or network issue, not a deletion).`, item.presentationId);
              updatedList.push(item);
            }
          } catch (err) {
            // Network error — keep item; don't delete on connectivity failure
            updatedList.push(item);
          }
        }));
        
        // Safety guard: if sync would wipe ALL items, abort — this strongly suggests
        // a token/auth issue rather than all files truly being deleted
        if (listChanged && updatedList.length === 0 && list.length > 1) {
          await logDebug(`History sync: Aborting — sync would delete ALL ${list.length} history items, which likely indicates a token or API issue, not actual file deletion.`);
          return;
        }
        
        if (listChanged) {
          updatedList.sort((a, b) => b.timestamp - a.timestamp);
          await chrome.storage.local.set({ completedTranslations: updatedList });
          
          // Notify popup active views to refresh history list
          chrome.runtime.sendMessage({ action: 'historyUpdated' }).catch(() => {});
        }
      } catch (err) {
        logDebug(`History sync failed: ${err.message}`);
      }
    })();
    return true;
  } else if (message.action === 'createBatchJob') {
    (async () => {
      try {
        const data = await chrome.storage.local.get('batchJobs');
        const batchJobs = data.batchJobs || {};
        batchJobs[message.job.id] = message.job;
        await chrome.storage.local.set({ batchJobs });
        await scheduleAlarmForJob(message.job);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (message.action === 'deleteBatchJob') {
    (async () => {
      const data = await chrome.storage.local.get('batchJobs');
      const batchJobs = data.batchJobs || {};
      const job = batchJobs[message.jobId];
      if (job) {
        delete batchJobs[message.jobId];
        await chrome.storage.local.set({ batchJobs });
        await chrome.alarms.clear(`batch_job_${message.jobId}`);
        await chrome.alarms.clear(`resume_job_${message.jobId}`);
      }
      sendResponse({ success: true });
    })();
    return true;
  } else if (message.action === 'pauseBatchJob') {
    (async () => {
      const data = await chrome.storage.local.get('batchJobs');
      const batchJobs = data.batchJobs || {};
      const job = batchJobs[message.jobId];
      if (job) {
        job.status = 'paused';
        await chrome.storage.local.set({ batchJobs });
        await chrome.alarms.clear(`batch_job_${message.jobId}`);
        await chrome.alarms.clear(`resume_job_${message.jobId}`);
      }
      sendResponse({ success: true });
    })();
    return true;
  } else if (message.action === 'resumeBatchJob') {
    (async () => {
      const data = await chrome.storage.local.get('batchJobs');
      const batchJobs = data.batchJobs || {};
      const job = batchJobs[message.jobId];
      if (job) {
        job.status = 'idle';
        await chrome.storage.local.set({ batchJobs });
        await scheduleAlarmForJob(job);
      }
      sendResponse({ success: true });
    })();
    return true;
  } else if (message.action === 'syncSchedules') {
    (async () => {
      const data = await chrome.storage.local.get('batchJobs');
      const jobs = Object.values(data.batchJobs || {});
      for (const job of jobs) {
        await scheduleAlarmForJob(job);
      }
      sendResponse({ success: true });
    })();
    return true;
  } else if (message.action === 'listDriveFolder') {
    (async () => {
      try {
        const token = await getAuthToken();
        const folderId = message.folderId || 'root';
        const url = `https://www.googleapis.com/drive/v3/files?q='${encodeURIComponent(folderId)}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&pageSize=200&orderBy=folder,name`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Google Drive API error: ${text}`);
        }
        const data = await res.json();
        sendResponse({ success: true, files: data.files || [] });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (message.action === 'getDriveFileMetadata') {
    (async () => {
      try {
        const token = await getAuthToken();
        const fileId = message.fileId;
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Google Drive API error: ${text}`);
        }
        const data = await res.json();
        sendResponse({ success: true, metadata: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

/**
 * Main translation workflow orchestration
 */
async function runTranslationWorkflow(presentationId, presentationTitle, fileType, targetLang, config, sendProgress, isBatch = false) {
  let copyId = null;
  config.presentationId = presentationId;
  
  const checkCancelled = async () => {
    await checkCancelledGlobal(presentationId);
  };
  
  try {
    const isDoc = fileType === 'document';
    const isSheet = fileType === 'spreadsheet';
    const isForm = fileType === 'form';
    const isSlide = fileType === 'presentation';

    let mimeType = 'application/vnd.google-apps.presentation';
    let fileTypeName = 'presentation';
    if (isDoc) {
      mimeType = 'application/vnd.google-apps.document';
      fileTypeName = 'document';
    } else if (isSheet) {
      mimeType = 'application/vnd.google-apps.spreadsheet';
      fileTypeName = 'spreadsheet';
    } else if (isForm) {
      mimeType = 'application/vnd.google-apps.form';
      fileTypeName = 'form';
    }

    await logDebug(`Starting translation workflow for ${fileTypeName}: "${presentationTitle}" (${presentationId})`, presentationId);
    await checkCancelled();
    
    // 1. Google OAuth Authentication
    sendProgress('copy', 10, 'Authenticating with Google...');
    await logDebug('Requesting Google OAuth token...', presentationId);
    const token = await getAuthToken();
    await logDebug('Google OAuth token acquired successfully.', presentationId);
    await checkCancelled();
    
    // 2. Duplicate Google Workspace file (Google Drive API)
    sendProgress('copy', 25, `Duplicating ${fileTypeName} on Google Drive...`);
    const originalName = (presentationTitle || `New ${fileTypeName}`).replace(/\.(pptx?|docx?|xlsx?)$/i, '');
    const LANG_LABELS = {
      'zh-TW': '繁體中文',
      'zh-CN': '简体中文',
      'en': 'English',
      'ja': '日本語',
      'ko': '한국어',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'vi': 'Tiếng Việt',
      'th': 'ไทย'
    };
    const langLabel = LANG_LABELS[targetLang] || targetLang;
    const translatedName = `[Translated - ${langLabel}] ${originalName}`;
    
    await logDebug(`Duplicating file. Source: ${presentationId}, Target name: "${translatedName}", MimeType: ${mimeType}`, presentationId);
    copyId = await duplicateGoogleFile(presentationId, translatedName, mimeType, token);
    await registerActiveCopy(presentationId, copyId, token);
    await checkCancelled();
    await logDebug(`File duplicated successfully. New File ID: ${copyId}`, presentationId);
    
    // Persist target language for the copy tab so that the sidebar preserves it when switching to the new tab
    await chrome.storage.local.set({ [`targetLang_${copyId}`]: targetLang });
    
    if (isSheet) {
      sendProgress('extract', 40, 'Extracting spreadsheet structure...');
      await checkCancelled();
      const editUrl = await translateSpreadsheet(copyId, targetLang, config, token, sendProgress);
      await unregisterActiveCopy(presentationId);
      await saveToHistory(copyId, translatedName, 'spreadsheet', editUrl);
      sendProgress('done', 100, `Opening translated spreadsheet!`, null, editUrl);
      if (!isBatch) {
        chrome.tabs.create({ url: editUrl });
      }
      return;
    }

    if (isForm) {
      sendProgress('extract', 40, 'Extracting form structure...');
      await checkCancelled();
      const editUrl = await translateForm(copyId, targetLang, config, token, sendProgress);
      await unregisterActiveCopy(presentationId);
      await saveToHistory(copyId, translatedName, 'form', editUrl);
      sendProgress('done', 100, `Opening translated form!`, null, editUrl);
      if (!isBatch) {
        chrome.tabs.create({ url: editUrl });
      }
      return;
    }

    // 3. Fetch copy details (Google Slides or Docs API)
    await checkCancelled();
    const uniqueTexts = new Set();
    
    if (isDoc) {
      sendProgress('extract', 40, 'Extracting document elements & text...');
      await logDebug('Fetching copy document structure...', presentationId);
      const doc = await getDocumentDetails(copyId, token);
      await logDebug(`Successfully fetched document. Title: "${doc.title}"`, presentationId);
      
      // 4. Traverse layout and extract unique translatable texts
      await logDebug('Traversing document body and extracting translatable text runs...', presentationId);
      const tables = [];
      if (doc.body && doc.body.content) {
        for (const el of doc.body.content) {
          if (el.table) {
            // Collect table start index AND dimensions for correct updateTableCellStyle API format
            tables.push({
              startIndex: el.startIndex,
              rowCount: el.table.rows,
              columnCount: el.table.columns
            });
          }
        }
        extractTextFromDocElements(doc.body.content, uniqueTexts);
      }
      config.tables = tables;
      // Traverse headers
      if (doc.headers) {
        for (const headerId in doc.headers) {
          if (doc.headers[headerId].content) {
            extractTextFromDocElements(doc.headers[headerId].content, uniqueTexts);
          }
        }
      }
      // Traverse footers
      if (doc.footers) {
        for (const footerId in doc.footers) {
          if (doc.footers[footerId].content) {
            extractTextFromDocElements(doc.footers[footerId].content, uniqueTexts);
          }
        }
      }
      // Traverse footnotes
      if (doc.footnotes) {
        for (const footnoteId in doc.footnotes) {
          if (doc.footnotes[footnoteId].content) {
            extractTextFromDocElements(doc.footnotes[footnoteId].content, uniqueTexts);
          }
        }
      }
    } else {
      sendProgress('extract', 40, 'Extracting layout elements & text...');
      await logDebug('Fetching copy presentation slide structure...', presentationId);
      const presentation = await getPresentationDetails(copyId, token);
      await logDebug(`Successfully fetched presentation. Total slides: ${presentation.slides ? presentation.slides.length : 0}`, presentationId);
      
      // 4. Traverse layout and extract unique translatable texts
      const pageTextMap = new Map(); // pageId -> Set of original texts on this page
      const shapeIdsWithText = new Set();
      await logDebug('Traversing elements and extracting translatable text runs...', presentationId);
      for (const slide of presentation.slides) {
        const slideId = slide.objectId;
        extractTextFromElements(slide.pageElements, pageTextMap, slideId, uniqueTexts, shapeIdsWithText);
        
        if (slide.slideProperties && slide.slideProperties.notesPage && slide.slideProperties.notesPage.pageElements) {
          const notesPageId = slide.slideProperties.notesPage.objectId;
          extractTextFromElements(slide.slideProperties.notesPage.pageElements, pageTextMap, notesPageId, uniqueTexts, shapeIdsWithText);
        }
      }
      // Keep a reference to pageTextMap in the config so we can access it below
      config.pageTextMap = pageTextMap;
      config.shapeIdsWithText = shapeIdsWithText;
    }
    
    const uniqueTextsArray = Array.from(uniqueTexts);
    await logDebug(`Extracted ${uniqueTextsArray.length} unique translatable texts.`, presentationId);
    
    const editUrl = isDoc 
      ? `https://docs.google.com/document/d/${copyId}/edit`
      : `https://docs.google.com/presentation/d/${copyId}/edit`;
      
    if (uniqueTextsArray.length === 0) {
      await logDebug('No translatable texts found. Finalizing copying process.', presentationId);
      sendProgress('done', 100, `No translatable text found. Opening copy...`);
      chrome.tabs.create({ url: editUrl });
      return;
    }
    
    await checkCancelled();

    // 5. Call Translation Engine
    sendProgress('translate', 60, `Translating texts using ${config.translationEngine.toUpperCase()}...`);
    const translationsMap = await translateTexts(uniqueTextsArray, targetLang, config);
    
    await checkCancelled();

    // 6. Generate replaceAllText requests
    sendProgress('write', 80, 'Applying translations and formatting preservation...');
    await logDebug('Generating batch replacement requests...', presentationId);
    const requests = [];
    
    if (isDoc) {
      // Sort unique texts longest-to-shortest to avoid partial sub-string replacements messing up subsequent matches
      const sortedTexts = uniqueTextsArray.sort((a, b) => b.length - a.length);
      for (const originalText of sortedTexts) {
        const translatedText = translationsMap.get(originalText);
        if (translatedText && translatedText !== originalText) {
          requests.push({
            replaceAllText: {
              containsText: {
                text: originalText,
                matchCase: true
              },
              replaceText: translatedText
            }
          });
        }
      }
      // Note: updateTableCellStyle is handled separately below as a best-effort step
    } else {
      const pageTextMap = config.pageTextMap;
      for (const [pageId, pageTexts] of pageTextMap.entries()) {
        const sortedTexts = Array.from(pageTexts).sort((a, b) => b.length - a.length);
        
        for (const originalText of sortedTexts) {
          const translatedText = translationsMap.get(originalText);
          if (translatedText && translatedText !== originalText) {
            requests.push({
              replaceAllText: {
                containsText: {
                  text: originalText,
                  matchCase: true
                },
                replaceText: translatedText,
                pageObjectIds: [pageId]
              }
            });
          }
        }
      }
    }
    
    await logDebug(`Generated ${requests.length} text replacement requests.`, presentationId);
    
    // 7. Write back to copy — text replacements first (critical path)
    if (requests.length > 0) {
      await logDebug(`Writing back translated text to ${fileTypeName} copy...`, presentationId);
      if (isDoc) {
        await updateDocument(copyId, requests, token);
      } else {
        await updatePresentation(copyId, requests, token);
      }
      await logDebug('Replacement batch updates completed successfully.', presentationId);
    } else {
      await logDebug('No translations needed writing back.', presentationId);
    }

    // 7b. Best-effort: Tighten table cell padding to preserve layout (runs separately so it never blocks translation)
    if (isDoc) {
      const tables = config.tables;
      if (tables && tables.length > 0) {
        const tableStyleRequests = tables.map(table => ({
          updateTableCellStyle: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation: { index: table.startIndex },
                rowIndex: 0,
                columnIndex: 0
              },
              rowSpan: table.rowCount,
              columnSpan: table.columnCount
            },
            tableCellStyle: {
              paddingTop: { magnitude: 3, unit: 'PT' },
              paddingBottom: { magnitude: 3, unit: 'PT' },
              paddingLeft: { magnitude: 5, unit: 'PT' },
              paddingRight: { magnitude: 5, unit: 'PT' }
            },
            fields: 'paddingTop,paddingBottom,paddingLeft,paddingRight'
          }
        }));
        try {
          await logDebug(`Tuning table cell padding for ${tables.length} tables (best-effort)...`, presentationId);
          await updateDocument(copyId, tableStyleRequests, token);
          await logDebug('Table cell padding tuning completed.', presentationId);
        } catch (tableStyleErr) {
          // Non-fatal: table style update failure does not affect text translation
          await logDebug(`Table padding tuning skipped (non-fatal): ${tableStyleErr.message}`, presentationId);
        }
      }
    }
    
    // 8. Open the translated copy in a new tab
    await logDebug('Translation process finished. Opening new tab.', presentationId);
    await unregisterActiveCopy(presentationId);
    await saveToHistory(copyId, translatedName, fileTypeName, editUrl);
    sendProgress('done', 100, `Opening translated ${fileTypeName}!`, null, editUrl);
    if (!isBatch) {
      chrome.tabs.create({ url: editUrl });
    }
    
  } catch (err) {
    await logDebug(`Error occurred during translation workflow: ${err.message}`, presentationId);
    console.error('Translation workflow failed:', err);
    
    // Clean up Google Drive copy if cancelled by user
    try {
      const data = await chrome.storage.local.get(['activeCopies', 'cancelledTasks']);
      const copies = data.activeCopies || {};
      const cancelledTasks = data.cancelledTasks || [];
      if (copies[presentationId] && cancelledTasks.includes(presentationId)) {
        const { copyId, token } = copies[presentationId];
        await logDebug(`User cancelled. Deleting Google Drive duplicated file: ${copyId}`, presentationId);
        await deleteGoogleFile(copyId, token);
      }
    } catch (cleanupErr) {
      await logDebug(`Failed to clean up aborted file: ${cleanupErr.message}`, presentationId);
    }
    await unregisterActiveCopy(presentationId);
    
    sendProgress('error', 0, null, err.message);
  }
}

/**
 * Retrieves OAuth token. Tries silent first, falls back to interactive login.
 */
async function getAuthToken() {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(BUNDLED_CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(redirectUrl)}&` +
    `response_type=token&` +
    `scope=${encodeURIComponent('https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/forms.body https://www.googleapis.com/auth/drive')}`;

  const runFlow = (interactive) => {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: interactive
      }, (redirectResultUrl) => {
        if (chrome.runtime.lastError || !redirectResultUrl) {
          const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : "OAuth authorization failed.";
          reject(new Error(err));
          return;
        }
        
        try {
          const url = new URL(redirectResultUrl);
          const params = new URLSearchParams(url.hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            resolve(token);
          } else {
            reject(new Error("Access token not found in authentication callback."));
          }
        } catch (e) {
          reject(new Error("Failed to parse authentication response."));
        }
      });
    });
  };

  try {
    // Try silently first (requires user has already authorized)
    return await runFlow(false);
  } catch (e) {
    console.log('Silent auth failed, opening interactive prompt...', e);
    // Open login dialog
    return await runFlow(true);
  }
}

/**
 * Copies Google Slide presentation (Google Drive API v3)
 */
async function duplicatePresentation(presentationId, newName, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${presentationId}/copy`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: newName,
      mimeType: 'application/vnd.google-apps.presentation'
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive copy API error (${response.status}): ${errText}`);
  }
  
  const file = await response.json();
  return file.id;
}

/**
 * Fetch Google Slide structure (Google Slides API v1)
 */
async function getPresentationDetails(presentationId, token) {
  const url = `https://slides.googleapis.com/v1/presentations/${presentationId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Slides get API error (${response.status}): ${errText}`);
  }
  
  return await response.json();
}

/**
 * Send batch update requests to edit presentation (Google Slides API v1)
 */
async function updatePresentation(presentationId, requests, token) {
  const url = `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: requests
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Slides batchUpdate API error (${response.status}): ${errText}`);
  }
  
  return await response.json();
}

/**
 * Recursively find all text structures in elements list
 */
function extractTextFromElements(elements, pageTextMap, pageId, uniqueTexts, shapeIdsWithText = null) {
  if (!elements) return;
  
  for (const element of elements) {
    if (element.shape && element.shape.text) {
      if (shapeIdsWithText && element.objectId) {
        shapeIdsWithText.add(element.objectId);
      }
      processTextContent(element.shape.text, pageTextMap, pageId, uniqueTexts);
    } else if (element.table) {
      for (const row of element.table.tableRows) {
        if (row.tableCells) {
          for (const cell of row.tableCells) {
            if (cell.text) {
              processTextContent(cell.text, pageTextMap, pageId, uniqueTexts);
            }
          }
        }
      }
    } else if (element.group && element.group.children) {
      extractTextFromElements(element.group.children, pageTextMap, pageId, uniqueTexts, shapeIdsWithText);
    }
  }
}

/**
 * Helper to process text contents of shapes/table cells
 */
function processTextContent(textContent, pageTextMap, pageId, uniqueTexts) {
  if (!textContent.textElements) return;
  
  const hasLink = textContent.textElements.some(el => el.textRun && el.textRun.style && el.textRun.style.link);
  
  if (hasLink) {
    for (const el of textContent.textElements) {
      if (el.textRun && el.textRun.content) {
        const content = el.textRun.content;
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && isTranslatable(trimmed)) {
            uniqueTexts.add(trimmed);
            if (!pageTextMap.has(pageId)) {
              pageTextMap.set(pageId, new Set());
            }
            pageTextMap.get(pageId).add(trimmed);
          }
        }
      }
    }
  } else {
    let fullText = "";
    for (const el of textContent.textElements) {
      if (el.textRun && el.textRun.content) {
        fullText += el.textRun.content;
      }
    }
    
    // Normalize carriage returns and split into separate lines (paragraphs)
    const lines = fullText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && isTranslatable(trimmed)) {
        uniqueTexts.add(trimmed);
        
        if (!pageTextMap.has(pageId)) {
          pageTextMap.set(pageId, new Set());
        }
        pageTextMap.get(pageId).add(trimmed);
      }
    }
  }
}

/**
 * Filter out untranslatable text runs (numbers, pure punctuation, symbols)
 */
function isTranslatable(text) {
  if (!text) return false;
  const trimmed = text.trim();
  // Skip raw URLs (e.g. http://..., https://..., www.example.com) to preserve links
  if (/^(https?:\/\/|www\.)\S+$/i.test(trimmed)) return false;
  // Skip email addresses
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) return false;
  // If it's purely digits and mathematical/date symbols, don't translate
  if (/^[0-9\s\-\.,:\+\*\/%$=()\[\]{}""'']+(\s*[am|pm|AM|PM]*)?$/.test(trimmed)) return false;
  // Ignore single characters that are not letters or Chinese characters
  if (trimmed.length <= 1 && !/[\u4e00-\u9fa5a-zA-Z]/.test(trimmed)) return false;
  return true;
}

/**
 * Generic copy function for Google Workspace files (Google Drive API v3)
 */
async function duplicateGoogleFile(fileId, newName, mimeType, token, targetParentFolderId = null) {
  // Fetch original file's parents so we can copy it into the same folder
  let parents = [];
  if (targetParentFolderId) {
    parents = [targetParentFolderId];
  } else {
    try {
      const getFileUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`;
      const getRes = await fetch(getFileUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (getRes.ok) {
        const fileMeta = await getRes.json();
        if (fileMeta.parents && fileMeta.parents.length > 0) {
          parents = fileMeta.parents;
        }
      }
    } catch (err) {
      console.error('Failed to fetch parents of original file:', err);
    }
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/copy`;
  
  const requestBody = {
    name: newName
  };
  
  if (parents && parents.length > 0) {
    requestBody.parents = parents;
  }
  
  // If the file is a Form, do NOT specify mimeType in the body because Google Drive copy API
  // returns 400 Bad Request (Forms are native-only and do not support format conversion parameters).
  if (mimeType && mimeType !== 'application/vnd.google-apps.form') {
    requestBody.mimeType = mimeType;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive copy API error (${response.status}): ${errText}`);
  }
  
  const file = await response.json();
  return file.id;
}

/**
 * Fetch Google Document structure (Google Docs API v1)
 */
async function getDocumentDetails(documentId, token) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Docs get API error (${response.status}): ${errText}`);
  }
  
  return await response.json();
}

/**
 * Send batch update requests to edit document (Google Docs API v1)
 */
async function updateDocument(documentId, requests, token) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: requests
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Docs batchUpdate API error (${response.status}): ${errText}`);
  }
  
  return await response.json();
}

/**
 * Recursively find all text structures in document elements list
 */
function extractTextFromDocElements(elements, uniqueTexts) {
  if (!elements) return;
  
  for (const element of elements) {
    if (element.paragraph) {
      processDocParagraph(element.paragraph, uniqueTexts);
    } else if (element.table) {
      for (const row of element.table.tableRows) {
        if (row.tableCells) {
          for (const cell of row.tableCells) {
            extractTextFromDocElements(cell.content, uniqueTexts);
          }
        }
      }
    } else if (element.tableOfContents) {
      extractTextFromDocElements(element.tableOfContents.content, uniqueTexts);
    }
  }
}

/**
 * Helper to process text contents of doc paragraphs
 */
function processDocParagraph(paragraph, uniqueTexts) {
  if (!paragraph.elements) return;
  
  const hasLink = paragraph.elements.some(el => el.textRun && el.textRun.textStyle && el.textRun.textStyle.link);
  
  if (hasLink) {
    for (const el of paragraph.elements) {
      if (el.textRun && el.textRun.content) {
        const content = el.textRun.content;
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && isTranslatable(trimmed)) {
            uniqueTexts.add(trimmed);
          }
        }
      }
    }
  } else {
    let fullText = "";
    for (const el of paragraph.elements) {
      if (el.textRun && el.textRun.content) {
        fullText += el.textRun.content;
      }
    }
    
    // Normalize carriage returns and split into separate lines
    const lines = fullText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && isTranslatable(trimmed)) {
        uniqueTexts.add(trimmed);
      }
    }
  }
}

/**
 * Workflow to translate a duplicated Google Spreadsheet while preserving style and formulas
 */
async function translateSpreadsheet(copyId, targetLang, config, token, sendProgress) {
  const presentationId = config.presentationId;
  await checkCancelledGlobal(presentationId);
  await logDebug('Fetching spreadsheet details with grid data...', presentationId);
  
  const fields = 'sheets(properties(title,sheetId,gridProperties),data(rowData(values(userEnteredValue,textFormatRuns,formattedValue,hyperlink))))';
  const getSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${copyId}?includeGridData=true&fields=${encodeURIComponent(fields)}`;
  
  const response = await fetch(getSpreadsheetUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Sheets get API error (${response.status}): ${errText}`);
  }
  const spreadsheet = await response.json();
  const sheets = spreadsheet.sheets || [];
  await logDebug(`Spreadsheet fetched. Total sheets: ${sheets.length}`, presentationId);

  // 1. Extract translatable strings from cells (including hyperlinked labels in formulas and cell-level rich text)
  const uniqueTexts = new Set();
  const hyperlinkRegex = /^=HYPERLINK\(\s*(["'])(.*?)\1\s*,\s*(["'])(.*?)\3\s*\)$/i;

  for (const sheet of sheets) {
    const title = sheet.properties.title;
    if (isTranslatable(title.trim())) {
      uniqueTexts.add(title.trim());
    }
    
    const dataList = sheet.data || [];
    for (const gridData of dataList) {
      const rowData = gridData.rowData || [];
      for (const row of rowData) {
        const values = row.values || [];
        for (const cell of values) {
          const cellVal = cell.userEnteredValue;
          if (cellVal) {
            if (cellVal.stringValue) {
              const trimmed = cellVal.stringValue.trim();
              if (trimmed && isTranslatable(trimmed)) {
                uniqueTexts.add(trimmed);
              }
            } else if (cellVal.formulaValue) {
              const trimmed = cellVal.formulaValue.trim();
              if (trimmed && trimmed.startsWith('=')) {
                const match = trimmed.match(hyperlinkRegex);
                if (match) {
                  const label = match[4];
                  if (label && isTranslatable(label)) {
                    uniqueTexts.add(label.trim());
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const uniqueTextsArray = Array.from(uniqueTexts);
  await logDebug(`Extracted ${uniqueTextsArray.length} unique translatable spreadsheet texts (including titles).`, presentationId);

  await checkCancelledGlobal(presentationId);

  const editUrl = `https://docs.google.com/spreadsheets/d/${copyId}/edit`;
  if (uniqueTextsArray.length === 0) {
    await logDebug('No translatable cell texts found. Opening copy...', presentationId);
    return editUrl;
  }

  // 2. Translate via LLM API
  sendProgress('translate', 60, `Translating ${uniqueTextsArray.length} texts using ${config.translationEngine.toUpperCase()}...`);
  const translationsMap = await translateTexts(uniqueTextsArray, targetLang, config);

  await checkCancelledGlobal(presentationId);

  // 3. Compile cell value updates with preserved formatting/links
  sendProgress('write', 80, 'Preparing translated cell updates...');
  const updateRequests = [];

  for (const sheet of sheets) {
    const sheetId = sheet.properties.sheetId;
    const dataList = sheet.data || [];
    
    for (const gridData of dataList) {
      const rowData = gridData.rowData || [];
      for (let r = 0; r < rowData.length; r++) {
        const row = rowData[r];
        const values = row.values || [];
        for (let c = 0; c < values.length; c++) {
          const cell = values[c];
          const cellVal = cell.userEnteredValue;
          if (!cellVal) continue;
          
          let hasChanges = false;
          let newCellData = {};
          
          if (cellVal.stringValue) {
            const trimmed = cellVal.stringValue.trim();
            if (trimmed) {
              const translated = translationsMap.get(trimmed);
              if (translated && translated !== trimmed) {
                newCellData.userEnteredValue = { stringValue: translated };
                hasChanges = true;
                
                // Adjust textFormatRuns to match the new translated text length
                if (cell.textFormatRuns && cell.textFormatRuns.length > 0) {
                  const originalTextLength = cellVal.stringValue.length;
                  const newTextLength = translated.length;
                  
                  newCellData.textFormatRuns = cell.textFormatRuns
                    .map(run => {
                      const newRun = { ...run };
                      if (run.startIndex > 0 && originalTextLength > 0) {
                        newRun.startIndex = Math.min(
                          newTextLength,
                          Math.round((run.startIndex / originalTextLength) * newTextLength)
                        );
                      } else {
                        newRun.startIndex = 0;
                      }
                      return newRun;
                    })
                    .filter(run => run.startIndex < newTextLength);
                  
                  if (newCellData.textFormatRuns.length === 0) {
                    delete newCellData.textFormatRuns;
                  }
                } else if (cell.hyperlink) {
                  // Fallback: If cell has a cell-level hyperlink, preserve it as a format run
                  newCellData.textFormatRuns = [
                    {
                      startIndex: 0,
                      format: {
                        link: {
                          uri: cell.hyperlink
                        }
                      }
                    }
                  ];
                }
              }
            }
          } else if (cellVal.formulaValue) {
            const trimmed = cellVal.formulaValue.trim();
            if (trimmed && trimmed.startsWith('=')) {
              const match = trimmed.match(hyperlinkRegex);
              if (match) {
                const quoteUrl = match[1];
                const url = match[2];
                const quoteLabel = match[3];
                const label = match[4];
                const translatedLabel = translationsMap.get(label.trim()) || label;
                if (translatedLabel !== label) {
                  newCellData.userEnteredValue = {
                    formulaValue: `=HYPERLINK(${quoteUrl}${url}${quoteUrl}, ${quoteLabel}${translatedLabel}${quoteLabel})`
                  };
                  hasChanges = true;
                }
              }
            }
          }
          
          if (hasChanges) {
            updateRequests.push({
              updateCells: {
                rows: [
                  {
                    values: [newCellData]
                  }
                ],
                fields: newCellData.textFormatRuns ? 'userEnteredValue,textFormatRuns' : 'userEnteredValue',
                range: {
                  sheetId: sheetId,
                  startRowIndex: r,
                  endRowIndex: r + 1,
                  startColumnIndex: c,
                  endColumnIndex: c + 1
                }
              }
            });
          }
        }
      }
    }
  }

  // 4. Renaming sheet tabs & auto-resizing columns
  sendProgress('write', 90, 'Applying translations to tabs & auto-resizing columns...');
  const sheetsRequests = [];
  for (const sheet of sheets) {
    const oldTitle = sheet.properties.title;
    const translatedTitle = translationsMap.get(oldTitle.trim());
    if (translatedTitle && translatedTitle !== oldTitle) {
      sheetsRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: sheet.properties.sheetId,
            title: translatedTitle
          },
          fields: 'title'
        }
      });
    }
    
    // Auto-resize all columns to fit the new translated text neatly
    const colCount = sheet.properties.gridProperties?.columnCount || 26;
    sheetsRequests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheet.properties.sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: colCount
        }
      }
    });
  }

  const allRequests = [...updateRequests, ...sheetsRequests];

  if (allRequests.length > 0) {
    await logDebug(`Applying ${allRequests.length} spreadsheet batch update requests...`, presentationId);
    const updateSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${copyId}:batchUpdate`;
    const res = await fetch(updateSpreadsheetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests: allRequests })
    });
    if (!res.ok) {
      const errText = await res.text();
      await logDebug(`Error applying spreadsheet updates: ${errText}`, presentationId);
      throw new Error(`Sheets batchUpdate API error (${res.status}): ${errText}`);
    }
    await logDebug('Spreadsheet batch updates completed successfully.', presentationId);
  } else {
    await logDebug('No spreadsheet updates needed.', presentationId);
  }

  return editUrl;
}

/**
 * Helper to normalize whitespace and newlines for reliable map lookup
 */
function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/**
 * Workflow to translate a duplicated Google Form
 */
async function translateForm(copyId, targetLang, config, token, sendProgress) {
  const presentationId = config.presentationId;
  await checkCancelledGlobal(presentationId);
  await logDebug('Fetching form details...', presentationId);
  const getFormUrl = `https://forms.googleapis.com/v1/forms/${copyId}`;
  const response = await fetch(getFormUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Forms get API error (${response.status}): ${errText}`);
  }
  const form = await response.json();
  
  // 1. Extract translatable texts
  await logDebug('Extracting form questions & content...', presentationId);
  const uniqueTexts = new Set();
  
  if (form.info) {
    if (form.info.title && isTranslatable(normalizeText(form.info.title))) {
      uniqueTexts.add(normalizeText(form.info.title));
    }
    if (form.info.description && isTranslatable(normalizeText(form.info.description))) {
      uniqueTexts.add(normalizeText(form.info.description));
    }
  }

  // Optimization: Extract Form Confirmation submission settings message
  if (form.settings && form.settings.submissionSettings && form.settings.submissionSettings.confirmationMessage) {
    const confMsg = form.settings.submissionSettings.confirmationMessage.value;
    if (confMsg && isTranslatable(normalizeText(confMsg))) {
      uniqueTexts.add(normalizeText(confMsg));
    }
  }

  const items = form.items || [];
  for (const item of items) {
    if (item.title && isTranslatable(normalizeText(item.title))) {
      uniqueTexts.add(normalizeText(item.title));
    }
    if (item.description && isTranslatable(normalizeText(item.description))) {
      uniqueTexts.add(normalizeText(item.description));
    }
    
    if (item.questionItem && item.questionItem.question) {
      const q = item.questionItem.question;
      if (q.choiceQuestion && q.choiceQuestion.options) {
        for (const opt of q.choiceQuestion.options) {
          if (opt.value && isTranslatable(normalizeText(opt.value))) {
            uniqueTexts.add(normalizeText(opt.value));
          }
        }
      }
      if (q.scaleQuestion) {
        if (q.scaleQuestion.lowLabel && isTranslatable(normalizeText(q.scaleQuestion.lowLabel))) {
          uniqueTexts.add(normalizeText(q.scaleQuestion.lowLabel));
        }
        if (q.scaleQuestion.highLabel && isTranslatable(normalizeText(q.scaleQuestion.highLabel))) {
          uniqueTexts.add(normalizeText(q.scaleQuestion.highLabel));
        }
      }
    }

    if (item.questionGroupItem) {
      const qg = item.questionGroupItem;
      if (qg.questions) {
        for (const q of qg.questions) {
          if (q.rowQuestion && q.rowQuestion.title && isTranslatable(normalizeText(q.rowQuestion.title))) {
            uniqueTexts.add(normalizeText(q.rowQuestion.title));
          }
        }
      }
      if (qg.grid && qg.grid.columns && qg.grid.columns.options) {
        for (const opt of qg.grid.columns.options) {
          if (opt.value && isTranslatable(normalizeText(opt.value))) {
            uniqueTexts.add(normalizeText(opt.value));
          }
        }
      }
    }
  }

  const uniqueTextsArray = Array.from(uniqueTexts);
  await logDebug(`Extracted ${uniqueTextsArray.length} unique translatable form elements.`, presentationId);

  await checkCancelledGlobal(presentationId);

  const editUrl = `https://docs.google.com/forms/d/${copyId}/edit`;
  if (uniqueTextsArray.length === 0) {
    await logDebug('No translatable form elements found.', presentationId);
    return editUrl;
  }

  // 2. Translate via LLM API
  sendProgress('translate', 60, `Translating ${uniqueTextsArray.length} texts using ${config.translationEngine.toUpperCase()}...`);
  const translationsMap = await translateTexts(uniqueTextsArray, targetLang, config);

  await checkCancelledGlobal(presentationId);

  // 3. Generate Form Update requests
  sendProgress('write', 80, 'Applying translations to form structure...');
  const requests = [];

  if (form.info) {
    const originalTitle = form.info.title || "";
    const originalDesc = form.info.description || "";
    const normTitle = normalizeText(originalTitle);
    const normDesc = normalizeText(originalDesc);
    const translatedTitle = translationsMap.get(normTitle) || originalTitle;
    const translatedDesc = translationsMap.get(normDesc) || originalDesc;
    
    if (translatedTitle !== originalTitle || translatedDesc !== originalDesc) {
      requests.push({
        updateFormInfo: {
          info: {
            title: translatedTitle,
            description: translatedDesc
          },
          updateMask: 'title,description'
        }
      });
    }
  }

  // Optimization: Update Form Confirmation submission settings message
  if (form.settings && form.settings.submissionSettings && form.settings.submissionSettings.confirmationMessage) {
    const originalMsg = form.settings.submissionSettings.confirmationMessage.value || "";
    const normMsg = normalizeText(originalMsg);
    const translatedMsg = translationsMap.get(normMsg) || originalMsg;
    if (translatedMsg !== originalMsg) {
      requests.push({
        updateSettings: {
          settings: {
            submissionSettings: {
              confirmationMessage: {
                value: translatedMsg
              }
            }
          },
          updateMask: 'submissionSettings.confirmationMessage'
        }
      });
    }
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const updatedItem = JSON.parse(JSON.stringify(item));
    let itemChanged = false;

    if (updatedItem.title) {
      const norm = normalizeText(updatedItem.title);
      const trans = translationsMap.get(norm);
      if (trans && trans !== updatedItem.title) {
        updatedItem.title = trans;
        itemChanged = true;
      }
    }
    if (updatedItem.description) {
      const norm = normalizeText(updatedItem.description);
      const trans = translationsMap.get(norm);
      if (trans && trans !== updatedItem.description) {
        updatedItem.description = trans;
        itemChanged = true;
      }
    }

    if (updatedItem.questionItem && updatedItem.questionItem.question) {
      const q = updatedItem.questionItem.question;
      if (q.choiceQuestion && q.choiceQuestion.options) {
        for (let o = 0; o < q.choiceQuestion.options.length; o++) {
          const opt = q.choiceQuestion.options[o];
          if (opt.value) {
            const norm = normalizeText(opt.value);
            const trans = translationsMap.get(norm);
            if (trans && trans !== opt.value) {
              opt.value = trans;
              itemChanged = true;
            }
          }
        }
      }
      if (q.grading && q.grading.correctAnswers && q.grading.correctAnswers.answers) {
        for (let a = 0; a < q.grading.correctAnswers.answers.length; a++) {
          const ans = q.grading.correctAnswers.answers[a];
          if (ans.value) {
            const norm = normalizeText(ans.value);
            const trans = translationsMap.get(norm);
            if (trans && trans !== ans.value) {
              ans.value = trans;
              itemChanged = true;
            }
          }
        }
      }
      if (q.scaleQuestion) {
        if (q.scaleQuestion.lowLabel) {
          const norm = normalizeText(q.scaleQuestion.lowLabel);
          const trans = translationsMap.get(norm);
          if (trans && trans !== q.scaleQuestion.lowLabel) {
            q.scaleQuestion.lowLabel = trans;
            itemChanged = true;
          }
        }
        if (q.scaleQuestion.highLabel) {
          const norm = normalizeText(q.scaleQuestion.highLabel);
          const trans = translationsMap.get(norm);
          if (trans && trans !== q.scaleQuestion.highLabel) {
            q.scaleQuestion.highLabel = trans;
            itemChanged = true;
          }
        }
      }
    }

    if (updatedItem.questionGroupItem) {
      const qg = updatedItem.questionGroupItem;
      if (qg.questions) {
        for (let qi = 0; qi < qg.questions.length; qi++) {
          const q = qg.questions[qi];
          if (q.rowQuestion && q.rowQuestion.title) {
            const norm = normalizeText(q.rowQuestion.title);
            const trans = translationsMap.get(norm);
            if (trans && trans !== q.rowQuestion.title) {
              q.rowQuestion.title = trans;
              itemChanged = true;
            }
          }
          if (q.grading && q.grading.correctAnswers && q.grading.correctAnswers.answers) {
            for (let a = 0; a < q.grading.correctAnswers.answers.length; a++) {
              const ans = q.grading.correctAnswers.answers[a];
              if (ans.value) {
                const norm = normalizeText(ans.value);
                const trans = translationsMap.get(norm);
                if (trans && trans !== ans.value) {
                  ans.value = trans;
                  itemChanged = true;
                }
              }
            }
          }
        }
      }
      if (qg.grid && qg.grid.columns && qg.grid.columns.options) {
        for (let o = 0; o < qg.grid.columns.options.length; o++) {
          const opt = qg.grid.columns.options[o];
          if (opt.value) {
            const norm = normalizeText(opt.value);
            const trans = translationsMap.get(norm);
            if (trans && trans !== opt.value) {
              opt.value = trans;
              itemChanged = true;
            }
          }
        }
      }
    }

    if (itemChanged) {
      // Helper to prepare 'image' fields for writing back by converting read-only contentUri
      // to write-only sourceUri, which prevents Forms API 400 validation errors while preserving the images.
      const prepareImageFieldsForWrite = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(prepareImageFieldsForWrite);
        } else {
          if ('image' in obj && obj.image && typeof obj.image === 'object') {
            const img = obj.image;
            if (img.contentUri) {
              img.sourceUri = img.contentUri;
              delete img.contentUri;
            } else if (!img.sourceUri) {
              delete obj.image;
            }
          }
          for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
              if (key === 'image') continue; // Already processed
              prepareImageFieldsForWrite(obj[key]);
            }
          }
        }
      };
      prepareImageFieldsForWrite(updatedItem);

      let maskFields = ['title', 'description'];
      if (updatedItem.questionItem) {
        maskFields.push('questionItem.question');
      }
      if (updatedItem.questionGroupItem) {
        maskFields.push('questionGroupItem.questions');
        maskFields.push('questionGroupItem.grid');
      }
      
      requests.push({
        updateItem: {
          item: updatedItem,
          location: {
            index: idx
          },
          updateMask: maskFields.join(',')
        }
      });
    }
  }

  await checkCancelledGlobal(presentationId);

  if (requests.length > 0) {
    await logDebug(`Applying ${requests.length} batch updates to form...`, presentationId);
    const updateFormUrl = `https://forms.googleapis.com/v1/forms/${copyId}:batchUpdate`;
    const writeRes = await fetch(updateFormUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: requests
      })
    });
    if (!writeRes.ok) {
      const errText = await writeRes.text();
      throw new Error(`Forms batchUpdate API error (${writeRes.status}): ${errText}`);
    }
    await logDebug('Translated form content written back successfully.', presentationId);
  } else {
    await logDebug('No form updates needed.', presentationId);
  }

  return editUrl;
}

/**
 * Enterprise-Grade Global Concurrency Queue Management
 */
const MAX_CONCURRENT_TRANSLATIONS = 2;

async function getQueueState() {
  const data = await chrome.storage.local.get(['activeTranslationIds', 'queuedTranslations']);
  return {
    activeTranslationIds: data.activeTranslationIds || [],
    queuedTranslations: data.queuedTranslations || []
  };
}

async function saveQueueState(activeTranslationIds, queuedTranslations) {
  await chrome.storage.local.set({ activeTranslationIds, queuedTranslations });
}

async function requestTranslationStart(presentationId, presentationTitle, fileType, targetLang, config, portMessageSender) {
  const { activeTranslationIds, queuedTranslations } = await getQueueState();
  
  if (activeTranslationIds.includes(presentationId)) {
    await logDebug('Task already active, ignoring request.', presentationId);
    return;
  }
  
  if (queuedTranslations.some(t => t.presentationId === presentationId)) {
    await logDebug('Task already in queue, ignoring request.', presentationId);
    return;
  }
  
  if (activeTranslationIds.length < MAX_CONCURRENT_TRANSLATIONS) {
    activeTranslationIds.push(presentationId);
    await saveQueueState(activeTranslationIds, queuedTranslations);
    await logDebug(`Concurrency Slot Available (${activeTranslationIds.length}/${MAX_CONCURRENT_TRANSLATIONS}). Starting instantly...`, presentationId);
    
    triggerTranslation(presentationId, presentationTitle, fileType, targetLang, config, portMessageSender);
  } else {
    const task = { presentationId, presentationTitle, fileType, targetLang, config };
    queuedTranslations.push(task);
    await saveQueueState(activeTranslationIds, queuedTranslations);
    
    const queuePos = queuedTranslations.length;
    await logDebug(`Concurrency Limit Reached (${activeTranslationIds.length}/${MAX_CONCURRENT_TRANSLATIONS}). Task queued at position #${queuePos}.`, presentationId);
    
    const taskState = {
      step: 'queue',
      pct: 0,
      status: `Waiting in queue (Position: #${queuePos})...`,
      error: null,
      finalUrl: null
    };
    await setTaskState(presentationId, taskState);
    if (portMessageSender) {
      portMessageSender(presentationId, taskState);
    }
  }
}

async function onTranslationFinished(presentationId, portMessageSender) {
  try {
    const data = await chrome.storage.local.get('cancelledTasks');
    let cancelledTasks = data.cancelledTasks || [];
    if (cancelledTasks.includes(presentationId)) {
      cancelledTasks = cancelledTasks.filter(id => id !== presentationId);
      await chrome.storage.local.set({ cancelledTasks });
    }
  } catch (e) {
    // Ignore
  }

  const { activeTranslationIds, queuedTranslations } = await getQueueState();
  
  const activeIdx = activeTranslationIds.indexOf(presentationId);
  if (activeIdx !== -1) {
    activeTranslationIds.splice(activeIdx, 1);
  }
  
  await logDebug(`Task finished. Releasing active slot. Active count: ${activeTranslationIds.length}`, presentationId);
  
  if (queuedTranslations.length > 0) {
    const nextTask = queuedTranslations.shift();
    activeTranslationIds.push(nextTask.presentationId);
    await saveQueueState(activeTranslationIds, queuedTranslations);
    
    // Shift positions for all remaining queued tasks
    for (let idx = 0; idx < queuedTranslations.length; idx++) {
      const qTask = queuedTranslations[idx];
      const qPos = idx + 1;
      const qState = {
        step: 'queue',
        pct: 0,
        status: `Waiting in queue (Position: #${qPos})...`,
        error: null,
        finalUrl: null
      };
      await setTaskState(qTask.presentationId, qState);
      if (portMessageSender) {
        portMessageSender(qTask.presentationId, qState);
      }
    }
    
    await logDebug(`Triggering next queued task from slot. Active count: ${activeTranslationIds.length}`, nextTask.presentationId);
    triggerTranslation(nextTask.presentationId, nextTask.presentationTitle, nextTask.fileType, nextTask.targetLang, nextTask.config, portMessageSender);
  } else {
    await saveQueueState(activeTranslationIds, queuedTranslations);
  }
}

function triggerTranslation(presentationId, presentationTitle, fileType, targetLang, config, portMessageSender) {
  const taskState = {
    step: 'copy',
    pct: 0,
    status: 'Initiating translation...',
    error: null,
    finalUrl: null
  };
  setTaskState(presentationId, taskState);
  if (portMessageSender) {
    portMessageSender(presentationId, taskState);
  }
  
  const sendProgress = async (step, pct, status, error = null, finalUrl = null) => {
    const updatedState = { step, pct, status, error, finalUrl };
    await setTaskState(presentationId, updatedState);
    if (portMessageSender) {
      portMessageSender(presentationId, updatedState);
    }
  };

  runTranslationWorkflow(presentationId, presentationTitle, fileType, targetLang, config, sendProgress)
    .then(() => {
      onTranslationFinished(presentationId, portMessageSender);
    })
    .catch(err => {
      logDebug(`Workflow execution failed: ${err.message}`, presentationId);
      sendProgress('error', 0, null, err.message);
      onTranslationFinished(presentationId, portMessageSender);
    });
}

/**
 * Tab removal listener for orphaned task dynamic eviction
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const data = await chrome.storage.local.get(['tabMappings', 'activeTranslationIds', 'queuedTranslations']);
    const tabMappings = data.tabMappings || {};
    const presentationId = tabMappings[tabId];
    
    if (presentationId) {
      delete tabMappings[tabId];
      await chrome.storage.local.set({ tabMappings });
      
      let changed = false;
      let activeTranslationIds = data.activeTranslationIds || [];
      let queuedTranslations = data.queuedTranslations || [];
      
      // Check and remove from queue
      const queueIndex = queuedTranslations.findIndex(t => t.presentationId === presentationId);
      if (queueIndex !== -1) {
        queuedTranslations.splice(queueIndex, 1);
        changed = true;
        await logDebug(`Tab ${tabId} closed. Purged queued task for presentation ${presentationId}`, presentationId);
        
        // Shift remaining queued task positions
        for (let idx = 0; idx < queuedTranslations.length; idx++) {
          const qTask = queuedTranslations[idx];
          const qPos = idx + 1;
          const qState = {
            step: 'queue',
            pct: 0,
            status: `Waiting in queue (Position: #${qPos})...`,
            error: null,
            finalUrl: null
          };
          await setTaskState(qTask.presentationId, qState);
        }
      }
      
      // Check and remove from active
      const activeIndex = activeTranslationIds.indexOf(presentationId);
      if (activeIndex !== -1) {
        activeTranslationIds.splice(activeIndex, 1);
        changed = true;
        await logDebug(`Tab ${tabId} closed. Cancelled active task for presentation ${presentationId}`, presentationId);
        
        // Remove taskState so it doesn't stay in error/stuck state
        await chrome.storage.local.remove(`taskState_${presentationId}`);
        
        // Trigger next task in queue
        if (queuedTranslations.length > 0) {
          const nextTask = queuedTranslations.shift();
          activeTranslationIds.push(nextTask.presentationId);
          
          await logDebug(`Triggering next queued task from closed tab slot: ${nextTask.presentationId}`, nextTask.presentationId);
          // Trigger translation without direct port message sender
          triggerTranslation(nextTask.presentationId, nextTask.presentationTitle, nextTask.fileType, nextTask.targetLang, nextTask.config, null);
        }
      }
      
      if (changed) {
        await saveQueueState(activeTranslationIds, queuedTranslations);
      }
    }
  } catch (err) {
    // Ignore
  }
});

/**
 * ── BATCH TRANSLATION & SCHEDULING SYSTEM ────────────────────────────────────
 */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('batch_job_')) {
    const jobId = alarm.name.replace('batch_job_', '');
    await processBatchJob(jobId);
  } else if (alarm.name.startsWith('resume_job_')) {
    const jobId = alarm.name.replace('resume_job_', '');
    await processBatchJob(jobId);
  }
});

async function scheduleAlarmForJob(job) {
  const alarmName = `batch_job_${job.id}`;
  await chrome.alarms.clear(alarmName);
  
  if (job.status === 'paused' || job.status === 'completed') {
    return;
  }
  
  if (job.schedule.frequency === 'once') {
    // One-time run triggers immediately in background
    setTimeout(() => {
      processBatchJob(job.id);
    }, 100);
  } else if (job.schedule.frequency === 'minute') {
    chrome.alarms.create(alarmName, {
      delayInMinutes: job.schedule.interval,
      periodInMinutes: job.schedule.interval
    });
  } else if (job.schedule.frequency === 'hour') {
    chrome.alarms.create(alarmName, {
      delayInMinutes: job.schedule.interval * 60,
      periodInMinutes: job.schedule.interval * 60
    });
  } else {
    // daily, weekly, monthly
    const nextTime = calculateNextTriggerTime(job.schedule.startTime, job.schedule.frequency);
    chrome.alarms.create(alarmName, {
      when: nextTime
    });
  }
}

function calculateNextTriggerTime(startTimeStr, frequency) {
  const [hour, minute] = (startTimeStr || "09:00").split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  
  if (frequency === 'weekly') {
    const currentDay = target.getDay(); // 0 is Sunday, 1 is Monday...
    let daysUntilMonday = (1 - currentDay + 7) % 7;
    if (daysUntilMonday === 0 && target.getTime() <= now.getTime()) {
      daysUntilMonday = 7;
    }
    target.setDate(target.getDate() + daysUntilMonday);
  } else {
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    if (frequency === 'monthly') {
      target.setMonth(target.getMonth() + 1);
    }
  }
  
  return target.getTime();
}

async function listFilesInFolder(folderId, token) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&pageSize=1000`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to list folder contents: ${await res.text()}`);
  }
  const data = await res.json();
  return data.files || [];
}

async function getFileInfo(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,parents`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to get file info: ${await res.text()}`);
  }
  return await res.json();
}

async function createFolder(folderName, parentFolderId, token) {
  const checkUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(folderName)}'+and+'${parentFolderId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id)`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (checkRes.ok) {
    const data = await checkRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  const url = 'https://www.googleapis.com/drive/v3/files';
  const body = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Failed to create folder: ${await res.text()}`);
  }
  const data = await res.json();
  return data.id;
}

async function processBatchJob(jobId) {
  const data = await chrome.storage.local.get('batchJobs');
  const batchJobs = data.batchJobs || {};
  const job = batchJobs[jobId];
  if (!job || job.status === 'paused' || job.status === 'completed') return;
  
  job.status = 'running';
  job.progress = job.progress || 0;
  await chrome.storage.local.set({ batchJobs });
  
  try {
    const token = await getAuthToken();
    let fileIds = [];
    
    if (job.sourceType === 'current') {
      fileIds = [job.folderId];
    } else if (job.sourceType === 'folder') {
      const folderFiles = await listFilesInFolder(job.folderId, token);
      fileIds = folderFiles.map(f => f.id);
    }
    
    if (fileIds.length === 0) {
      job.status = 'completed';
      job.progress = 100;
      await chrome.storage.local.set({ batchJobs });
      return;
    }
    
    const storageConfig = await chrome.storage.local.get([
      'translationEngine', 'apiKey', 'modelName', 'customUrl'
    ]);
    const config = {
      translationEngine: storageConfig.translationEngine || 'free',
      apiKey: storageConfig.apiKey || '',
      modelName: storageConfig.modelName || 'gemini-3.1-flash-lite',
      customUrl: storageConfig.customUrl || '',
      prompt: job.schedule.prompt || ''
    };

    const totalTasks = fileIds.length * job.targetLangs.length;
    let completedTasks = Math.floor((job.progress / 100) * totalTasks);
    
    for (let fIdx = 0; fIdx < fileIds.length; fIdx++) {
      const fileId = fileIds[fIdx];
      for (let lIdx = 0; lIdx < job.targetLangs.length; lIdx++) {
        const targetLang = job.targetLangs[lIdx];
        
        const currentTaskIndex = fIdx * job.targetLangs.length + lIdx;
        if (currentTaskIndex < completedTasks) {
          continue;
        }

        const liveData = await chrome.storage.local.get('batchJobs');
        const liveJob = (liveData.batchJobs || {})[jobId];
        if (!liveJob || liveJob.status === 'paused') {
          return;
        }
        
        try {
          const fileInfo = await getFileInfo(fileId, token);
          const name = fileInfo.name;
          const mimeType = fileInfo.mimeType;
          
          let fileType = '';
          if (mimeType === 'application/vnd.google-apps.document') fileType = 'document';
          else if (mimeType === 'application/vnd.google-apps.spreadsheet') fileType = 'spreadsheet';
          else if (mimeType === 'application/vnd.google-apps.form') fileType = 'form';
          else if (mimeType === 'application/vnd.google-apps.presentation') fileType = 'presentation';
          
          if (!fileType) {
            completedTasks++;
            job.progress = (completedTasks / totalTasks) * 100;
            await chrome.storage.local.set({ batchJobs });
            continue;
          }
          
          let parentFolderId = null;
          if (job.outputMode === 'target') {
            parentFolderId = job.targetFolderId;
          } else if (job.outputMode === 'subfolder') {
            const parent = fileInfo.parents ? fileInfo.parents[0] : null;
            if (parent) {
              parentFolderId = await createFolder(`[Translated - ${targetLang}]`, parent, token);
            }
          }
          
          const LANG_LABELS = {
            'zh-TW': '繁體中文', 'zh-CN': '简体中文', 'en': 'English',
            'ja': '日本語', 'ko': '한국어', 'es': 'Español',
            'fr': 'Français', 'de': 'Deutsch', 'vi': 'Tiếng Việt', 'th': 'ไทย'
          };
          const langLabel = LANG_LABELS[targetLang] || targetLang;
          const translatedName = `[Translated - ${langLabel}] ${name}`;
          
          const copyId = await duplicateGoogleFile(fileId, translatedName, mimeType, token, parentFolderId);
          
          const dummyProgress = (step, pct, status, error, finalUrl) => {
            logDebug(`[BatchJob ${jobId}] File ${copyId} Progress: ${step} (${pct}%) - ${status}`);
          };
          
          await runTranslationWorkflow(copyId, translatedName, fileType, targetLang, config, dummyProgress, true);
          
        } catch (err) {
          console.error(`Batch job file translation failed:`, err);
          
          if (err.message.includes('429') || err.message.includes('quota') || err.message.includes('Limit') || err.message.includes('Too Many Requests')) {
            job.status = 'paused';
            job.progress = (currentTaskIndex / totalTasks) * 100;
            await chrome.storage.local.set({ batchJobs });
            
            chrome.alarms.create(`resume_job_${job.id}`, { delayInMinutes: 5 });
            logDebug(`[BatchJob ${jobId}] Rate limit hit. Paused queue. Rescheduled in 5 mins.`);
            return;
          }
        }
        
        completedTasks++;
        job.progress = (completedTasks / totalTasks) * 100;
        await chrome.storage.local.set({ batchJobs });
      }
    }
    
    job.status = 'completed';
    job.progress = 100;
    await chrome.storage.local.set({ batchJobs });
    
  } catch (err) {
    console.error('Batch job main processor failed:', err);
    job.status = 'paused';
    await chrome.storage.local.set({ batchJobs });
  }
}

