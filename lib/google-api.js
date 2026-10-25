/**
 * Google Workspace REST wrappers (Drive / Slides / Docs) and OAuth.
 */
import { logDebug, fetchWithRetryAndTimeout } from '../translate.js';

// Bundled OAuth 2.0 Client ID — users do not need to configure their own
const BUNDLED_CLIENT_ID = '770405736518-j64169msnu3npqh1p09k4rko4022c80f.apps.googleusercontent.com';

// Latest token obtained in this service-worker lifetime; shared so concurrent jobs
// refresh once instead of each popping their own OAuth flow.
let latestToken = null;
let refreshInFlight = null;

/** Token cached by the last successful sign-in in this service-worker lifetime. */
export function getCachedToken() {
  return latestToken;
}

/**
 * Wrapper for every Google API (Drive/Slides/Docs/Sheets/Forms) call.
 *
 * Google's REST APIs return transient 500/503 ("Internal Error") and can time
 * out; without retries a single blip fails the whole translation and the user
 * has to start over (see docs/05 H1). This reuses translate.js's proven
 * retry+timeout+backoff helper. useLock=false and cooldownMs=0 keep Google calls
 * OFF the LLM rate-limit lock (that lock exists to pace the translation model,
 * not Google). Drop-in for fetch(): same args in, same Response out — callers
 * still check response.ok themselves.
 *
 * NOTE: retrying a 5xx on the non-idempotent Drive "copy" can, very rarely,
 * leave an orphan duplicate if the server actually completed before erroring.
 * That is far preferable to failing the entire job, and easy for the user to
 * delete. Every other Google call here (get / batchUpdate replaceAllText /
 * updateCells / updateItem) is effectively idempotent on retry.
 */
export async function googleApiFetch(url, options = {}, presentationId = null) {
  const res = await fetchWithRetryAndTimeout(url, options, 60000, 3, presentationId, false, 0);
  if (res.status !== 401) return res;

  // Implicit-flow tokens expire after ~1h and cannot be refreshed, so a long job
  // used to die at the final write (docs/05 H2). Re-run the silent OAuth flow and
  // retry once with the new token. Callers keep passing their original token;
  // later calls hit 401 once and pick up the cached fresh one here.
  const sentAuth = options.headers?.Authorization || '';
  const freshToken = await refreshAuthToken(sentAuth.replace(/^Bearer /, ''));
  if (!freshToken) return res;
  if (presentationId) await logDebug('Google token expired — refreshed and retrying.', presentationId);
  const retryOptions = { ...options, headers: { ...options.headers, Authorization: `Bearer ${freshToken}` } };
  return fetchWithRetryAndTimeout(url, retryOptions, 60000, 3, presentationId, false, 0);
}

export async function refreshAuthToken(staleToken) {
  if (latestToken && latestToken !== staleToken) return latestToken;
  if (!refreshInFlight) {
    refreshInFlight = getAuthToken({ silentOnly: true })
      .catch(() => null)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * Retrieves OAuth token. Tries silent first, falls back to interactive login.
 */
export async function getAuthToken({ silentOnly = false } = {}) {
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
    latestToken = await runFlow(false);
  } catch (e) {
    // A mid-job refresh must never pop a login window the user isn't watching.
    if (silentOnly) throw e;
    console.log('Silent auth failed, opening interactive prompt...', e);
    // Open login dialog
    latestToken = await runFlow(true);
  }
  return latestToken;
}

export async function deleteGoogleFile(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const response = await googleApiFetch(url, {
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

/**
 * Generic copy function for Google Workspace files (Google Drive API v3)
 */
export async function duplicateGoogleFile(fileId, newName, mimeType, token) {
  // Fetch original file's parents so we can copy it into the same folder
  let parents = [];
  try {
    const getFileUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`;
    const getRes = await googleApiFetch(getFileUrl, {
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
  
  const response = await googleApiFetch(url, {
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
 * Fetch Google Slide structure (Google Slides API v1)
 */
export async function getPresentationDetails(presentationId, token) {
  const url = `https://slides.googleapis.com/v1/presentations/${presentationId}`;

  const response = await googleApiFetch(url, {
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
export async function updatePresentation(presentationId, requests, token) {
  const url = `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`;

  const response = await googleApiFetch(url, {
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
 * Fetch Google Document structure (Google Docs API v1)
 */
export async function getDocumentDetails(documentId, token) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}`;

  const response = await googleApiFetch(url, {
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
export async function updateDocument(documentId, requests, token) {
  const url = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;

  const response = await googleApiFetch(url, {
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
