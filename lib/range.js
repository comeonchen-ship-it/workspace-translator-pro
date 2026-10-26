/**
 * Parses a 1-based slide range such as "3-10, 12".
 * @returns {Set<number>|null}  null for empty input (= all slides);
 *          throws RangeError for malformed input so the panel can say so.
 */
export function parseSlideRange(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const out = new Set();
  for (const part of text.split(/[,，、\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*[-–~～]\s*(\d+))?$/);
    if (!m) throw new RangeError(part);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a || b - a > 1000) throw new RangeError(part);
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

/** Google Sheets URL fragment "#gid=123" → 123, or null. */
export function sheetGidFromUrl(url) {
  const m = String(url || '').match(/[#&?]gid=(\d+)/);
  return m ? Number(m[1]) : null;
}
