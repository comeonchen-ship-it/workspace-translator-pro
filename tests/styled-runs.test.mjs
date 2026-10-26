import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paragraphsOf, buildStyledParagraph, collectStyledParagraphs, parseMarked, buildStyledRequests, slidesWithOverlappingText } from '../lib/styled-runs.js';

const WHITE = { foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } }, fontSize: { magnitude: 40, unit: 'PT' } };
const BLUE = { foregroundColor: { opaqueColor: { rgbColor: { blue: 1 } } }, fontSize: { magnitude: 40, unit: 'PT' } };
// "Google Cloud is\vthe only provider\vto offer first-party solutions.\n"
const els = () => {
  const runs = [['Google Cloud is\u000b', WHITE], ['the only provider', BLUE], ['\u000bto offer first-party solutions.\n', WHITE]];
  let i = 0;
  return runs.map(([content, style]) => { const e = { startIndex: i, endIndex: i + content.length, textRun: { content, style } }; i += content.length; return e; });
};

test('paragraphsOf splits on newlines and keeps indices', () => {
  const ps = paragraphsOf(els());
  assert.equal(ps.length, 1);
  assert.equal(ps[0].start, 0);
  assert.equal(ps[0].end, 'Google Cloud is\u000bthe only provider\u000bto offer first-party solutions.'.length);
});

test('buildStyledParagraph marks the differently styled run and normalises soft breaks', () => {
  const sp = buildStyledParagraph(paragraphsOf(els())[0]);
  assert.equal(sp.tagged, 'Google Cloud is ⟦1⟧the only provider⟦/1⟧ to offer first-party solutions.');
  assert.deepEqual(sp.baseStyle, WHITE);
  assert.deepEqual(sp.segments, [{ id: 1, style: BLUE }]);
  assert.deepEqual(sp.fields.sort(), ['fontSize', 'foregroundColor']);
});

test('single-style paragraphs are left to the normal path', () => {
  assert.equal(buildStyledParagraph(paragraphsOf([{ startIndex: 0, textRun: { content: 'Hello world\n', style: WHITE } }])[0]), null);
});

test('parseMarked: valid, missing, duplicated, unknown, unbalanced', () => {
  assert.deepEqual(parseMarked('Google Cloud 是⟦1⟧唯一⟦/1⟧的供應商', [1]), { plain: 'Google Cloud 是唯一的供應商', spans: [{ id: 1, start: 14, end: 16 }] });
  assert.equal(parseMarked('沒有標記', [1]), null);
  assert.equal(parseMarked('⟦1⟧a⟦/1⟧⟦1⟧b⟦/1⟧', [1]), null);
  assert.equal(parseMarked('⟦2⟧a⟦/2⟧', [1]), null);
  assert.equal(parseMarked('⟦1⟧a', [1]), null);
});

test('buildStyledRequests rewrites text and re-applies base + span styles', () => {
  const [p] = collectStyledParagraphs([{ objectId: 'slide1', pageElements: [{ objectId: 'box1', shape: { text: { textElements: els() } } }] }]);
  const map = new Map([[p.tagged, 'Google Cloud 是⟦1⟧唯一⟦/1⟧的供應商']]);
  const { requests, rebuilt, fallbacks } = buildStyledRequests([p], map);
  assert.equal(rebuilt, 1); assert.equal(fallbacks, 0);
  assert.deepEqual(requests.map((r) => Object.keys(r)[0]), ['deleteText', 'insertText', 'updateTextStyle', 'updateTextStyle']);
  assert.equal(requests[1].insertText.text, 'Google Cloud 是唯一的供應商');
  assert.deepEqual(requests[3].updateTextStyle.textRange, { type: 'FIXED_RANGE', startIndex: 14, endIndex: 16 });
  assert.deepEqual(requests[3].updateTextStyle.style, BLUE);
  assert.equal(requests[2].updateTextStyle.textRange.endIndex, 'Google Cloud 是唯一的供應商'.length);
});

