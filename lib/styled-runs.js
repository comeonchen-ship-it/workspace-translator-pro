/**
 * Mixed-format paragraphs in Google Slides (v1.7).
 *
 * Problem: a sentence like "Google Cloud is [the only provider] to offer…" with
 * the bracketed words in another colour. Translation reorders words, so a plain
 * replaceAllText leaves the coloured run behind (overlapping the new text).
 *
 * Approach: for every paragraph whose visible runs differ in style, send the
 * text with markers around the non-base runs:
 *     Google Cloud is ⟦1⟧the only provider⟦/1⟧ to offer …
 * The model keeps the markers around the corresponding translated words:
 *     Google Cloud 是⟦1⟧唯一⟦/1⟧能在…提供第一方解決方案的供應商
 * We then delete the paragraph text, insert the plain translation, and re-apply
 * the base style to all of it and each run's style to its marked span.
 * If the markers come back broken, the paragraph is written in the base style
 * only — never left overlapping. Pure module: unit-tested under Node.
 */
import { isTranslatable } from './text-extract.js';

/** True if a translated marked string can be rebuilt with its formatting. */
export function marksIntact(tagged, translated) {
  const ids = [...new Set([...String(tagged).matchAll(/⟦(\d+)⟧/g)].map((m) => Number(m[1])))];
  return !ids.length || parseMarked(translated, ids) !== null;
}

export const OPEN = (n) => `⟦${n}⟧`;
export const CLOSE = (n) => `⟦/${n}⟧`;
const MARK_RE = /⟦(\/?)(\d+)⟧/g;

function styleKey(style) {
  // Deep, key-order independent comparison of a TextStyle.
  const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return JSON.stringify(norm(style || {}));
}

/** Splits a shape's textElements into paragraphs of {start, end, runs:[{start,end,text,style}]}. */
export function paragraphsOf(textElements) {
  const paras = [];
  let cur = { runs: [] };
  for (const te of textElements || []) {
    if (te.autoText) { cur.hasAuto = true; continue; }   // slide numbers etc.: never delete them
    const run = te.textRun;
    if (!run || run.content == null) continue;
    let offset = te.startIndex || 0;
    // A run may contain one or more paragraph breaks.
    const pieces = run.content.split('\n');
    pieces.forEach((piece, i) => {
      if (piece.length) cur.runs.push({ start: offset, end: offset + piece.length, text: piece, style: run.style || {} });
      offset += piece.length;
      if (i < pieces.length - 1) {          // hit '\n'
        if (cur.runs.length) paras.push(cur);
        cur = { runs: [] };
        if (te.autoText) cur.hasAuto = true;
        offset += 1;
      }
    });
  }
  if (cur.runs.length) paras.push(cur);
  for (const p of paras) {
    p.start = p.runs[0].start;
    p.end = p.runs[p.runs.length - 1].end;
  }
  return paras;
}

/**
 * Joins paragraphs that are really one sentence broken over several lines
 * (designers often press Enter instead of letting text wrap): the previous line
 * has no sentence-ending punctuation and the next starts with a lowercase letter.
 * The merged block spans the original line breaks, which become spaces.
 */
export function mergeContinuedParagraphs(paras) {
  const out = [];
  for (const p of paras) {
    const prev = out[out.length - 1];
    const prevText = prev ? prev.runs.map((r) => r.text).join('').trim() : '';
    const nextText = p.runs.map((r) => r.text).join('').trim();
    const continues = prev && !prev.hasAuto && !p.hasAuto
      && !/[.!?:;。！？：；…]$/.test(prevText) && /^\p{Ll}/u.test(nextText);
    if (continues) {
      const last = prev.runs[prev.runs.length - 1];
      prev.runs.push({ start: prev.end, end: p.start, text: '\u000b', style: last.style });
      prev.runs.push(...p.runs);
      prev.end = p.end;
      prev.lines.push(nextText);
    } else {
      out.push({ ...p, runs: [...p.runs], lines: [nextText] });
    }
  }
  return out;
}

/**
 * A paragraph needs the styled path when at least two visible (non-blank) runs
 * have different styles. Soft line breaks (\v) inside become spaces so the
 * sentence is translated as one sentence.
 */
