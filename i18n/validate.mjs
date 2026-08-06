#!/usr/bin/env node
/**
 * Locale validator — run before every release.
 *
 *   node i18n/validate.mjs
 *
 * Exits 1 on any error so it can be wired into a git hook. Dev-only; never shipped.
 *
 * Catches, in rough order of how often it bites:
 *   - a locale missing keys that en.json has
 *   - a translation that dropped a {placeholder}  <- silent runtime bug
 *   - a locale file with no registry entry, or a ui:true language with no file
 *   - a translation stale against en.json's version
 *   - strings long enough to overflow the 320px side panel
 *   - disallowed HTML in strings destined for innerHTML
 *   - keys in en.json that no code references
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { LANGUAGES, ROOT_LOCALE, fallbackChain } from './languages.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');
const LOCALES = join(HERE, 'locales');

/** Files scanned for key usage. Add new UI entry points here. */
const SOURCE_FILES = ['popup.html', 'popup.js', 'onboarding.html', 'onboarding.js', 'background.js'];

/** Tags permitted in strings rendered through data-i18n-html. */
const ALLOWED_TAGS = ['strong', 'em', 'b', 'i', 'br', 'a', 'code', 'span'];

/** Warn above this ratio vs the English string — likely to overflow a narrow panel. */
const LENGTH_WARN_RATIO = 1.5;

/** Pseudo-locale produced by build-qa-locale.mjs; exempt from most checks. */
const QA_LOCALE = 'qa';

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tagsIn = (s) => [...String(s).matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
const keysOf = (dict) => Object.keys(dict).filter((k) => k !== '_meta');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(`Cannot parse ${path}: ${e.message}`);
    return null;
  }
}

// ── Load the root locale ─────────────────────────────────────────────────────
const rootPath = join(LOCALES, `${ROOT_LOCALE}.json`);
if (!existsSync(rootPath)) {
  console.error(`FATAL: root locale ${ROOT_LOCALE}.json is missing.`);
  process.exit(1);
}
const root = readJson(rootPath);
if (!root) process.exit(1);
const rootKeys = keysOf(root);
const rootVersion = root._meta?.version;
if (typeof rootVersion !== 'number') err(`${ROOT_LOCALE}.json: _meta.version must be a number.`);

// ── Registry <-> file cross-check ────────────────────────────────────────────
const onDisk = readdirSync(LOCALES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

for (const lang of LANGUAGES) {
  if (lang.ui && !onDisk.includes(lang.code)) {
    err(`Registry marks "${lang.code}" as ui:true but i18n/locales/${lang.code}.json does not exist.`);
  }
  if (lang.fallback && !LANGUAGES.some((l) => l.code === lang.fallback)) {
    err(`"${lang.code}" falls back to "${lang.fallback}", which is not in the registry.`);
  }
  const chain = fallbackChain(lang.code);
  if (chain.at(-1) !== ROOT_LOCALE) {
    err(`Fallback chain for "${lang.code}" does not terminate at ${ROOT_LOCALE}: ${chain.join(' -> ')}`);
  }
}

for (const code of onDisk) {
  if (code === QA_LOCALE) continue;
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) {
    err(`i18n/locales/${code}.json exists but "${code}" is not in the registry.`);
  } else if (!lang.ui) {
    warn(`i18n/locales/${code}.json exists but "${code}" has ui:false — it will never be selectable.`);
  }
}

// ── Per-locale checks ────────────────────────────────────────────────────────
const report = [];

