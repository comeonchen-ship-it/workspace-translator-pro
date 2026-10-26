/**
 * Per-job progress state persisted in chrome.storage.local.
 */

// Global state and helper functions to persist task states in chrome.storage.local
export async function getTaskState(presentationId) {
  const key = `taskState_${presentationId}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

export async function setTaskState(presentationId, state) {
  const key = `taskState_${presentationId}`;
  await chrome.storage.local.set({ [key]: state });
}

export async function checkCancelledGlobal(presentationId) {
  const data = await chrome.storage.local.get('cancelledTasks');
  const cancelledTasks = data.cancelledTasks || [];
  if (cancelledTasks.includes(presentationId)) {
    throw new Error('Translation stopped by user.');
  }
}
