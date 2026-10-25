// End-to-end: the real service worker (background.js + lib/* + translate.js)
// running full translation jobs against fake Google/Gemini APIs.
// Run: node --test 'tests/*.test.mjs'
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './helpers/fake-chrome.mjs';
import { installFakeFetch, slide } from './helpers/fake-google.mjs';

// The keep-alive interval must not hold the test process open.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };

const fake = createFakeChrome({ initialStorage: { autoOpenResult: true }, tokens: ['tok-1'] });
globalThis.chrome = fake.chrome;
const api = installFakeFetch();
let panel;

before(async () => {
  await import('../background.js');
  await new Promise((r) => setTimeout(r, 50)); // startup cleanup
});

const baseConfig = { translationEngine: 'gemini', apiKey: 'AQ.test-key-1234567890', modelName: 'gemini-test' };

async function run(id, fileType, extra = {}, { watch = true } = {}) {
  panel = fake.connectPanel(watch ? id : 'some-other-file');
  await panel.send({
    action: 'startTranslation', presentationId: id, presentationTitle: `Title ${id}`,
    fileType, targetLang: extra.targetLang || 'zh-TW', tabId: 7,
    config: { ...baseConfig, ...extra.config },
  });
  return fake.waitForTask(id);
}

const lastBatch = (apiName) => api.batchUpdates.filter((b) => b.api === apiName).at(-1);

test('slides: translates every shape, writes per page, opens result, records history', async () => {
  api.files.p1 = { slides: [slide('s1', [['a', 'Quarterly results\n', 24]]), slide('s2', [['b', 'Next steps\n', 18]])] };
  const state = await run('p1', 'presentation');
  assert.equal(state.step, 'done', state.error);
  assert.equal(state.summary.segments, 2);
  const reqs = api.batchUpdates.find((b) => b.api === 'slides').requests;
  assert.deepEqual(reqs.map((r) => r.replaceAllText.pageObjectIds[0]).sort(), ['s1', 's2']);
  assert.ok(reqs.every((r) => r.replaceAllText.replaceText.startsWith('TR(')));
  const tab = fake.record.tabsCreated.at(-1);
  assert.match(tab.url, /presentation\/d\/copy\d+\/edit/);
  assert.equal(tab.active, true);
  assert.equal(fake.record.notifications.length, 0, 'panel was watching → no notification');
  assert.ok(fake.store.completedTranslations.some((h) => tab.url.includes(h.presentationId)));
  assert.ok(fake.store[`completedInfo_${tab.url.match(/copy\d+/)[0]}`]);
  assert.deepEqual(fake.store.activeTranslationIds, []);
});

test('slides: longer translation shrinks explicit font sizes', async () => {
  api.files.p2 = { slides: [slide('s1', [['t', 'Hi team\n', 20]])] };
  api.llm.translate = (t) => `${t} — a considerably longer translated sentence`;
  const state = await run('p2', 'presentation');
  api.llm.translate = (t) => `TR(${t})`;
  assert.equal(state.step, 'done', state.error);
  const fit = lastBatch('slides').requests;
  assert.ok(fit[0].updateTextStyle, 'expected a font-size request');
  assert.ok(fit[0].updateTextStyle.style.fontSize.magnitude < 20);
  assert.equal(state.summary.overflowFixed, 1);
});

test('slides: slide range only sends those slides to the model', async () => {
  api.files.p3 = { slides: [slide('s1', [['a', 'First\n']]), slide('s2', [['b', 'Second\n']]), slide('s3', [['c', 'Third\n']])] };
  const before = api.llm.calls.length;
  const state = await run('p3', 'presentation', { config: { scope: { slides: [2] } } });
  assert.equal(state.step, 'done', state.error);
  assert.deepEqual(api.llm.calls.slice(before).flatMap((c) => c.texts), ['Second']);
});

test('docs: paragraphs and tables are translated, table padding applied', async () => {
  api.files.d1 = {
    title: 'Doc', body: { content: [
      { startIndex: 1, paragraph: { elements: [{ textRun: { content: 'Hello world\n' } }] } },
      { startIndex: 14, table: { rows: 1, columns: 1, tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'Cell text\n' } }] } }] }] }] } },
    ] },
  };
  const state = await run('d1', 'document');
  assert.equal(state.step, 'done', state.error);
  const docs = api.batchUpdates.filter((b) => b.api === 'docs');
  const replaced = docs.flatMap((b) => b.requests).filter((r) => r.replaceAllText).map((r) => r.replaceAllText.containsText.text).sort();
  assert.deepEqual(replaced, ['Cell text', 'Hello world']);
  assert.ok(docs.some((b) => b.requests.some((r) => r.updateTableCellStyle)));
});

