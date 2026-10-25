// Service-worker restart: an interrupted multi-language job resumes from the
// language it was on (not the first), its half-written copy is removed, and
// earlier results are kept. Separate file = fresh module instance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './helpers/fake-chrome.mjs';
import { installFakeFetch, slide } from './helpers/fake-google.mjs';

const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };

test('interrupted job resumes from the remaining languages', async () => {
  const fake = createFakeChrome({ initialStorage: {
    activeTranslationIds: ['p1'],
    activeCopies: { p1: { copyId: 'halfDone', token: 'tok-1' } },
    taskState_p1: { step: 'translate', pct: 50 },
    resumableTasks: { p1: {
      presentationId: 'p1', presentationTitle: 'Deck', fileType: 'presentation', targetLang: 'ko',
      config: { translationEngine: 'gemini', apiKey: 'AQ.k', modelName: 'm', extraLangs: ['fr'],
        priorResults: [{ lang: 'ja', url: 'https://docs.google.com/presentation/d/jaCopy/edit' }] },
    } },
  } });
  globalThis.chrome = fake.chrome;
  const api = installFakeFetch();
  api.files.p1 = { slides: [slide('s1', [['a', 'Hello\n']])] };
  api.files.halfDone = { slides: [] };
  await import('../background.js');
  const state = await fake.waitForTask('p1');
  assert.equal(state.step, 'done', state.error);
  assert.deepEqual(state.summary.results.map((r) => r.lang), ['ja', 'ko', 'fr']);
  assert.equal(api.copies, 2, 'only ko and fr are re-made');
  assert.ok(api.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/halfDone')));
  assert.deepEqual(fake.store.resumableTasks, {});
});
