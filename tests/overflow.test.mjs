import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualWidth, measureShapes, planFontScaling } from '../lib/overflow.js';

const pres = (runs) => ({
  slides: [{ pageElements: [{ objectId: 's1', shape: { text: { textElements: runs } } }] }],
});
const run = (content, start, size) => ({
  startIndex: start, endIndex: start + content.length,
  textRun: { content, style: size ? { fontSize: { magnitude: size, unit: 'PT' } } : {} },
});

test('visualWidth counts CJK as double width', () => {
  assert.equal(visualWidth('abc'), 3);
  assert.equal(visualWidth('翻譯'), 4);
  assert.equal(visualWidth('a\nb'), 2);
});

test('no change when translation is not much longer', () => {
  const before = measureShapes(pres([run('Quarterly results\n', 0, 24)]));
  const { requests } = planFontScaling(before, pres([run('Resultados trim.\n', 0, 24)]));
  assert.equal(requests.length, 0);
});

test('shrinks explicit sizes proportionally, keeps inherited sizes', () => {
  const before = measureShapes(pres([run('Sales up\n', 0, 20), run('Details\n', 9, null)]));
  const after = pres([run('Umsatzsteigerung deutlich\n', 0, 20), run('Einzelheiten dazu\n', 26, null)]);
  const { requests, shapesAdjusted } = planFontScaling(before, after);
  assert.equal(shapesAdjusted, 1);
  assert.equal(requests.length, 1); // only the run with an explicit size
  const size = requests[0].updateTextStyle.style.fontSize.magnitude;
  assert.ok(size < 20 && size >= 14, `size ${size}`);
});

test('never shrinks below 70% or 8pt', () => {
  const before = measureShapes(pres([run('Hi\n', 0, 10)]));
  const { requests } = planFontScaling(before, pres([run('A very very long translated sentence here\n', 0, 10)]));
  assert.equal(requests[0].updateTextStyle.style.fontSize.magnitude, 8);
});

import { planColumnFit } from '../lib/overflow.js';

test('sheets: widens only translated columns, capped, wraps the rest', () => {
  const { requests, widened, wrapped } = planColumnFit(7, [100, 100], [
    { row: 0, col: 0, text: 'Kurz' },
    { row: 1, col: 1, text: 'Umsatzentwicklung im dritten Quartal' },
    { row: 2, col: 1, text: 'x'.repeat(80) },
  ]);
  assert.equal(widened, 1);            // col 0 already fits
  const dim = requests.find((r) => r.updateDimensionProperties);
  assert.equal(dim.updateDimensionProperties.range.startIndex, 1);
  assert.equal(dim.updateDimensionProperties.properties.pixelSize, 200); // capped at 2× original
  assert.equal(wrapped, 2);            // both long cells exceed 200px
});

test('sheets: never shrinks a wide column', () => {
  const { requests } = planColumnFit(1, [500], [{ row: 0, col: 0, text: 'ok' }]);
  assert.equal(requests.length, 0);
});

test('slides tables: cells are measured and shrunk with cellLocation', () => {
  const table = (text) => ({ slides: [{ pageElements: [{ objectId: 't1', table: { tableRows: [{ tableCells: [
    { text: { textElements: [{ startIndex: 0, endIndex: 3, textRun: { content: 'ok\n', style: { fontSize: { magnitude: 14, unit: 'PT' } } } }] } },
    { text: { textElements: [{ startIndex: 0, endIndex: text.length, textRun: { content: text, style: { fontSize: { magnitude: 14, unit: 'PT' } } } }] } },
  ] }] } }] }] });
  const before = measureShapes(table('Sales\n'));
  const { requests } = planFontScaling(before, table('Umsatzentwicklung gesamt\n'));
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].updateTextStyle.cellLocation, { rowIndex: 0, columnIndex: 1 });
  assert.equal(requests[0].updateTextStyle.objectId, 't1');
});
