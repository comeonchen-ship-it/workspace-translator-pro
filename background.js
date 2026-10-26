import { translateTexts, logDebug } from './translate.js';
import {
  googleApiFetch, getAuthToken, getCachedToken, deleteGoogleFile, duplicateGoogleFile, getDriveFileName,
  getPresentationDetails, updatePresentation, getDocumentDetails, updateDocument,
} from './lib/google-api.js';
import { getTaskState, setTaskState, checkCancelledGlobal } from './lib/task-state.js';
import { extractTextFromElements, extractTextFromDocElements } from './lib/text-extract.js';
import { translateSpreadsheet } from './lib/sheets.js';
import { translateForm } from './lib/forms.js';
import { measureShapes, planFontScaling } from './lib/overflow.js';
import { getLanguage } from './i18n/languages.js';

// Enable opening of Side Panel when clicking the extension action icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set Side Panel behavior:', error));

// After an update, the side panel's help button shows a dot until the user has
// opened the guide's "What's new" section (see onboarding.js / popup.js).
// A first install opens the guide once.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  const version = chrome.runtime.getManifest().version;
  if (reason === 'update') chrome.storage.local.set({ whatsNewVersion: version });
  if (reason === 'install') {
    chrome.storage.local.set({ whatsNewVersion: version, whatsNewSeen: version });
    chrome.tabs.create({ url: 'onboarding.html' });
  }
});

// Recover any active or queued translations left over from a previous
// service-worker lifetime on startup/reload.
cleanUpStaleStates();

// A job interrupted by a service-worker restart is restarted from scratch at most
// this many times; after that it is reported as interrupted (avoids restart loops).
const MAX_RESUME_ATTEMPTS = 1;

async function cleanUpStaleStates() {
  try {
    const before = await chrome.storage.local.get(['resumableTasks', 'queuedTranslations', 'activeCopies', 'cancelledTasks']);
    const resumable = before.resumableTasks || {};
    const queued = before.queuedTranslations || [];
    const copies = before.activeCopies || {};
    const cancelled = before.cancelledTasks || [];

    // 1. Reset active and queued task arrays
    await chrome.storage.local.set({ activeTranslationIds: [], queuedTranslations: [], resumableTasks: {} });

    // 2. Pick the interrupted jobs that can be restarted automatically (docs/05 H3)
    const toRestart = [];
    for (const [id, task] of Object.entries(resumable)) {
      if (cancelled.includes(id)) continue;
      if ((task.config?.resumeAttempt || 0) >= MAX_RESUME_ATTEMPTS) continue;
      toRestart.push({ ...task, config: { ...task.config, resumeAttempt: (task.config?.resumeAttempt || 0) + 1 } });
    }
    const restartIds = new Set(toRestart.map((t) => t.presentationId));

    // 3. Mark every other unfinished task state as interrupted
    const allData = await chrome.storage.local.get(null);
    for (const key in allData) {
      if (key.startsWith('taskState_')) {
        const id = key.slice('taskState_'.length);
        const state = allData[key];
        if (state && state.step !== 'done' && !state.error && !restartIds.has(id) && !queued.some((q) => q.presentationId === id)) {
          state.step = 'error';
          state.pct = 0;
          state.error = 'Translation interrupted by browser or extension restart.';
          await chrome.storage.local.set({ [key]: state });
        }
      }
    }

    // 4. The half-written copy of a restarted job would be left orphaned in Drive
    for (const id of restartIds) {
      if (!copies[id]) continue;
      try {
        await deleteGoogleFile(copies[id].copyId, getCachedToken() || await getAuthToken({ silentOnly: true }));
      } catch (e) {
        await logDebug(`Could not remove partial copy after restart: ${e.message}`, id);
      }
      await unregisterActiveCopy(id);
    }

    // 5. Restart interrupted jobs first, then the ones that were still waiting
    for (const task of [...toRestart, ...queued]) {
      await logDebug('Resuming translation after service-worker restart.', task.presentationId);
      await requestTranslationStart(task.presentationId, task.presentationTitle, task.fileType, task.targetLang, task.config, pushProgressToActivePort);
    }
  } catch (e) {
    console.error('Failed to clean up stale task states:', e);
  }
}

