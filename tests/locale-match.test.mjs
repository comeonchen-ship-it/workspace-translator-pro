import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocale } from '../i18n/languages.js';

test('browser locale → our locale, Chinese by script and region', () => {
  const cases = { 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant-SG': 'zh-TW', zh: 'zh-TW',
    'zh-CN': 'zh-CN', 'zh-SG': 'zh-CN', 'zh-MY': 'zh-CN', 'zh-Hans-HK': 'zh-CN', zh_CN: 'zh-CN',
    'ja-JP': 'ja', 'de-AT': 'de', 'pt-BR': 'en', '': 'en' };
  for (const [input, want] of Object.entries(cases)) assert.equal(matchLocale(input), want, input);
});

import { TARGET_LANGUAGES, targetOptionLabel } from '../i18n/languages.js';

test('target languages are named in the interface language, with the native name', () => {
  const ja = TARGET_LANGUAGES.find((l) => l.code === 'ja');
  const zhTW = TARGET_LANGUAGES.find((l) => l.code === 'zh-TW');
  assert.equal(targetOptionLabel(ja, 'en'), 'Japanese (日本語)');
  assert.equal(targetOptionLabel(zhTW, 'en'), 'Traditional Chinese (繁體中文)');
  assert.equal(targetOptionLabel(zhTW, 'zh-TW'), '繁體中文');
  assert.equal(targetOptionLabel(ja, 'zh-TW'), '日文 (日本語)');
});

test('interface-language picker puts the native name first, local name in brackets', async () => {
  const { UI_LANGUAGES, uiLabel } = await import('../i18n/languages.js');
  const ja = UI_LANGUAGES.find((l) => l.code === 'ja');
  assert.equal(uiLabel(ja, 'en'), '日本語 (Japanese)');
  assert.equal(uiLabel(ja, 'ja'), '日本語');
  assert.equal(uiLabel(ja), '日本語');
});
