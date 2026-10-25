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

test('default prefs leave the prompt unchanged', () => {
  assert.equal(buildPrefsBlock({ tone: 'keep', glossary: [], custom: '' }, 'Japanese'), '');
  assert.equal(buildSystemPrompt('Japanese', null), buildSystemPrompt('Japanese', { tone: 'keep' }));
  assert.equal(prefsFingerprint(null), '');
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

test('keep categories add one do-not-translate rule', () => {
  const block = buildPrefsBlock({ keep: { people: true, brands: true, places: false } }, 'Korean');
  assert.match(block, /Do not translate these; copy them unchanged: people's names .*; company, brand/);
  assert.doesNotMatch(block, /place names/);
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
