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
export const MIN_SCALE = 0.7;
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
        boxes.set(el.objectId, { objectId: el.objectId, textElements: el.shape.text.textElements });
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
  for (const slide of presentation?.slides || []) walk(slide.pageElements);
  return boxes;
}

function boxText(box) {
  return box.textElements.map((te) => te.textRun?.content || '').join('');
}

/** Map(box key → visualWidth) — taken before translation is written. */
export function measureShapes(presentation) {
  const out = new Map();
  for (const [key, box] of collectTextShapes(presentation)) out.set(key, visualWidth(boxText(box)));
  return out;
}

/**
 * Compares widths before vs. the translated presentation and returns
 * { requests, shapesAdjusted } — Slides batchUpdate updateTextStyle requests.
 */
export function planFontScaling(widthsBefore, presentationAfter) {
  const requests = [];
  let shapesAdjusted = 0;
  for (const [key, box] of collectTextShapes(presentationAfter)) {
    const before = widthsBefore.get(key);
    if (!before) continue;
    const growth = visualWidth(boxText(box)) / before;
    if (growth <= GROWTH_THRESHOLD) continue;
    const scale = Math.max(MIN_SCALE, 1 / Math.sqrt(growth));
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
  return { requests, shapesAdjusted };
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