// ── Keep-alive while translating ────────────────────────────────────────────
// MV3 stops an idle service worker after ~30s without extension events, which
// killed jobs once the side panel was closed. Any extension API call resets that
// timer, so ping a cheap one while at least one job is active.
let keepAliveTimer = null;

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}

function stopKeepAlive() {
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

// Up to MAX_CONCURRENT_TRANSLATIONS jobs update the same storage maps
// (resumableTasks, activeCopies). Each get→modify→set runs through this chain so
// two jobs never overwrite each other's entry.
let storageChain = Promise.resolve();
function withStorageLock(fn) {
  const run = storageChain.then(fn, fn);
  storageChain = run.catch(() => {});
  return run;
}

function setResumableTask(task) {
  return withStorageLock(() => writeResumableTask(task));
}

async function writeResumableTask(task) {
  const data = await chrome.storage.local.get('resumableTasks');
  const tasks = data.resumableTasks || {};
  if (task.config) {
    tasks[task.presentationId] = task;
  } else {
    delete tasks[task.presentationId];
  }
  await chrome.storage.local.set({ resumableTasks: tasks });
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

function registerActiveCopy(presentationId, copyId, token) {
  return withStorageLock(() => writeActiveCopy(presentationId, copyId, token));
}

async function writeActiveCopy(presentationId, copyId, token) {
  try {
    const data = await chrome.storage.local.get('activeCopies');
    const copies = data.activeCopies || {};
    copies[presentationId] = { copyId, token };
    await chrome.storage.local.set({ activeCopies: copies });
  } catch (e) {
    // Ignore
  }
}

function unregisterActiveCopy(presentationId) {
  return withStorageLock(() => removeActiveCopy(presentationId));
}

async function removeActiveCopy(presentationId) {
  try {
    const data = await chrome.storage.local.get('activeCopies');
    const copies = data.activeCopies || {};
    delete copies[presentationId];
    await chrome.storage.local.set({ activeCopies: copies });
  } catch (e) {
    // Ignore
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

function pushProgressToActivePort(pid, state) {
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
}

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
        
        requestTranslationStart(presentationId, presentationTitle, fileType, targetLang, config, pushProgressToActivePort);
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
            const res = await googleApiFetch(url, {
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
  }
});

/**
 * Hands the finished copy to the user. The tab opens in the foreground only when
 * "auto-switch to result" is on (default); otherwise it opens behind so the side
 * panel keeps showing the completion card. If the panel is not watching this job
 * (closed, or on another file), a system notification announces it instead.
 */
async function deliverResult(presentationId, sourceTitle, copyId, editUrl, summary, multi = null) {
  const { autoOpenResult = true } = await chrome.storage.local.get('autoOpenResult');
  // Lets the panel show "translated from …" when it lands on the copy.
  await chrome.storage.local.set({ [`completedInfo_${copyId}`]: { sourceTitle, summary, at: Date.now() } });
  // In a multi-language run only the last copy may take focus or notify;
  // earlier copies open quietly behind it.
  const isLast = !multi || multi.index === multi.total - 1;
  chrome.tabs.create({ url: editUrl, active: autoOpenResult && isLast });
  if (!isLast) return;

  const panelWatching = activePort && activeViewPresentationId === presentationId;
  if (!panelWatching || !autoOpenResult) {
    const lang = getLanguage(summary.targetLang)?.endonym || summary.targetLang;
    chrome.notifications.create(`done:${copyId}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '✅ ' + (sourceTitle || 'Workspace Translator Pro'),
      message: `→ ${lang}`,
      priority: 1,
    });
    await chrome.storage.local.set({ [`notifUrl_done:${copyId}`]: editUrl });
  }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const key = `notifUrl_${notificationId}`;
  const data = await chrome.storage.local.get(key);
  if (data[key]) {
    chrome.tabs.create({ url: data[key] });
    await chrome.storage.local.remove(key);
  }
  chrome.notifications.clear(notificationId);
});

/**
 * Main translation workflow orchestration
 */
async function runTranslationWorkflow(presentationId, presentationTitle, fileType, targetLang, config, sendProgress) {
  let copyId = null;
  config.presentationId = presentationId;
  const startedAt = Date.now();

  // Per-batch progress with a remaining-time estimate from the average batch
  // duration so far. The LLM step is the long one, so this is what users wait on.
  let batchClockStart = null;
  config.onBatchProgress = (done, total) => {
    if (done === 0 || batchClockStart === null) {
      batchClockStart = Date.now();
      if (done === 0) return;
    }
    const perBatch = (Date.now() - batchClockStart) / Math.max(1, done);
    const etaSec = Math.round((perBatch * (total - done)) / 1000);
    const pct = 60 + Math.round((20 * done) / total);
    const status = done >= total || etaSec <= 0
      ? { key: 'progress.batches', params: { done, total } }
      : etaSec >= 60
        ? { key: 'progress.batchesEtaMin', params: { done, total, m: Math.ceil(etaSec / 60) } }
        : { key: 'progress.batchesEtaSec', params: { done, total, s: etaSec } };
    sendProgress('translate', pct, status);
  };
  const summarize = (extra = {}) => ({
    durationMs: Date.now() - startedAt,
    engine: config.translationEngine,
    model: config.translationEngine === 'free' ? null : config.modelName,
    targetLang,
    customDropped: !!config.prefsCustomDropped,
    unusedTerms: config.unusedTerms || [],
    ...extra,
  });
  
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
    sendProgress('copy', 10, { key: 'progress.authenticating' });
    await logDebug('Requesting Google OAuth token...', presentationId);
    const token = await getAuthToken();
    await logDebug('Google OAuth token acquired successfully.', presentationId);
    await checkCancelled();
    
    // 2. Duplicate Google Workspace file (Google Drive API)
    sendProgress('copy', 25, { key: 'progress.duplicating', params: { fileType: `@fileType.${fileTypeName}` } });
    // Prefer Drive's name: the tab title the panel sent can be a URL (.xlsx etc.).
    const driveName = await getDriveFileName(presentationId, token);
    const originalName = (driveName || presentationTitle || `New ${fileTypeName}`).replace(/\.(pptx?|docx?|xlsx?)$/i, '');
    // Native language name, from the single language registry. Users scan Drive for
    // "日本語" faster than for "Japanese", so the endonym is deliberate.
    const langLabel = getLanguage(targetLang)?.endonym || targetLang;
    const translatedName = `[Translated - ${langLabel}] ${originalName}`;
    
    await logDebug(`Duplicating file. Source: ${presentationId}, Target name: "${translatedName}", MimeType: ${mimeType}`, presentationId);
    copyId = await duplicateGoogleFile(presentationId, translatedName, mimeType, token);
    await registerActiveCopy(presentationId, copyId, token);
    await checkCancelled();
    await logDebug(`File duplicated successfully. New File ID: ${copyId}`, presentationId);
    
    // Persist target language for the copy tab so that the sidebar preserves it when switching to the new tab
    await chrome.storage.local.set({ [`targetLang_${copyId}`]: targetLang });
    
    if (isSheet) {
      sendProgress('extract', 40, { key: 'progress.extracting.spreadsheet' });
      await checkCancelled();
      const editUrl = await translateSpreadsheet(copyId, targetLang, config, token, sendProgress);
      await unregisterActiveCopy(presentationId);
      await saveToHistory(copyId, translatedName, 'spreadsheet', editUrl);
      const summary = summarize({ columnsFitted: config.columnsFitted || 0 });
      sendProgress('done', 100, { key: 'progress.complete' }, null, editUrl, summary);
      await deliverResult(presentationId, originalName, copyId, editUrl, summary, config.multi);
      return;
    }

    if (isForm) {
      sendProgress('extract', 40, { key: 'progress.extracting.form' });
      await checkCancelled();
      const editUrl = await translateForm(copyId, targetLang, config, token, sendProgress);
      await unregisterActiveCopy(presentationId);
      await saveToHistory(copyId, translatedName, 'form', editUrl);
      const summary = summarize();
      sendProgress('done', 100, { key: 'progress.complete' }, null, editUrl, summary);
      await deliverResult(presentationId, originalName, copyId, editUrl, summary, config.multi);
      return;
    }

    // 3. Fetch copy details (Google Slides or Docs API)
    await checkCancelled();
    const uniqueTexts = new Set();
    
    if (isDoc) {
      sendProgress('extract', 40, { key: 'progress.extracting.document' });
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
      sendProgress('extract', 40, { key: 'progress.extracting.presentation' });
      await logDebug('Fetching copy presentation slide structure...', presentationId);
      const presentation = await getPresentationDetails(copyId, token);
      config.shapeWidthsBefore = measureShapes(presentation);
      await logDebug(`Successfully fetched presentation. Total slides: ${presentation.slides ? presentation.slides.length : 0}`, presentationId);
      
      // 4. Traverse layout and extract unique translatable texts
      const pageTextMap = new Map(); // pageId -> Set of original texts on this page
      const shapeIdsWithText = new Set();
      await logDebug('Traversing elements and extracting translatable text runs...', presentationId);
      // Optional slide range (1-based) from the panel; untouched slides keep their text.
      const wanted = config.scope?.slides?.length ? new Set(config.scope.slides) : null;
      const slidesInScope = (presentation.slides || []).filter((_, i) => !wanted || wanted.has(i + 1));
      if (wanted) await logDebug(`Slide range applied: ${slidesInScope.length}/${presentation.slides.length} slides.`, presentationId);
      for (const slide of slidesInScope) {
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
      const summary = summarize({ segments: 0 });
      sendProgress('done', 100, { key: 'progress.noTranslatableText' }, null, editUrl, summary);
      await deliverResult(presentationId, originalName, copyId, editUrl, summary, config.multi);
      return;
    }
    
    await checkCancelled();

    // 5. Call Translation Engine
    sendProgress('translate', 60, { key: 'progress.translating', params: { engine: config.translationEngine.toUpperCase() } });
    const translationsMap = await translateTexts(uniqueTextsArray, targetLang, config);
    
    await checkCancelled();

    // 6. Generate replaceAllText requests
    sendProgress('write', 80, { key: 'progress.applying' });
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

    // 7a. Best-effort: shrink fonts in slide text boxes the translation overflowed.
    let overflowFixed = 0;
    if (!isDoc && requests.length > 0 && config.shapeWidthsBefore) {
      const { fitTextToBoxes = true } = await chrome.storage.local.get('fitTextToBoxes');
      if (fitTextToBoxes) {
        try {
          const after = await getPresentationDetails(copyId, token);
          const plan = planFontScaling(config.shapeWidthsBefore, after);
          if (plan.requests.length > 0) {
            await updatePresentation(copyId, plan.requests, token);
            overflowFixed = plan.shapesAdjusted;
            await logDebug(`Shrank fonts in ${overflowFixed} text boxes to fit longer translations.`, presentationId);
          }
        } catch (fitErr) {
          await logDebug(`Font fitting skipped (non-fatal): ${fitErr.message}`, presentationId);
        }
      }
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
    const summary = summarize({ segments: uniqueTextsArray.length, overflowFixed });
    sendProgress('done', 100, { key: 'progress.complete' }, null, editUrl, summary);
    await deliverResult(presentationId, originalName, copyId, editUrl, summary, config.multi);
    
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
 * Enterprise-Grade Global Concurrency Queue Management
 */
// How many translation jobs run their Google-API phases (copy / extract / write)
// at once. The LLM step itself is still globally serialized by acquireApiLock(),
// so raising this does NOT multiply LLM load — it only overlaps the Google calls.
// 5 supports the "open 5 tabs, translate each" workflow without queuing.
const MAX_CONCURRENT_TRANSLATIONS = 5;

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
      status: { key: 'progress.queuePosition', params: { position: queuePos } },
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
  await setResumableTask({ presentationId, config: null });
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
        status: { key: 'progress.queuePosition', params: { position: qPos } },
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
    if (activeTranslationIds.length === 0) stopKeepAlive();
  }
}

function triggerTranslation(presentationId, presentationTitle, fileType, targetLang, config, portMessageSender) {
  // Snapshot params before the workflow mutates config (pageTextMap etc.) so a
  // restarted service worker can rerun the job.
  const snapshotSaved = setResumableTask({ presentationId, presentationTitle, fileType, targetLang, config: { ...config } });
  startKeepAlive();

  const taskState = {
    step: 'copy',
    pct: 0,
    status: { key: 'progress.initiating' },
    error: null,
    finalUrl: null
  };
  setTaskState(presentationId, taskState);
  if (portMessageSender) {
    portMessageSender(presentationId, taskState);
  }
  
  const sendProgress = async (step, pct, status, error = null, finalUrl = null, summary = null) => {
    const updatedState = { step, pct, status, error, finalUrl, summary };
    await setTaskState(presentationId, updatedState);
    if (portMessageSender) {
      portMessageSender(presentationId, updatedState);
    }
  };

  snapshotSaved
    .then(() => runAllLanguages(presentationId, presentationTitle, fileType, targetLang, config, sendProgress))
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
 * Runs the workflow once per target language (primary first), each producing its
 * own copy. Progress is folded into one bar; only the last language reports
 * 'done' (with every result link), earlier ones report "language i/n finished".
 * Stops at the first error or cancel.
 */
async function runAllLanguages(presentationId, presentationTitle, fileType, targetLang, config, sendProgress) {
  const langs = [targetLang, ...(config.extraLangs || []).filter((l) => l && l !== targetLang)];
  const total = langs.length;
  // Copies finished before a service-worker restart (see resume snapshot below).
  const results = [...(config.priorResults || [])];
  for (let i = 0; i < total; i++) {
    const lang = langs[i];
    const isLast = i === total - 1;
    let failed = false;
    const wrapped = async (step, pct, status, error = null, finalUrl = null, summary = null) => {
      if (error) failed = true;
      const overall = Math.round((i * 100 + pct) / total);
      if (step === 'done') {
        results.push({ lang, url: finalUrl });
        if (!isLast) {
          // Resume from the next language, not from the first, if the worker restarts.
          await setResumableTask({
            presentationId, presentationTitle, fileType, targetLang: langs[i + 1],
            config: { ...config, extraLangs: langs.slice(i + 2), priorResults: [...results] },
          });
          return sendProgress('translate', overall, { key: 'progress.langDone', params: { done: i + 1, total } });
        }
        const multi = results.length > 1;
        return sendProgress('done', 100, status, null, finalUrl, multi ? { ...summary, results } : summary);
      }
      if (error && results.length) {
        // Keep the copies that did finish reachable from the error state.
        return sendProgress(step, 0, status, error, null, { results });
      }
      return sendProgress(step, total > 1 ? overall : pct, status, error, finalUrl, summary);
    };
    const runConfig = { ...config, multi: { index: i, total } };
    await runTranslationWorkflow(presentationId, presentationTitle, fileType, lang, runConfig, wrapped);
    if (failed) break;
  }
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
            status: { key: 'progress.queuePosition', params: { position: qPos } },
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