test('sheets: current-tab scope, cell writes, capped column widening', async () => {
  const sheet = (sheetId, title, text) => ({
    properties: { title, sheetId, gridProperties: { columnCount: 2 } },
    data: [{ columnMetadata: [{ pixelSize: 100 }, { pixelSize: 100 }], rowData: [{ values: [{ userEnteredValue: { stringValue: text } }, { userEnteredValue: { numberValue: 5 } }] }] }],
  });
  api.files.x1 = { sheets: [sheet(0, 'Summary', 'Revenue'), sheet(42, 'Details', 'Opex')] };
  api.llm.translate = (t) => `${t} translated with a fairly long label`;
  const before = api.llm.calls.length;
  const state = await run('x1', 'spreadsheet', { config: { scope: { sheetGid: 42 } } });
  api.llm.translate = (t) => `TR(${t})`;
  assert.equal(state.step, 'done', state.error);
  const sent = api.llm.calls.slice(before).flatMap((c) => c.texts).sort();
  assert.deepEqual(sent, ['Details', 'Opex']);
  const reqs = lastBatch('sheets').requests;
  const cell = reqs.find((r) => r.updateCells);
  assert.equal(cell.updateCells.range.sheetId, 42);
  const dim = reqs.find((r) => r.updateDimensionProperties);
  assert.equal(dim.updateDimensionProperties.properties.pixelSize, 200);
  assert.ok(!reqs.some((r) => r.autoResizeDimensions), 'old autoResize must be gone');
  assert.ok(state.summary.columnsFitted >= 1);
});

test('forms: title, description, questions and options are written', async () => {
  api.files.f1 = {
    info: { title: 'Survey', description: 'Please answer' },
    items: [
      { itemId: 'i1', title: 'Your name', questionItem: { question: { questionId: 'q1', textQuestion: {} } } },
      { itemId: 'i2', title: 'Favorite color', questionItem: { question: { questionId: 'q2', choiceQuestion: { type: 'RADIO', options: [{ value: 'Red' }, { value: 'Blue' }] } } } },
    ],
  };
  const state = await run('f1', 'form');
  assert.equal(state.step, 'done', state.error);
  const written = JSON.stringify(lastBatch('forms').requests);
  for (const s of ['Survey', 'Please answer', 'Your name', 'Favorite color', 'Red', 'Blue']) {
    assert.ok(written.includes(`TR(${s})`), `missing ${s}`);
  }
});

test('multi-language: one copy per language, links for each, single focus', async () => {
  api.files.p4 = { slides: [slide('s1', [['a', 'Welcome\n']])] };
  const copiesBefore = api.copies;
  const tabsBefore = fake.record.tabsCreated.length;
  const state = await run('p4', 'presentation', { config: { extraLangs: ['ja', 'zh-TW', 'ko'] } });
  assert.equal(state.step, 'done', state.error);
  assert.equal(api.copies - copiesBefore, 3, 'zh-TW duplicate must be ignored');
  assert.deepEqual(state.summary.results.map((r) => r.lang), ['zh-TW', 'ja', 'ko']);
  const tabs = fake.record.tabsCreated.slice(tabsBefore);
  assert.deepEqual(tabs.map((t) => t.active), [false, false, true]);
});