export function buildStyledParagraph(para) {
  if (para.hasAuto) return null;
  const visible = para.runs.filter((r) => r.text.trim());
  if (visible.length < 2) return null;
  const counts = new Map();
  for (const r of visible) {
    const k = styleKey(r.style);
    counts.set(k, (counts.get(k) || 0) + r.text.trim().length);
  }
  if (counts.size < 2) return null;
  const baseKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const baseRun = visible.find((r) => styleKey(r.style) === baseKey);

  const clean = (s) => s.replace(/\u000b/g, ' ');
  let tagged = '';
  let plain = '';
  const segments = [];
  let n = 0;
  let prevKey = null;
  for (const r of para.runs) {
    const k = styleKey(r.style);
    const text = clean(r.text);
    plain += text;
    if (k === baseKey || !r.text.trim()) {
      tagged += text;
      prevKey = null;
      continue;
    }
    if (prevKey === k) {                      // merge adjacent runs of the same style
      tagged = tagged.slice(0, -CLOSE(n).length) + text + CLOSE(n);
      continue;
    }
    n += 1;
    segments.push({ id: n, style: r.style });
    tagged += OPEN(n) + text + CLOSE(n);
    prevKey = k;
  }
  const trimmed = plain.trim();
  if (!isTranslatable(trimmed)) return null;
  // Fields to (re)apply: every style property used anywhere in the paragraph,
  // so properties a span doesn't set fall back to the base / inherited value.
  const fields = [...new Set(para.runs.flatMap((r) => Object.keys(r.style || {})))];
  // raw: the line as the normal extractor sees it (soft breaks kept), so the
  // caller can drop it from the plain replaceAllText path.
  const raw = para.runs.map((r) => r.text).join('').trim();
  // Every source line this block covers (one, or several for a merged sentence).
  const raws = para.lines || [raw];
  const lead = plain.match(/^\s*/)[0];
  const trail = plain.match(/\s*$/)[0];
  return { start: para.start, end: para.end, tagged: tagged.trim(), plain: trimmed, raw, raws, lead, trail, baseStyle: baseRun.style, segments, fields };
}

/** Walks slide elements (incl. groups and table cells) → styled paragraphs with their location. */
export function collectStyledParagraphs(slides) {
  const out = [];
  const visit = (elements, pageId) => {
    for (const el of elements || []) {
      if (el.shape?.text?.textElements) {
        for (const p of mergeContinuedParagraphs(paragraphsOf(el.shape.text.textElements))) {
          const sp = buildStyledParagraph(p);
          if (sp) out.push({ ...sp, objectId: el.objectId, pageId });
        }
      } else if (el.table?.tableRows) {
        el.table.tableRows.forEach((row, r) => (row.tableCells || []).forEach((cell, c) => {
          for (const p of mergeContinuedParagraphs(paragraphsOf(cell.text?.textElements))) {
            const sp = buildStyledParagraph(p);
            if (sp) out.push({ ...sp, objectId: el.objectId, cellLocation: { rowIndex: r, columnIndex: c }, pageId });
          }
        }));
      } else if (el.group?.children) {
        visit(el.group.children, pageId);
      }
    }
  };
  for (const slide of slides || []) {
    visit(slide.pageElements, slide.objectId);
    const notes = slide.slideProperties?.notesPage;
    if (notes?.pageElements) visit(notes.pageElements, notes.objectId);
  }
  return out;
}

/**
 * Parses a translated, marked string. Returns {plain, spans:[{id,start,end}]}
 * when every expected marker appears exactly once as a well-formed pair, else null.
 */
export function parseMarked(translated, ids) {
  const want = new Set(ids);
  const spans = [];
  const open = new Map();
  let plain = '';
  let last = 0;
  MARK_RE.lastIndex = 0;
  let m;
  while ((m = MARK_RE.exec(translated))) {
    plain += translated.slice(last, m.index);
    last = m.index + m[0].length;
    const id = Number(m[2]);
    if (!want.has(id)) return null;
    if (!m[1]) {
      if (open.has(id) || spans.some((s) => s.id === id)) return null;
      open.set(id, plain.length);
    } else {
      if (!open.has(id)) return null;
      spans.push({ id, start: open.get(id), end: plain.length });
      open.delete(id);
    }
  }
  plain += translated.slice(last);
  if (open.size || spans.length !== want.size) return null;
  return { plain, spans };
}