for (const lang of LANGUAGES) {
  if (!onDisk.includes(lang.code)) {
    report.push({ code: lang.code, state: 'skip', note: 'no locale file (target-only)' });
    continue;
  }
  const dict = readJson(join(LOCALES, `${lang.code}.json`));
  if (!dict) continue;

  const keys = keysOf(dict);
  const missing = rootKeys.filter((k) => !(k in dict));
  const extra = keys.filter((k) => !rootKeys.includes(k));

  if (lang.code !== ROOT_LOCALE) {
    // A `partial` locale is allowed to lean on its fallback chain.
    const partial = dict._meta?.completeness === 'partial';
    if (missing.length && !partial) {
      err(`${lang.code}: missing ${missing.length} key(s): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`);
    } else if (missing.length) {
      warn(`${lang.code}: partial locale, ${missing.length} key(s) fall back to ${lang.fallback}.`);
    }
    if (extra.length) {
      err(`${lang.code}: ${extra.length} key(s) not present in ${ROOT_LOCALE}.json: ${extra.slice(0, 8).join(', ')}`);
    }

    const meta = dict._meta || {};
    for (const field of ['code', 'name', 'basedOnEnVersion', 'completeness', 'updatedAt']) {
      if (meta[field] === undefined) err(`${lang.code}: _meta.${field} is required.`);
    }
    if (meta.code && meta.code !== lang.code) {
      err(`${lang.code}: _meta.code is "${meta.code}" but the filename says "${lang.code}".`);
    }
    if (typeof rootVersion === 'number' && meta.basedOnEnVersion !== rootVersion) {
      err(`${lang.code}: STALE — built against ${ROOT_LOCALE} v${meta.basedOnEnVersion}, current is v${rootVersion}. Re-review, then bump basedOnEnVersion.`);
    }
    // completeness = how many keys exist; reviewedBy = whether a human vetted quality.
    // 'machine' = raw MT, 'llm' = LLM-translated and self-reviewed against the style
    // guide. Both still warn: only a human native speaker clears this check.
    const REVIEW_STATES = { source: null, 'native-speaker': null, llm: 'LLM 翻譯並自我校閱，仍待母語者複核', machine: '未經校閱的機器翻譯' };
    if (!(meta.reviewedBy in REVIEW_STATES)) {
      err(`${lang.code}: _meta.reviewedBy "${meta.reviewedBy}" is not one of: ${Object.keys(REVIEW_STATES).join(', ')}.`);
    } else if (REVIEW_STATES[meta.reviewedBy]) {
      warn(`${lang.code}: reviewedBy="${meta.reviewedBy}" — ${REVIEW_STATES[meta.reviewedBy]}。`);
    }
    // A locale claiming human review should carry a style guide for future editors.
    if (!existsSync(join(LOCALES, `${lang.code}.style.md`))) {
      warn(`${lang.code}: 缺少 ${lang.code}.style.md 風格指南（語域／用字規範無處記錄）。`);
    }
  }

  // Placeholder parity and length/HTML sanity
  for (const key of rootKeys) {
    if (!(key in dict)) continue;
    const src = root[key];
    const dst = dict[key];

    if (typeof dst !== 'string') {
      err(`${lang.code}: "${key}" must be a string (locale files are flat — no nesting).`);
      continue;
    }

    const a = placeholders(src).join(',');
    const b = placeholders(dst).join(',');
    if (a !== b) {
      err(`${lang.code}: "${key}" placeholder mismatch — ${ROOT_LOCALE} has {${a || 'none'}}, this locale has {${b || 'none'}}.`);
    }

    const bad = tagsIn(dst).filter((tg) => !ALLOWED_TAGS.includes(tg));
    if (bad.length) {
      err(`${lang.code}: "${key}" contains disallowed tag(s) <${[...new Set(bad)].join('>, <')}>. Allowed: ${ALLOWED_TAGS.join(', ')}.`);
    }

    if (lang.code !== ROOT_LOCALE && src.length > 0) {
      const ratio = dst.length / src.length;
      if (ratio > LENGTH_WARN_RATIO) {
        warn(`${lang.code}: "${key}" is ${Math.round(ratio * 100)}% of the English length — check it fits at 320px.`);
      }
    }
  }

  report.push({
    code: lang.code,
    state: 'checked',
    partial: dict._meta?.completeness === 'partial',
    have: keys.length,
    want: rootKeys.length,
    version: dict._meta?.basedOnEnVersion ?? dict._meta?.version,
  });
}