test('prefs: tone, keep-categories and glossary reach the prompt; cache is separated', async () => {
  api.files.p5 = { slides: [slide('s1', [['a', 'Welcome\n']])] };
  const before = api.llm.calls.length;
  const prefs = { tone: 'formal', names: { people: 'keep', brands: 'translate', places: 'translate' }, glossary: [{ src: 'Welcome', dst: '歡迎光臨' }], custom: '' };
  const state = await run('p5', 'presentation', { config: { prefs } });
  assert.equal(state.step, 'done', state.error);
  const call = api.llm.calls[before];
  assert.ok(call, 'cached result must not be reused when prefs differ');
  assert.match(call.system, /formal/);
  assert.match(call.system, /people's names/);
  assert.match(call.system, /"Welcome" → "歡迎光臨"/);
});

test('custom instructions that break the format are dropped and retried once', async () => {
  api.files.p6 = { slides: [slide('s1', [['a', 'Alpha\n']]), slide('s2', [['b', 'Beta\n']])] };
  api.llm.override = (texts, system) => (system.includes('SAY HELLO') ? ['only one'] : texts.map((t) => `TR(${t})`));
  const state = await run('p6', 'presentation', { config: { prefs: { custom: 'SAY HELLO and merge items' } } });
  api.llm.override = null;
  assert.equal(state.step, 'done', state.error);
  assert.equal(state.summary.customDropped, true);
});

test('expired Google token is refreshed silently and the job completes', async () => {
  api.files.p7 = { slides: [slide('s1', [['a', 'Token test\n']])] };
  // The job starts with tok-1 (now expired → 401); the silent refresh yields tok-2.
  api.validTokens = new Set(['tok-2']);
  fake.setTokens(['tok-1', 'tok-2']);
  const authBefore = fake.record.authCalls;
  const state = await run('p7', 'presentation');
  assert.equal(state.step, 'done', state.error);
  assert.ok(fake.record.authCalls > authBefore);
});

test('model error surfaces as a job error and frees the slot', async () => {
  api.files.p8 = { slides: [slide('s1', [['a', 'Will fail\n']])] };
  api.llm.override = () => new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
  const state = await run('p8', 'presentation');
  api.llm.override = null;
  assert.match(state.error, /Gemini API Error \(404\)/);
  assert.deepEqual(fake.store.activeTranslationIds, []);
  assert.equal(fake.store.resumableTasks?.p8, undefined);
});

test('notification when the panel is not watching; clicking it opens the copy', async () => {
  api.files.p9 = { slides: [slide('s1', [['a', 'Notify me\n']])] };
  const n = fake.record.notifications.length;
  const state = await run('p9', 'presentation', {}, { watch: false });
  assert.equal(state.step, 'done', state.error);
  const note = fake.record.notifications[n];
  assert.ok(note, 'expected a notification');
  const tabs = fake.record.tabsCreated.length;
  for (const fn of fake.listeners.notifClicked) await fn(note.id);
  assert.equal(fake.record.tabsCreated.length, tabs + 1);
});

test('multi-language failing part-way keeps finished copies in the error state', async () => {
  api.files.p10 = { slides: [slide('s1', [['a', 'Partial\n']])] };
  api.llm.override = (texts, system) => (system.includes('Japanese')
    ? new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 400 })
    : texts.map((t) => `TR(${t})`));
  const state = await run('p10', 'presentation', { config: { extraLangs: ['ja'] } });
  api.llm.override = null;
  assert.ok(state.error);
  assert.deepEqual(state.summary.results.map((r) => r.lang), ['zh-TW']);
});

test('sheets: current-sheet-only without #gid translates just the first tab', async () => {
  const sheet = (sheetId, text) => ({ properties: { title: `T${sheetId}`, sheetId, gridProperties: { columnCount: 1 } },
    data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: text } }] }] }] });
  api.files.x2 = { sheets: [sheet(7, 'First tab text'), sheet(8, 'Second tab text')] };
  const before = api.llm.calls.length;
  const state = await run('x2', 'spreadsheet', { config: { scope: { sheetGid: null, currentSheetOnly: true } } });
  assert.equal(state.step, 'done', state.error);
  assert.deepEqual(api.llm.calls.slice(before).flatMap((c) => c.texts).sort(), ['First tab text', 'T7']);
});

test('sheets: a vanished gid is an error, never a whole-workbook translation', async () => {
  api.files.x3 = { sheets: [{ properties: { title: 'Only', sheetId: 1, gridProperties: { columnCount: 1 } }, data: [{ rowData: [] }] }] };
  const state = await run('x3', 'spreadsheet', { config: { scope: { sheetGid: 999, currentSheetOnly: true } } });
  assert.match(state.error, /Sheet tab not found/);
});

test('keep-as-is term written in caps keeps the document casing (DECK bug)', async () => {
  api.files.p11 = { slides: [slide('s1', [['a', 'Technical pitch deck\n']])] };
  // Simulate the model copying the glossary casing.
  api.llm.translate = (t) => t.replace(/deck/gi, 'DECK').replace('Technical pitch', 'เทคนิค');
  const state = await run('p11', 'presentation', { config: { prefs: { glossary: [{ src: 'DECK', dst: '' }] } } });
  api.llm.translate = (t) => `TR(${t})`;
  assert.equal(state.step, 'done', state.error);
  const written = lastBatch('slides').requests.map((r) => r.replaceAllText?.replaceText).filter(Boolean);
  assert.deepEqual(written, ['เทคนิค deck']);
});

