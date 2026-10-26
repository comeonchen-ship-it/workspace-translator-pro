import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlideRange, sheetGidFromUrl } from '../lib/range.js';

test('parseSlideRange', () => {
  assert.equal(parseSlideRange(''), null);
  assert.deepEqual([...parseSlideRange('3-5, 8')], [3, 4, 5, 8]);
  assert.deepEqual([...parseSlideRange('1，2～3')], [1, 2, 3]);
  assert.throws(() => parseSlideRange('a-b'), RangeError);
  assert.throws(() => parseSlideRange('5-2'), RangeError);
  assert.throws(() => parseSlideRange('0'), RangeError);
});

test('sheetGidFromUrl', () => {
  assert.equal(sheetGidFromUrl('https://docs.google.com/spreadsheets/d/x/edit#gid=42'), 42);
  assert.equal(sheetGidFromUrl('https://docs.google.com/spreadsheets/d/x/edit'), null);
});
