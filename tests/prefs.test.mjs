import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlossary, mergeGlossaries, buildPrefsBlock, prefsFingerprint, normalizePrefs } from '../lib/prefs.js';
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
  assert.match(block, /"Acme" → keep "Acme" untranslated/);
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