test('broken markers fall back to base style only (no overlap)', () => {
  const [p] = collectStyledParagraphs([{ objectId: 's', pageElements: [{ objectId: 'b', shape: { text: { textElements: els() } } }] }]);
  const { requests, fallbacks } = buildStyledRequests([p], new Map([[p.tagged, 'Google Cloud 是唯一的供應商 ⟦/1⟧']]));
  assert.equal(fallbacks, 1);
  assert.equal(requests[1].insertText.text, 'Google Cloud 是唯一的供應商');
  assert.equal(requests.filter((r) => r.updateTextStyle).length, 1);
});

test('multiple paragraphs in one box are rewritten bottom-up; table cells keep cellLocation', () => {
  const text = (start, a, b) => [{ startIndex: start, textRun: { content: a, style: WHITE } }, { startIndex: start + a.length, textRun: { content: b, style: BLUE } }];
  const two = [...text(0, 'First ', 'one\n'), ...text(10, 'Second ', 'two\n')];
  const paras = collectStyledParagraphs([{ objectId: 's', pageElements: [
    { objectId: 'b', shape: { text: { textElements: two } } },
    { objectId: 't', table: { tableRows: [{ tableCells: [{ text: { textElements: text(0, 'Cell ', 'x\n') } }] }] } },
  ] }]);
  assert.equal(paras.length, 3);
  const map = new Map(paras.map((p) => [p.tagged, p.tagged.replace('First', '一').replace('Second', '二').replace('Cell', '格')]));
  const { requests } = buildStyledRequests(paras, map);
  const deletes = requests.filter((r) => r.deleteText).map((r) => r.deleteText);
  const inBox = deletes.filter((d) => d.objectId === 'b').map((d) => d.textRange.startIndex);
  assert.deepEqual(inBox, [10, 0]);
  assert.deepEqual(deletes.find((d) => d.objectId === 't').cellLocation, { rowIndex: 0, columnIndex: 0 });
});

test('overlapping text boxes are reported per slide', () => {
  const shape = (x, y, w, h) => ({ size: { width: { magnitude: w }, height: { magnitude: h } }, transform: { translateX: x, translateY: y, scaleX: 1, scaleY: 1 },
    shape: { text: { textElements: [{ textRun: { content: 'Hi\n' } }] } } });
  const slides = [
    { pageElements: [shape(0, 0, 100, 100), shape(300, 0, 100, 100)] },
    { pageElements: [shape(0, 0, 400, 300), shape(10, 120, 200, 40)] },
  ];
  assert.deepEqual(slidesWithOverlappingText(slides), [2]);
});

test('paragraphs containing a slide number (autoText) are not rebuilt', () => {
  const t = [{ startIndex: 0, textRun: { content: 'Page ', style: WHITE } }, { startIndex: 5, autoText: { type: 'SLIDE_NUMBER' } },
    { startIndex: 6, textRun: { content: ' of deck\n', style: BLUE } }];
  assert.equal(buildStyledParagraph(paragraphsOf(t)[0]), null);
});

test('leading indentation is kept and spans shift with it', () => {
  const t = [{ startIndex: 0, textRun: { content: '  Hello ', style: WHITE } }, { startIndex: 8, textRun: { content: 'world\n', style: BLUE } }];
  const [p] = collectStyledParagraphs([{ objectId: 's', pageElements: [{ objectId: 'b', shape: { text: { textElements: t } } }] }]);
  const { requests } = buildStyledRequests([p], new Map([[p.tagged, '你好⟦1⟧世界⟦/1⟧']]));
  assert.equal(requests[1].insertText.text, '  你好世界');
  assert.deepEqual(requests[3].updateTextStyle.textRange, { type: 'FIXED_RANGE', startIndex: 4, endIndex: 6 });
});

import { marksIntact } from '../lib/styled-runs.js';
test('marksIntact gates caching', () => {
  assert.equal(marksIntact('a ⟦1⟧b⟦/1⟧', 'x ⟦1⟧y⟦/1⟧'), true);
  assert.equal(marksIntact('a ⟦1⟧b⟦/1⟧', 'x y'), false);
  assert.equal(marksIntact('plain', 'anything'), true);
});
