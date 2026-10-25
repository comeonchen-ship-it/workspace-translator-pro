// Loads the service worker's whole module graph under a minimal chrome.* stub,
// catching broken imports/exports after refactors without opening Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const listener = { addListener: noop };
globalThis.chrome = {
  sidePanel: { setPanelBehavior: () => Promise.resolve() },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: { onConnect: listener, onMessage: listener, onInstalled: listener, getManifest: () => ({ version: '0' }), getPlatformInfo: noop, sendMessage: () => Promise.resolve() },
  tabs: { onRemoved: listener, create: noop },
  notifications: { onClicked: listener, create: noop, clear: noop },
  scripting: { executeScript: async () => [{ result: null }] },
  identity: { getRedirectURL: () => 'https://example.chromiumapp.org/' },
};

test('background.js and lib/* load without import errors', async () => {
  await assert.doesNotReject(import('../background.js'));
});
