import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureShapes, measureFitBefore, planFontScaling, estimateTextHeight } from '../lib/overflow.js';

const EMU = 12700;
const deck = (text, pt = 14) => ({ slides: [{ pageElements: [{ objectId: 'b', size: { width: { magnitude: 200 * EMU, unit: 'EMU' }, height: { magnitude: 60 * EMU, unit: 'EMU' } },
  shape: { text: { textElements: [{ startIndex: 0, endIndex: text.length, textRun: { content: text, style: { fontSize: { magnitude: pt, unit: 'PT' } } } }] } } }] }] });

test('height estimate grows with wrapped lines', () => {
  const box = { widthPt: 200, heightPt: 60, textElements: deck('x'.repeat(200)).slides[0].pageElements[0].shape.text.textElements };
  assert.ok(estimateTextHeight(box) > estimateTextHeight(box, 0.6));
});

test('long translation is shrunk further; still too long is reported', () => {
  const src = deck('Short title here\n');
  const before = measureShapes(src); const fit = measureFitBefore(src);
  const mid = planFontScaling(before, deck('ずっと長い翻訳文がここに入ります。\n'), fit);
  assert.equal(mid.overflowSlides.length, 0);
  assert.ok(mid.requests.length > 0);
  const huge = planFontScaling(before, deck('とても長い翻訳文'.repeat(20) + '\n'), fit);
  assert.deepEqual(huge.overflowSlides, [1]);
  assert.equal(huge.requests[0].updateTextStyle.style.fontSize.magnitude, 8.5);
});

test('a box that already overflowed before translation is not reported', () => {
  const src = deck('word '.repeat(200));
  const plan = planFontScaling(measureShapes(src), deck('単語'.repeat(400)), measureFitBefore(src));
  assert.deepEqual(plan.overflowSlides, []);
});