test('sheets: current sheet is found by name when the copy has new IDs (converted .xlsx)', async () => {
  const sheet = (sheetId, title, text) => ({ properties: { title, sheetId, gridProperties: { columnCount: 1 } },
    data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: text } }] }] }] });
  // gid 1234 is the id in the .xlsx view; the converted copy re-numbers its sheets.
  api.files.x4 = { sheets: [sheet(11, 'Executive Summary', 'Delivery roadmap'), sheet(12, 'Phase 1 WBS', 'Task list')] };
  const before = api.llm.calls.length;
  const state = await run('x4', 'spreadsheet', { config: { scope: { sheetGid: 1234, sheetTitle: 'Executive Summary', currentSheetOnly: true } } });
  assert.equal(state.step, 'done', state.error);
  assert.deepEqual(api.llm.calls.slice(before).flatMap((c) => c.texts).sort(), ['Delivery roadmap', 'Executive Summary']);
});

test('copy is named from the Drive file name, not a URL-like tab title (.xlsx)', async () => {
  api.files.x5 = { sheets: [{ properties: { title: 'S', sheetId: 1, gridProperties: { columnCount: 1 } }, data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: 'Hello' } }] }] }] }] };
  api.names.x5 = 'Taiwan_Mobile_GWS_Rebalanced_WBS.xlsx';
  panel = fake.connectPanel('x5');
  await panel.send({ action: 'startTranslation', presentationId: 'x5', presentationTitle: 'docs.google.com/spreadsheets/d/x5/edit',
    fileType: 'spreadsheet', targetLang: 'zh-TW', tabId: 7, config: { ...baseConfig } });
  const state = await fake.waitForTask('x5');
  assert.equal(state.step, 'done', state.error);
  assert.equal(api.copyNames.at(-1), '[Translated - 繁體中文] Taiwan_Mobile_GWS_Rebalanced_WBS');
});

test('cached translations from before the casing fix are corrected too (DECK retest)', async () => {
  const { prefsFingerprint, normalizePrefs } = await import('../lib/prefs.js');
  const prefs = { glossary: [{ src: 'DECK', dst: '' }] };
  api.files.p12 = { slides: [slide('s1', [['a', 'Technical pitch deck\n']])] };
  // A cache entry written by the old build, with the wrong casing.
  const key = `translationCache_gemini_th_${prefsFingerprint(normalizePrefs(prefs))}`;
  fake.store[key] = { 'Technical pitch deck': 'เทคนิค DECK' };
  const callsBefore = api.llm.calls.length;
  const state = await run('p12', 'presentation', { targetLang: 'th', config: { prefs } });
  assert.equal(state.step, 'done', state.error);
  const written = lastBatch('slides').requests.map((r) => r.replaceAllText?.replaceText).filter(Boolean);
  assert.deepEqual(written, ['เทคนิค deck']);
  assert.ok(api.llm.calls.length >= callsBefore);
});

test('annotate mode: original added in brackets, no Google（Google） duplicates', async () => {
  api.files.p13 = { slides: [slide('s1', [['a', 'Apple Inc. uses Google\n']])] };
  const before = api.llm.calls.length;
  api.llm.translate = () => '蘋果公司（Apple Inc.）使用 Google（Google）';
  const state = await run('p13', 'presentation', { config: { prefs: { names: { people: 'keep', brands: 'annotate', places: 'translate' } } } });
  api.llm.translate = (t) => `TR(${t})`;
  assert.equal(state.step, 'done', state.error);
  assert.match(api.llm.calls[before].system, /蘋果公司（Apple Inc\.）/);
  const written = lastBatch('slides').requests.map((r) => r.replaceAllText?.replaceText).filter(Boolean);
  assert.deepEqual(written, ['蘋果公司（Apple Inc.）使用 Google']);
});

test('settings saved by ≤ v1.6 (keep: booleans) still work', async () => {
  api.files.p14 = { slides: [slide('s1', [['a', 'Meet Jerry in Tokyo\n']])] };
  const before = api.llm.calls.length;
  const state = await run('p14', 'presentation', { config: { prefs: { keep: { people: true, brands: false, places: true } } } });
  assert.equal(state.step, 'done', state.error);
  assert.match(api.llm.calls[before].system, /copy them exactly as written: people's names; place names/);
});

test("update marks what's new; first install opens the guide once", async () => {
  const before = fake.record.tabsCreated.length;
  for (const fn of fake.listeners.installed) fn({ reason: 'update' });
  assert.equal(fake.store.whatsNewVersion, '9.9.9');
  assert.equal(fake.record.tabsCreated.length, before, 'an update must not open tabs');
  for (const fn of fake.listeners.installed) fn({ reason: 'install' });
  assert.equal(fake.store.whatsNewSeen, '9.9.9');
  assert.equal(fake.record.tabsCreated.at(-1).url, 'onboarding.html');
});
