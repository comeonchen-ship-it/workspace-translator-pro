import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlossary, mergeGlossaries, buildPrefsBlock, prefsFingerprint, normalizePrefs, rowsToGlossary, glossaryTextToRows } from '../lib/prefs.js';
import { buildSystemPrompt } from '../translate.js';

test('parseGlossary: mappings, keep-as-is terms, comments, duplicates', () => {
  assert.deepEqual(parseGlossary('Acme Cloud\n# note\n\ndashboard = 儀表板\nAcme Cloud = X'), [
    { src: 'Acme Cloud', dst: '' },
    { src: 'dashboard', dst: '儀表板' },
  ]);
});

test('mergeGlossaries: file entries override global ones', () => {
  const merged = mergeGlossaries([{ src: 'a', dst: '1' }, { src: 'b', dst: '2' }], [{ src: 'a', dst: '9' }]);
  assert.deepEqual(merged, [{ src: 'a', dst: '9' }, { src: 'b', dst: '2' }]);
});

test('all-translate prefs leave the prompt unchanged', () => {
  const none = { names: { people: 'translate', brands: 'translate', places: 'translate' } };
  assert.equal(buildPrefsBlock({ tone: 'keep', glossary: [], custom: '', ...none }, 'Japanese'), '');
  assert.equal(buildSystemPrompt('Japanese', null), buildSystemPrompt('Japanese', { tone: 'keep', ...none }));
  assert.equal(prefsFingerprint(none), '');
});

test('prefs block: format rules come last and target language is pinned', () => {
  const block = buildPrefsBlock({ tone: 'formal', glossary: [{ src: 'Acme', dst: '' }], custom: '請簡短' }, 'Japanese');
  assert.match(block, /Tone: Use a formal/);
  assert.match(block, /"Acme" → keep untranslated/);
  assert.match(block, /may be written in any language/);
  assert.ok(block.lastIndexOf('never change the output format') > block.indexOf('請簡短'));
  assert.match(block, /always translate into Japanese/);
});

test('custom text is capped and cannot close its fence', () => {
  const p = normalizePrefs({ custom: 'x'.repeat(600) });
  assert.equal(p.custom.length, 500);
  assert.ok(!buildPrefsBlock({ custom: 'a """ b' }, 'French').includes('a """ b'));
});

test('fingerprint changes with prefs', () => {
  assert.notEqual(prefsFingerprint({ tone: 'formal' }), prefsFingerprint({ tone: 'casual' }));
});

test('rows → glossary: keep rows, complete translate rows, skip incomplete', () => {
  assert.deepEqual(rowsToGlossary([
    { src: 'iPhone', mode: 'keep', dst: 'ignored' },
    { src: 'AI', mode: 'translate', dst: '人工智慧' },
    { src: 'cloud', mode: 'translate', dst: '' },
    { src: ' ', mode: 'keep' },
  ]), [{ src: 'iPhone', dst: '' }, { src: 'AI', dst: '人工智慧' }]);
});

test('legacy glossary text migrates to rows', () => {
  assert.deepEqual(glossaryTextToRows('iPhone\nAI = 人工智慧'), [
    { src: 'iPhone', mode: 'keep', dst: '' },
    { src: 'AI', mode: 'translate', dst: '人工智慧' },
  ]);
});

test('name modes: keep and annotate rules; translate adds nothing', () => {
  const block = buildPrefsBlock({ names: { people: 'keep', brands: 'annotate', places: 'translate' } }, 'Traditional Chinese');
  assert.match(block, /copy them exactly as written: people's names\./);
  assert.match(block, /For company, brand and product names: translate them as usual/);
  assert.match(block, /蘋果公司（Apple Inc\.）/);
  assert.doesNotMatch(block, /place names/);
  const fr = buildPrefsBlock({ names: { people: 'translate', brands: 'annotate', places: 'translate' } }, 'French');
  assert.match(fr, /蘋果公司 \(Apple Inc\.\)/); // ASCII brackets with a space outside CJK
});

import { restoreKeepCasing } from '../lib/prefs.js';

test('keep-as-is terms keep the source casing, not the glossary casing', () => {
  const g = [{ src: 'DECK', dst: '' }];
  assert.equal(
    restoreKeepCasing('Context: Gemini Enterprise app technical pitch deck', 'บริบท: Gemini Enterprise app technical pitch DECK', g),
    'บริบท: Gemini Enterprise app technical pitch deck');
  assert.equal(restoreKeepCasing('This deck can be presented', 'DECK นี้สามารถนำเสนอ', g), 'deck นี้สามารถนำเสนอ');
  // Source really is upper case → untouched
  assert.equal(restoreKeepCasing('DECK v2', 'DECK เวอร์ชัน 2', g), 'DECK เวอร์ชัน 2');
  // Whole words only: no change inside other words
  assert.equal(restoreKeepCasing('the deck', 'DECKING DECK', g), 'DECKING deck');
  // Term absent from the source → leave the translation alone
  assert.equal(restoreKeepCasing('hello', 'DECK', g), 'DECK');
  // Translate-as rules are not touched
  assert.equal(restoreKeepCasing('ai', 'AI', [{ src: 'AI', dst: '人工智慧' }]), 'AI');
});

test('prompt tells the model to keep the source capitalization', () => {
  const block = buildPrefsBlock({ glossary: [{ src: 'DECK', dst: '' }] }, 'Thai');
  assert.match(block, /capitalization/i);
});

import { normalizeNames, dropRedundantAnnotations, postprocessTranslation, DEFAULT_NAMES } from '../lib/prefs.js';

test('normalizeNames: defaults, new modes, and ≤ v1.6 true/false migration', () => {
  assert.deepEqual(normalizeNames({}), DEFAULT_NAMES);
  assert.deepEqual(DEFAULT_NAMES, { people: 'keep', brands: 'keep', places: 'translate' });
  assert.deepEqual(normalizeNames({ keep: { people: false, brands: true, places: true } }), { people: 'translate', brands: 'keep', places: 'keep' });
  assert.deepEqual(normalizeNames({ names: { people: 'annotate', brands: 'bogus' } }), { people: 'annotate', brands: 'keep', places: 'translate' });
});

test('dropRedundantAnnotations removes only notes that repeat the preceding text', () => {
  assert.equal(dropRedundantAnnotations('使用 Google（Google）服務'), '使用 Google服務');
  assert.equal(dropRedundantAnnotations('Gemini Enterprise (Gemini Enterprise) is'), 'Gemini Enterprise is');
  assert.equal(dropRedundantAnnotations('蘋果公司（Apple Inc.）'), '蘋果公司（Apple Inc.）');
  assert.equal(dropRedundantAnnotations('營收（USD）'), '營收（USD）');
});

test('postprocess only strips duplicates when a category uses annotate', () => {
  const p = (names) => ({ names, glossary: [] });
  assert.equal(postprocessTranslation('x', 'Google（Google）', p({ people: 'keep', brands: 'annotate', places: 'translate' })), 'Google');
  assert.equal(postprocessTranslation('x', 'Google（Google）', p({ people: 'keep', brands: 'keep', places: 'translate' })), 'Google（Google）');
});

test('default prefs are no longer empty (people + brands kept by default)', () => {
  assert.notEqual(buildPrefsBlock({}, 'Japanese'), '');
});
