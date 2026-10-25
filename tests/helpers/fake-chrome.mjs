// In-memory chrome.* for running the real service worker under Node.
// Records every side effect (tabs, notifications, port messages) for assertions.

export function createFakeChrome({ initialStorage = {}, tokens = ['tok-1'] } = {}) {
  const store = structuredClone(initialStorage);
  const listeners = { connect: [], message: [], tabRemoved: [], notifClicked: [] };
  const record = { tabsCreated: [], notifications: [], portMessages: [], authCalls: 0 };
  // Sign-in hands out tokens from this queue; the last one repeats.
  const tokenQueue = [...tokens];

  const pick = (keys) => {
    if (keys == null) return structuredClone(store);
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    const out = {};
    for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
    return out;
  };
  const cbOrPromise = (value, cb) => { if (cb) { queueMicrotask(() => cb(value)); return undefined; } return Promise.resolve(value); };

  const chrome = {
    storage: {
      local: {
        get: (keys, cb) => cbOrPromise(pick(keys), cb),
        set: (obj, cb) => { Object.assign(store, structuredClone(obj)); return cbOrPromise(undefined, cb); },
        remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; return cbOrPromise(undefined, cb); },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      lastError: null,
      onConnect: { addListener: (fn) => listeners.connect.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onInstalled: { addListener: (fn) => (listeners.installed ||= []).push(fn) },
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage: () => Promise.resolve(),
      getPlatformInfo: (cb) => cb && cb({}),
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    tabs: {
      create: (opts) => { record.tabsCreated.push(opts); return Promise.resolve({ id: 99 }); },
      onRemoved: { addListener: (fn) => listeners.tabRemoved.push(fn) },
    },
    notifications: {
      create: (id, opts) => { record.notifications.push({ id, ...opts }); },
      clear: () => {},
      onClicked: { addListener: (fn) => listeners.notifClicked.push(fn) },
    },
    identity: {
      getRedirectURL: () => 'https://ext.chromiumapp.org/',
      launchWebAuthFlow: (opts, cb) => {
        record.authCalls++;
        const tok = tokenQueue.length > 1 ? tokenQueue.shift() : tokenQueue[0];
        queueMicrotask(() => cb(`https://ext.chromiumapp.org/#access_token=${tok}&token_type=Bearer`));
      },
    },
  };

  /** Simulates the side panel connecting and watching a file. */
  function connectPanel(viewId) {
    const portListeners = [];
    const port = {
      name: 'translation-channel',
      postMessage: (m) => record.portMessages.push(m),
      onMessage: { addListener: (fn) => portListeners.push(fn) },
      onDisconnect: { addListener() {} },
    };
    for (const fn of listeners.connect) fn(port);
    const send = async (msg) => { for (const fn of portListeners) await fn(msg); };
    if (viewId) send({ action: 'registerView', presentationId: viewId });
    return { send };
  }

  async function waitForTask(id, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const s = store[`taskState_${id}`];
      if (s && (s.step === 'done' || s.error)) {
        // let the queue bookkeeping (onTranslationFinished) settle
        await new Promise((r) => setTimeout(r, 50));
        return store[`taskState_${id}`];
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`task ${id} did not finish; state=${JSON.stringify(store[`taskState_${id}`])}`);
  }

  const setTokens = (list) => { tokenQueue.splice(0, tokenQueue.length, ...list); };
  return { chrome, store, record, listeners, connectPanel, waitForTask, setTokens };
}
