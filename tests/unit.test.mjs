// Run: node --test 'tests/*.test.mjs'
// Zero-dependency unit tests for the pure helpers (no chrome.* needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonRobustly, repairJsonEscapes, extractJsonBlock } from '../translate.js';
import { isTranslatable, normalizeText, extractTextFromElements } from '../lib/text-extract.js';
import { classifyApiKey } from '../lib/key-format.js';

test('parseJsonRobustly: plain, fenced, and trailing-text responses', () => {
  assert.deepEqual(parseJsonRobustly('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseJsonRobustly('```json\n{"t":["x"]}\n```'), { t: ['x'] });
  assert.deepEqual(parseJsonRobustly('Here you go: ["x"] hope it helps'), ['x']);
});

test('parseJsonRobustly: rescues invalid escapes (docs/05 H4)', () => {
  assert.deepEqual(parseJsonRobustly(String.raw`["C:\Users\me", "\xyz"]`), [String.raw`C:\Users\me`, String.raw`\xyz`]);
});

test('parseJsonRobustly: still throws on garbage', () => {
  assert.throws(() => parseJsonRobustly('not json at all'));
});

test('repairJsonEscapes leaves valid escapes alone', () => {
  const ok = '["a\\"b", "c\\\\d", "e\\nf", "\\u00e9"]';
  assert.equal(repairJsonEscapes(ok), ok);
});

test('extractJsonBlock finds the outermost block', () => {
  assert.equal(extractJsonBlock('pre {"a":[1,{"b":2}]} post'), '{"a":[1,{"b":2}]}');
});

test('isTranslatable skips URLs, emails, numbers, times', () => {
  for (const s of ['https://x.com/a', 'www.x.com', 'a@b.co', '12,345.6', '2026-10-25', '10:30 pm', '-', '']) {
    assert.equal(isTranslatable(s), false, s);
  }
  for (const s of ['Hello', '你好', 'A', 'Q3 revenue', '12 maps']) {
    assert.equal(isTranslatable(s), true, s);
  }
});

test('normalizeText unifies newlines and trims', () => {
  assert.equal(normalizeText('  a\r\nb\rc  '), 'a\nb\nc');
});

test('extractTextFromElements collects per-page lines', () => {
  const pageTextMap = new Map();
  const unique = new Set();
  const elements = [{ shape: { text: { textElements: [{ textRun: { content: 'Title\nSubtitle\n' } }, { textRun: { content: '42\n' } }] } } }];
  extractTextFromElements(elements, pageTextMap, 'p1', unique);
  assert.deepEqual([...unique].sort(), ['Subtitle', 'Title']);
  assert.deepEqual([...pageTextMap.get('p1')].sort(), ['Subtitle', 'Title']);
});

test('classifyApiKey is advisory and future-proof', () => {
  assert.equal(classifyApiKey('gemini', 'AIzaSy' + 'x'.repeat(33)), 'ok');
  assert.equal(classifyApiKey('gemini', 'AQ.Ab8RN6JKgdqSM1fl1Z8aEaRArL'), 'ok');
  assert.equal(classifyApiKey('gemini', 'ZZ.some-future-format-key'), 'unknown');
  assert.equal(classifyApiKey('openai', 'sk-proj-abcdefghijkl'), 'ok');
  assert.equal(classifyApiKey('claude', 'sk-ant-api03-abcdefgh'), 'ok');
  assert.equal(classifyApiKey('custom', 'anything-long-enough'), 'ok');
  assert.equal(classifyApiKey('gemini', 'short'), 'bad');
});
