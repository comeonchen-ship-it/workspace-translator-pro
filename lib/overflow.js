/**
 * Keeps translated Slides text inside its boxes. Translations often run 20–40%
 * longer (e.g. EN→DE/FR), and the Slides API cannot turn on "shrink on
 * overflow", so we shrink explicit font sizes ourselves.
 *
 * Approach: measure each shape's text "visual width" before and after
 * translation (CJK/full-width counts 2, other chars 1). If it grew by more than
 * GROWTH_THRESHOLD, scale every run that has an explicit fontSize by
 * 1/sqrt(growth) — text area grows with width × lines — never below MIN_SCALE.
 * Runs that inherit their size from the layout are left alone: we cannot know
 * that size, and guessing could make a title tiny.
 */

export const GROWTH_THRESHOLD = 1.15;
export const MIN_SCALE = 0.6;
export const MIN_FONT_PT = 8;

/** Approximate rendered width of a string in "narrow character" units. */
export function visualWidth(text) {
  let w = 0;
  for (const ch of text || '') {
    const c = ch.codePointAt(0);
    if (ch === '\n') continue;
    // CJK, kana, hangul, full-width forms render roughly twice as wide.
    if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd)) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/**
 * Walks slides (and groups) → Map(key → box) for every text container: shapes
 * and table cells. key is the shape id, or "tableId#row.col" for a cell; box is
 * { objectId, cellLocation?, textElements }.
 */
export function collectTextShapes(presentation) {
  const boxes = new Map();
  const walk = (elements) => {
    for (const el of elements || []) {
      if (!el.objectId) continue;
      if (el.shape?.text?.textElements) {
        boxes.set(el.objectId, { objectId: el.objectId, textElements: el.shape.text.textElements, slideIndex, ...boxSizePt(el) });
      } else if (el.table?.tableRows) {
        el.table.tableRows.forEach((row, r) => (row.tableCells || []).forEach((cell, c) => {
          if (cell.text?.textElements) {
            boxes.set(`${el.objectId}#${r}.${c}`, {
              objectId: el.objectId, cellLocation: { rowIndex: r, columnIndex: c }, textElements: cell.text.textElements,
            });
          }
        }));
      } else if (el.group?.children) {
        walk(el.group.children);
      }
    }
  };
  let slideIndex = 0;
  for (const slide of presentation?.slides || []) { walk(slide.pageElements); slideIndex++; }
  return boxes;
}

function boxText(box) {
  return box.textElements.map((te) => te.textRun?.content || '').join('');
}

const toPt = (d) => (d?.magnitude ? (d.unit === 'PT' ? d.magnitude : d.magnitude / 12700) : 0);

/** Shape size in points ({} when unknown). Group-nested scaling is ignored. */
function boxSizePt(el) {
  const w = toPt(el.size?.width) * Math.abs(el.transform?.scaleX ?? 1);
  const h = toPt(el.size?.height) * Math.abs(el.transform?.scaleY ?? 1);
  return w > 0 && h > 0 ? { widthPt: w, heightPt: h } : {};
}

const INSET_X = 14.4; // Slides' default left + right text inset
const INSET_Y = 7.2;
const DEFAULT_PT = 14; // inherited sizes are unknown; assume body text

/**
 * Rough rendered height (pt) of a shape's text at `scale`: each paragraph wraps
 * at the box width (a narrow char ≈ 0.5em, CJK ≈ 1em), line height 1.2em.
 */
export function estimateTextHeight(box, scale = 1) {
  const usable = Math.max(10, box.widthPt - INSET_X);
  let height = 0;
  let para = { w: 0, pt: 0 };
  const flush = () => {
    if (para.pt) height += Math.max(1, Math.ceil(para.w / usable)) * para.pt * 1.2;
    para = { w: 0, pt: 0 };
  };
  for (const te of box.textElements) {
    const run = te.textRun;
    if (!run) continue;
    const pt = (run.style?.fontSize?.magnitude || DEFAULT_PT) * (run.style?.fontSize?.magnitude ? scale : 1);
    for (const piece of run.content.split(/(\n)/)) {
      if (piece === '\n') { if (!para.pt) para.pt = pt; flush(); continue; }
      if (!piece) continue;
      para.w += visualWidth(piece) * pt * 0.5;
      para.pt = Math.max(para.pt, pt);
    }
  }
  flush();
  return height;
}

const fits = (box, scale) => estimateTextHeight(box, scale) <= (box.heightPt - INSET_Y) * 1.05;

/** Map(box key → true when its original text fit) — taken before translation is written. */
export function measureFitBefore(presentation) {
  const out = new Map();
  for (const [key, box] of collectTextShapes(presentation)) if (box.heightPt) out.set(key, fits(box, 1));
  return out;
}

/** Map(box key → visualWidth) — taken before translation is written. */
export function measureShapes(presentation) {
  const out = new Map();
  for (const [key, box] of collectTextShapes(presentation)) out.set(key, visualWidth(boxText(box)));
  return out;
}

/**
 * Compares widths before vs. the translated presentation and returns
 * { requests, shapesAdjusted, overflowSlides } — Slides updateTextStyle requests,
 * plus the 1-based slide numbers whose translated text still looks too big for
 * a box that held the original fine. With shrink=false nothing is resized; the
 * report is still produced.
 */