const stripMarks = (s) => String(s).replace(MARK_RE, '');

/**
 * Slides batchUpdate requests that rewrite each styled paragraph. Requests for
 * the same object run from the last paragraph to the first so indices stay valid.
 * Returns { requests, rebuilt, fallbacks }.
 */
export function buildStyledRequests(paragraphs, translationsMap) {
  const requests = [];
  let rebuilt = 0;
  let fallbacks = 0;
  const loc = (p) => ({ objectId: p.objectId, ...(p.cellLocation ? { cellLocation: p.cellLocation } : {}) });
  const ordered = [...paragraphs].sort((a, b) =>
    (a.objectId + JSON.stringify(a.cellLocation || '')).localeCompare(b.objectId + JSON.stringify(b.cellLocation || ''))
      || b.start - a.start);
  for (const p of ordered) {
    const translated = translationsMap.get(p.tagged);
    if (!translated) continue;
    let parsed = parseMarked(translated, p.segments.map((s) => s.id));
    if (!parsed) {
      fallbacks++;
      parsed = { plain: stripMarks(translated), spans: [] };
    } else {
      rebuilt++;
    }
    if (!parsed.plain.trim()) continue;
    // Restore the paragraph's original indentation / trailing spaces.
    const lead = p.lead || '';
    const text = lead + parsed.plain.trim() + (p.trail || '');
    const shift = lead.length - (parsed.plain.length - parsed.plain.trimStart().length);
    parsed.spans = parsed.spans.map((sp) => ({ ...sp, start: sp.start + shift, end: sp.end + shift }));
    const fields = p.fields.length ? p.fields.join(',') : null;
    requests.push({ deleteText: { ...loc(p), textRange: { type: 'FIXED_RANGE', startIndex: p.start, endIndex: p.end } } });
    requests.push({ insertText: { ...loc(p), insertionIndex: p.start, text } });
    if (fields) {
      requests.push({ updateTextStyle: { ...loc(p), textRange: { type: 'FIXED_RANGE', startIndex: p.start, endIndex: p.start + text.length }, style: p.baseStyle, fields } });
      for (const span of parsed.spans) {
        if (span.end <= span.start) continue;
        const seg = p.segments.find((s) => s.id === span.id);
        requests.push({ updateTextStyle: { ...loc(p), textRange: { type: 'FIXED_RANGE', startIndex: p.start + span.start, endIndex: p.start + span.end }, style: seg.style, fields } });
      }
    }
  }
  return { requests, rebuilt, fallbacks };
}

// ── Overlapping text boxes ──────────────────────────────────────────────────
// Designers sometimes fake a coloured phrase with a second text box laid over
// the first. Those are independent shapes, so translation can't keep them
// aligned; we report the slides so the user can check them.

function box(el) {
  const w = el.size?.width?.magnitude;
  const h = el.size?.height?.magnitude;
  const t = el.transform || {};
  if (!w || !h) return null;
  const x = t.translateX || 0;
  const y = t.translateY || 0;
  return { x, y, w: w * (t.scaleX ?? 1), h: h * (t.scaleY ?? 1) };
}

const hasText = (el) => (el.shape?.text?.textElements || []).some((te) => te.textRun?.content?.trim());

/** 1-based slide numbers (within `slides`) that contain overlapping text boxes. */
export function slidesWithOverlappingText(slides, numberOf = (i) => i + 1) {
  const result = [];
  (slides || []).forEach((slide, i) => {
    const boxes = (slide.pageElements || []).filter(hasText).map(box).filter(Boolean);
    let found = false;
    for (let a = 0; a < boxes.length && !found; a++) {
      for (let b = a + 1; b < boxes.length && !found; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const ix = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const iy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        if (ix <= 0 || iy <= 0) continue;
        const smaller = Math.min(A.w * A.h, B.w * B.h);
        if ((ix * iy) / smaller > 0.3) found = true;
      }
    }
    if (found) result.push(numberOf(i));
  });
  return result;
}