// ── Unreferenced keys ────────────────────────────────────────────────────────
let source = '';
for (const f of SOURCE_FILES) {
  const p = join(PROJECT, f);
  if (existsSync(p)) source += readFileSync(p, 'utf8') + '\n';
}

const usedKeys = new Set();
const usedPrefixes = [];
for (const m of source.matchAll(/data-i18n(?:-[a-z-]+)?\s*=\s*"([^"]+)"/g)) usedKeys.add(m[1]);
for (const m of source.matchAll(/\bt\(\s*'([^']+)'/g)) usedKeys.add(m[1]);
for (const m of source.matchAll(/\bt\(\s*"([^"]+)"/g)) usedKeys.add(m[1]);
// The service worker references keys as sendProgress(..., { key: 'progress.x' }).
// Omitting this pattern reported all 16 worker keys as unused — noise that would
// bury a genuinely orphaned key.
for (const m of source.matchAll(/\bkey:\s*'([^']+)'/g)) usedKeys.add(m[1]);
for (const m of source.matchAll(/\bkey:\s*"([^"]+)"/g)) usedKeys.add(m[1]);
// '@key' params are indirect references resolved by t() at render time.
for (const m of source.matchAll(/'@([a-zA-Z][\w.]*)'/g)) usedKeys.add(m[1]);
for (const m of source.matchAll(/`@([a-zA-Z][\w.]*)\$\{/g)) usedPrefixes.push(m[1]);
// Dynamically composed keys, e.g. t(`settings.keyFormat.${engine}.ok`) -> prefix
for (const m of source.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) usedPrefixes.push(m[1]);

// Used by code but absent from the root locale — the UI would render the raw key.
const undefinedKeys = [...usedKeys].filter((k) => !rootKeys.includes(k));
if (undefinedKeys.length) {
  err(
    `Code references ${undefinedKeys.length} key(s) that ${ROOT_LOCALE}.json does not define ` +
      `(the UI would show the raw key): ${undefinedKeys.join(', ')}`
  );
}

const unreferenced = rootKeys.filter(
  (k) => !usedKeys.has(k) && !usedPrefixes.some((p) => p && k.startsWith(p))
);
if (unreferenced.length) {
  warn(
    `${ROOT_LOCALE}.json has ${unreferenced.length} key(s) no scanned source references ` +
      `(fine if used by a not-yet-migrated phase): ${unreferenced.slice(0, 10).join(', ')}${unreferenced.length > 10 ? ', …' : ''}`
  );
}

// ── Output ───────────────────────────────────────────────────────────────────
console.log(`\nRoot locale: ${ROOT_LOCALE}.json — ${rootKeys.length} keys, v${rootVersion}\n`);
for (const r of report) {
  if (r.state === 'skip') {
    console.log(`  ·  ${r.code.padEnd(6)} ${r.note}`);
  } else {
    // '~' marks a deliberately partial locale leaning on its fallback chain,
    // as opposed to '✖' for one that is simply missing keys.
    const glyph = r.have === r.want ? '✔' : r.partial ? '~' : '✖';
    const tail = r.have === r.want ? '' : r.partial ? '  (partial, rest falls back)' : '';
    console.log(`  ${glyph}  ${r.code.padEnd(6)} ${String(r.have).padStart(3)}/${r.want} keys   v${r.version}${tail}`);
  }
}

if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`   - ${w}`);
}
if (errors.length) {
  console.log(`\n✖  ${errors.length} error(s):`);
  for (const e of errors) console.log(`   - ${e}`);
  console.log('');
  process.exit(1);
}
console.log(`\n✅ All locales valid.${warnings.length ? ' (with warnings above)' : ''}\n`);
