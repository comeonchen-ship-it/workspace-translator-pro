// Run: node --test 'tests/*.test.mjs'
// Zero-dependency unit tests for the pure helpers (no chrome.* needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonRobustly, repairJsonEscapes, extractJsonBlock, geminiCooldownMs, effectiveCooldownMs, noteRateLimited } from '../translate.js';
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

test('formatShortDateTime: today / yesterday / older without seconds', async () => {
  globalThis.chrome ??= { storage: { local: { get: async () => ({}) } } };
  const { formatShortDateTime } = await import('../i18n/i18n.js');
  const now = new Date(2026, 9, 26, 15, 0).getTime();
  assert.match(formatShortDateTime(now - 3600e3, now), /^today /);
  assert.match(formatShortDateTime(now - 86400e3, now), /^yesterday /);
  const older = formatShortDateTime(now - 5 * 86400e3, now);
  assert.doesNotMatch(older, /:\d\d:\d\d/); // no seconds
});

test('Gemini spacing stays under each model free-tier RPM', () => {
  assert.equal(geminiCooldownMs('gemini-3.1-flash-lite'), 5000);      // 15 RPM
  assert.equal(geminiCooldownMs('gemini-2.5-flash-lite'), 8000);      // 10 RPM
  assert.equal(geminiCooldownMs('gemini-2.5-flash'), 16000);          // 5 RPM
  assert.equal(geminiCooldownMs('gemini-3.8-flash'), 16000);
  for (const [m, rpm] of [['gemini-3.1-flash-lite', 15], ['gemini-2.5-flash-lite', 10], ['gemini-2.5-flash', 5]]) {
    // most requests that fit in any 60 s window, kept below the limit
    assert.ok(Math.floor(60000 / geminiCooldownMs(m)) + 1 < rpm, m);
  }
});

test('a 429 doubles spacing up to 15 s, and it expires after 10 minutes', () => {
  const url = 'https://example.test/rate-boost';
  const t0 = 1_000_000;
  assert.equal(effectiveCooldownMs(url, 5000, t0), 5000);
  assert.equal(noteRateLimited(url, 5000, t0), 10000);
  assert.equal(effectiveCooldownMs(url, 5000, t0 + 1000), 10000);
  assert.equal(noteRateLimited(url, 5000, t0 + 2000), 15000);
  assert.equal(noteRateLimited(url, 5000, t0 + 3000), 15000);
  assert.equal(effectiveCooldownMs(url, 5000, t0 + 3000 + 10 * 60 * 1000), 5000);
  assert.equal(effectiveCooldownMs('https://example.test/other', 2000, t0), 2000);
});