export function planFontScaling(widthsBefore, presentationAfter, fitBefore = new Map(), shrink = true) {
  const requests = [];
  let shapesAdjusted = 0;
  const overflow = new Set();
  for (const [key, box] of collectTextShapes(presentationAfter)) {
    const before = widthsBefore.get(key);
    if (!before) continue;
    const growth = visualWidth(boxText(box)) / before;
    if (growth <= GROWTH_THRESHOLD) continue;
    let scale = 1;
    if (shrink) {
      scale = Math.max(MIN_SCALE, 1 / Math.sqrt(growth));
      // Shrink further when the box would still overflow, down to the floor.
      if (box.heightPt) while (scale > MIN_SCALE + 1e-9 && !fits(box, scale)) scale = Math.max(MIN_SCALE, scale - 0.05);
    }
    if (box.heightPt && fitBefore.get(key) && !fits(box, scale)) overflow.add(box.slideIndex + 1);
    if (scale >= 1) continue;
    let touched = false;
    for (const te of box.textElements) {
      const size = te.textRun?.style?.fontSize;
      if (!te.textRun || !size?.magnitude || te.endIndex == null) continue;
      const newSize = Math.max(MIN_FONT_PT, Math.round(size.magnitude * scale * 2) / 2);
      if (newSize >= size.magnitude) continue;
      requests.push({
        updateTextStyle: {
          objectId: box.objectId,
          ...(box.cellLocation ? { cellLocation: box.cellLocation } : {}),
          textRange: { type: 'FIXED_RANGE', startIndex: te.startIndex || 0, endIndex: te.endIndex },
          style: { fontSize: { magnitude: newSize, unit: size.unit || 'PT' } },
          fields: 'fontSize',
        },
      });
      touched = true;
    }
    if (touched) shapesAdjusted++;
  }
  return { requests, shapesAdjusted, overflowSlides: [...overflow].sort((a, b) => a - b) };
}

// ── Google Sheets column fitting ─────────────────────────────────────────────
// Sheets' own autoResizeDimensions shrinks untouched columns, measures CJK text
// poorly and has no upper bound, so one long cell could make a column huge.
// Instead: only widen columns that received translations, cap the width, and
// wrap the cells that still don't fit.

export const SHEET_PX_PER_UNIT = 7;     // ~10pt default font, narrow char
export const SHEET_PADDING_PX = 12;
export const SHEET_DEFAULT_COL_PX = 100;
export const SHEET_MAX_COL_PX = 400;

/** Pixel width needed for the longest line of a cell. */
export function cellWidthPx(text) {
  const longest = Math.max(0, ...String(text || '').split('\n').map(visualWidth));
  return longest * SHEET_PX_PER_UNIT + SHEET_PADDING_PX;
}

/**
 * Whether a translated cell can need more room than it had. Only cells whose
 * original text fitted their own column, that do not spill into an empty
 * neighbour, are not merged, and are not set to wrap/clip, are candidates —
 * everything else displayed through other means and must not change width.
 */
export function needsColumnFit(cell, columnWidth) {
  if (cell.inMerge || cell.rightEmpty) return false;
  if (cell.wrap === 'WRAP' || cell.wrap === 'CLIP') return false;
  const before = cellWidthPx(cell.original ?? '');
  const after = cellWidthPx(cell.text);
  return after > before && before <= columnWidth && after > columnWidth;
}

/**
 * @param {number} sheetId
 * @param {number[]} currentWidths  pixelSize per column index (missing → default)
 * @param {{row:number,col:number,text:string,original?:string,inMerge?:boolean,
 *          rightEmpty?:boolean,wrap?:string}[]} translatedCells
 * @returns {{requests: object[], widened: number, wrapped: number}}
 */
export function planColumnFit(sheetId, currentWidths, translatedCells) {
  const byCol = new Map();
  for (const cell of translatedCells) {
    if (!needsColumnFit(cell, currentWidths[cell.col] || SHEET_DEFAULT_COL_PX)) continue;
    if (!byCol.has(cell.col)) byCol.set(cell.col, []);
    byCol.get(cell.col).push(cell);
  }
  const requests = [];
  let widened = 0;
  let wrapped = 0;
  for (const [col, cells] of byCol) {
    const current = currentWidths[col] || SHEET_DEFAULT_COL_PX;
    const needed = Math.max(...cells.map((c) => cellWidthPx(c.text)));
    // Never shrink; never exceed the cap (or double the original, whichever is larger).
    const cap = Math.max(current, Math.min(SHEET_MAX_COL_PX, current * 2));
    const target = Math.min(Math.max(current, needed), cap);
    if (target > current) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: target },
          fields: 'pixelSize',
        },
      });
      widened++;
    }
    for (const c of cells) {
      if (cellWidthPx(c.text) <= target) continue;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: c.row, endRowIndex: c.row + 1, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
          fields: 'userEnteredFormat.wrapStrategy',
        },
      });
      wrapped++;
    }
  }
  return { requests, widened, wrapped };
}
