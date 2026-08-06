#!/usr/bin/env node
/**
 * i18n coverage report — how much of the UI is actually translatable.
 *
 *   node i18n/coverage.mjs            # report
 *   node i18n/coverage.mjs --min 80   # also fail below 80% overall
 *
 * Why this exists: validate.mjs checks that locale files agree with each other and
 * with the keys the code references. It is blind to the opposite failure — a
 * user-visible string that has NO key at all. That blind spot is what let Phase 1
 * ship with the settings panel at 80% and the main panel at 0% without anything
 * complaining. Coverage turns "how much is left" into a number instead of a
 * surprise someone finds in the real UI.
 *
 * Dev-only; never shipped.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');

const minArgIdx = process.argv.indexOf('--min');
const MIN = minArgIdx !== -1 ? Number(process.argv[minArgIdx + 1]) : null;

/**
 * --exclude <substring> (repeatable) drops matching rows from the gate total, so a
 * release can require the side panel at 100% while a later phase (the onboarding
 * page) is still legitimately at 0%. Without this the gate is unusable and gets
 * ignored — the same way an unrun tool is no tool at all.
 */
const EXCLUDE = process.argv.reduce((acc, a, i) =>
  a === '--exclude' && process.argv[i + 1] ? [...acc, process.argv[i + 1]] : acc, []);

/** HTML files split into named regions so the report mirrors what a user sees. */
const HTML_TARGETS = [
  {
    file: 'popup.html',
    regions: [
      ['warning-panel  (File Not Detected)', 'id="warning-panel"', 'id="main-panel"'],
      ['main-panel     (主畫面 / 進度)', 'id="main-panel"', 'id="settings-panel"'],
      ['settings-panel (設定)', 'id="settings-panel"', 'id="history-panel"'],
      ['history-panel  (歷史)', 'id="history-panel"', 'id="api-warning-modal"'],
      ['modal          (API 警告彈窗)', 'id="api-warning-modal"', null],
    ],
  },
  { file: 'onboarding.html', regions: [['onboarding     (說明頁)', null, null]] },
];

/**
 * Every file that can put text in front of a user.
 *
 * background.js and translate.js were originally missing here, which is exactly why
 * this report once said 100% while the progress bar was still English: the
 * denominator only covered the side panel's own files.
 */
const JS_TARGETS = ['popup.js', 'background.js', 'translate.js'];

/**
 * Literal-ish strings that are never user-facing copy.
 * A noisy metric is worse than no metric — people stop reading it — so anything
 * that is provably not copy belongs here.
 */
