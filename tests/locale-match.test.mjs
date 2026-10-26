import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocale } from '../i18n/languages.js';

test('browser locale → our locale, Chinese by script and region', () => {
  const cases = { 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh-Hant-SG': 'zh-TW', zh: 'zh-TW',
    'zh-CN': 'zh-CN', 'zh-SG': 'zh-CN', 'zh-MY': 'zh-CN', 'zh-Hans-HK': 'zh-CN', zh_CN: 'zh-CN',
    'ja-JP': 'ja', 'de-AT': 'de', 'pt-BR': 'en', '': 'en' };
  for (const [input, want] of Object.entries(cases)) assert.equal(matchLocale(input), want, input);
});
