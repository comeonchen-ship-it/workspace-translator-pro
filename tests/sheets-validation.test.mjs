import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listValidationValues, translateListValidation } from '../lib/sheets.js';

const rule = { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Baseline' }, { userEnteredValue: 'Optional / TBD' }, { userEnteredValue: 'Excluded' }] }, showCustomUi: true, strict: true };

test('dropdown list values are collected for translation', () => {
  assert.deepEqual(listValidationValues({ dataValidation: rule }), ['Baseline', 'Optional / TBD', 'Excluded']);
  assert.deepEqual(listValidationValues({ dataValidation: { condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: '5' }] } } }), []);
});

test('dropdown list is translated with the same map as the cells', () => {
  const map = new Map([['Baseline', '基準'], ['Optional / TBD', '選用／待定'], ['Excluded', '排除']]);
  const out = translateListValidation(rule, map);
  assert.deepEqual(out.condition.values.map((v) => v.userEnteredValue), ['基準', '選用／待定', '排除']);
  assert.equal(out.strict, true);
  assert.equal(translateListValidation(rule, new Map()), null);
});