const IGNORE_STRING = [
  /^[\s\d%]*$/,                       // "0%", whitespace
  /^v?\$\{/,                          // `v${version}`, `${pct}%`
  /^[a-z-]+$/,                        // css class / token
  /^https?:\/\//,
  /^[#.]/,                            // selectors
  /^[a-z0-9]+[-.][a-z0-9.-]+$/i,      // model ids / hostnames: gemini-3.1-flash-lite
];

const isCopy = (s) => {
  const v = s.trim();
  if (!v || !/[A-Za-z]{3,}/.test(v)) return false;
  return !IGNORE_STRING.some((re) => re.test(v));
};

const stripSvg = (s) => s.replace(/<svg[\s\S]*?<\/svg>/g, '');
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

/**
 * Blank the inner content of any element that owns its whole subtree via
 * data-i18n / data-i18n-html. Their descendants (<strong>, <a>, <br>) come from the
 * locale string, so counting them as untagged copy is a false positive.
 *
 * Heuristic: non-greedy match to the next same-name closing tag. Adequate here
 * because no i18n-owned element nests another element of its own tag name.
 */
function blankOwnedSubtrees(html) {
  return html.replace(
    /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?\bdata-i18n(?:-html)?\s*=(?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/\1>/g,
    (_m, tag, attrs) => `<${tag}${attrs}></${tag}>`
  );
}

/** Count tagged vs untagged user-visible copy in an HTML fragment. */
function scanHtml(fragment) {
  const raw = stripComments(stripSvg(fragment));
  const tagged = (raw.match(/data-i18n(?:-[a-z-]+)?\s*=/g) || []).length;
  const seg = blankOwnedSubtrees(raw);

  const untagged = [];

  // Text nodes belonging to a tag that carries no i18n attribute.
  // data-i18n-ignore is an explicit opt-out for strings JS owns at runtime.
  for (const m of seg.matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>([^<]*)/g)) {
    const [, , attrs, text] = m;
    if (/data-i18n/.test(attrs)) continue;
    if (isCopy(text)) untagged.push(text.trim().replace(/\s+/g, ' ').slice(0, 58));
  }

  // placeholder="" / title="" without a matching data-i18n-* partner.
  for (const m of seg.matchAll(/<[a-zA-Z][\w-]*((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const attrs = m[1];
    if (/data-i18n-ignore/.test(attrs)) continue;
    for (const attr of ['placeholder', 'title']) {
      const hit = attrs.match(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`));
      if (hit && isCopy(hit[1]) && !new RegExp(`data-i18n-${attr}`).test(attrs)) {
        untagged.push(`@${attr}="${hit[1].slice(0, 44)}"`);
      }
    }
  }
  return { tagged, untagged };
}

/** Count localised calls vs raw literals reaching a user-visible sink in JS. */
function scanJs(src) {
  const lines = src.split('\n');
  const tagged =
    (src.match(/\bt\(\s*[`'"]/g) || []).length +      // popup: t('key')
    (src.match(/\bkey:\s*['"]/g) || []).length;       // worker: sendProgress(..., {key:'…'})
  const untagged = [];

  const SINKS = [
    // popup-side sinks
    /\.(?:textContent|innerHTML)\s*=\s*([`'"])((?:\\.|(?!\1).)*)\1/,
    /(?:alert|confirm)\(\s*([`'"])((?:\\.|(?!\1).)*)\1/,
    // service-worker sinks: these render straight into the progress bar
    /sendProgress\([^,]+,[^,]+,\s*([`'"])((?:\\.|(?!\1).)*)\1/,
    /\bstatus:\s*([`'"])((?:\\.|(?!\1).)*)\1/,
  ];

  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;                 // comment
    for (const sink of SINKS) {
      const m = line.match(sink);
      if (!m) continue;
      let text = m[2] ?? '';
      // Strip embedded icon markup, then judge what is LEFT. Blanket-skipping any
      // string containing "<svg" is what hid '<span>Stop Translation</span><svg…>'.
      text = text.replace(/<svg[\s\S]*?(?:<\/svg>|$)/g, ' ').replace(/<[^>]*>/g, ' ');
      if (/\bt\(/.test(text)) return;                       // already localised inline
      if (!isCopy(text)) continue;
      untagged.push(`L${i + 1}  ${text.trim().replace(/\s+/g, ' ').slice(0, 58)}`);
      return;
    }
  });

  return { tagged, untagged };
}

// ── Run ──────────────────────────────────────────────────────────────────────
const rows = [];
const details = [];

for (const target of HTML_TARGETS) {
  const path = join(PROJECT, target.file);
  if (!existsSync(path)) continue;
  const html = readFileSync(path, 'utf8');

  for (const [label, startMark, endMark] of target.regions) {
    const a = startMark ? html.indexOf(startMark) : 0;
    const b = endMark ? html.indexOf(endMark) : html.length;
    if (a === -1) continue;
    const { tagged, untagged } = scanHtml(html.slice(a, b === -1 ? html.length : b));
    rows.push({ label, tagged, untagged: untagged.length });
    if (untagged.length) details.push([label, untagged]);
  }
}

for (const file of JS_TARGETS) {
  const path = join(PROJECT, file);
  if (!existsSync(path)) continue;
  const { tagged, untagged } = scanJs(readFileSync(path, 'utf8'));
  rows.push({ label: `${file.padEnd(14)} (執行期字串)`, tagged, untagged: untagged.length });
  if (untagged.length) details.push([file, untagged]);
}

const gated = rows.filter((r) => !EXCLUDE.some((x) => r.label.includes(x)));
const totTagged = gated.reduce((n, r) => n + r.tagged, 0);
const totUntagged = gated.reduce((n, r) => n + r.untagged, 0);
const pct = (t, u) => (t + u === 0 ? null : (t / (t + u)) * 100);

console.log('\ni18n 覆蓋率 — 使用者可見字串中有多少是可翻譯的\n');
console.log(`  ${'區域'.padEnd(34)} ${'已標記'.padStart(7)} ${'硬編碼'.padStart(7)}   覆蓋率`);
console.log('  ' + '─'.repeat(66));
for (const r of rows) {
  const skipped = EXCLUDE.some((x) => r.label.includes(x));
  const p = pct(r.tagged, r.untagged);
  const bar = p === null ? '' : '█'.repeat(Math.round(p / 10)).padEnd(10, '░');
  const mark = p === null ? ' ' : p >= 95 ? '✔' : p >= 50 ? '~' : '✖';
  console.log(
    `  ${skipped ? '–' : mark} ${r.label.padEnd(32)} ${String(r.tagged).padStart(7)} ${String(r.untagged).padStart(7)}   ` +
      `${p === null ? '  n/a' : `${p.toFixed(0).padStart(3)}%`} ${bar}${skipped ? '  (不列入門檻)' : ''}`
  );
}
console.log('  ' + '─'.repeat(66));
const overall = pct(totTagged, totUntagged);
console.log(`  ${''.padEnd(34)} ${String(totTagged).padStart(7)} ${String(totUntagged).padStart(7)}   ${overall.toFixed(0).padStart(3)}%  ← ${EXCLUDE.length ? `門檻範圍（已排除 ${EXCLUDE.join(', ')}）` : '整體'}\n`);

if (process.argv.includes('--list')) {
  for (const [label, items] of details) {
    console.log(`\n  ▸ ${label} — 仍硬編碼 ${items.length} 處:`);
    for (const it of items) console.log(`      ${it}`);
  }
  console.log('');
}
if (!process.argv.includes('--list') && totUntagged) {
  console.log(`  加 --list 可列出全部 ${totUntagged} 處硬編碼字串。\n`);
}

if (MIN !== null && overall < MIN) {
  console.log(`✖ 整體覆蓋率 ${overall.toFixed(0)}% 低於門檻 ${MIN}%\n`);
  process.exit(1);
}
