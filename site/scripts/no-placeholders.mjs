#!/usr/bin/env node
/**
 * Fails the build when a placeholder is left in the built pages. No dependencies.
 *
 * A placeholder is what src/components/Slot.astro renders (an element whose class list holds
 * `slot`, e.g. <span class="slot">[to confirm]</span>) or its bracketed text typed by hand
 * ("[to confirm]", "[to follow]"). The site publishes only confirmed facts: an unknown value is
 * left out, never shown as a placeholder (README "Products: the single source of truth").
 *
 * Strict by default. To let a draft build through, list the pages that may keep placeholders in
 * HVD_ALLOW_PLACEHOLDERS (comma-separated paths relative to dist/, e.g. `privacy.html`, or `*`
 * for every page); the allowed ones are still listed in the build log as warnings.
 *
 * Runs from astro.config.mjs (astro:build:done) on every `astro build`, so `npm run build` and
 * `npm run build:preview` both stop on a placeholder; also runs by hand:
 *   node scripts/no-placeholders.mjs [distDir]      (npm run check:placeholders)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** class="slot", class="a slot b", class='slot' (unquoted too). */
const SLOT_CLASS_RE = /\sclass\s*=\s*(?:"[^"]*\bslot\b[^"]*"|'[^']*\bslot\b[^']*'|slot(?=[\s>]))/gi;
const SLOT_TEXT_RE = /\[(?:[a-z][a-z ]*\s)?to (?:confirm|follow)\]/gi;

/** @param {string} dir */
function htmlFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** @param {string} raw */
function allowList(raw) {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\\/g, '/').replace(/^\/+/, ''))
      .filter(Boolean),
  );
}

/**
 * @param {string} distDir
 * @param {{ info?: (m: string) => void, warn?: (m: string) => void }} [log]
 * @returns {number} placeholders found on pages that are not allowed
 */
export function findPlaceholders(distDir, log = console) {
  const allowed = allowList(process.env.HVD_ALLOW_PLACEHOLDERS ?? '');
  let blocking = 0;
  let total = 0;
  const lines = [];
  for (const file of htmlFiles(distDir)) {
    const rel = path.relative(distDir, file).replace(/\\/g, '/');
    const html = fs.readFileSync(file, 'utf8');
    // A Slot element matches both patterns: its own bracketed text is not counted again.
    const classHits = [...html.matchAll(SLOT_CLASS_RE)].map((m) => m.index ?? 0);
    const textHits = [...html.matchAll(SLOT_TEXT_RE)]
      .map((m) => m.index ?? 0)
      .filter((i) => !/\bslot\b[^<]*$/i.test(html.slice(Math.max(0, i - 40), i)));
    const distinct = [...classHits, ...textHits].sort((a, b) => a - b);
    if (!distinct.length) continue;
    const ok = allowed.has('*') || allowed.has(rel);
    total += distinct.length;
    if (!ok) blocking += distinct.length;
    const sample = html.slice(distinct[0], distinct[0] + 90).replace(/\s+/g, ' ');
    lines.push(`${ok ? 'allowed' : 'NOT ALLOWED'}: ${rel}: ${distinct.length} placeholder(s), e.g. ${JSON.stringify(sample)}`);
  }
  for (const l of lines) (l.startsWith('allowed') ? log.warn ?? log.info : log.info)?.(`[placeholders] ${l}`);
  log.info?.(`[placeholders] ${total} placeholder(s) in dist/, ${blocking} on pages not in HVD_ALLOW_PLACEHOLDERS`);
  return blocking;
}

/**
 * Astro integration: fails the build when findPlaceholders reports a page that is not allowed.
 * @returns {import('astro').AstroIntegration}
 */
export default function noPlaceholders() {
  return {
    name: 'hvd-no-placeholders',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const strip = (/** @type {string} */ m) => m.replace(/^\[placeholders\] /, '');
        const blocking = findPlaceholders(fileURLToPath(dir), {
          info: (m) => logger.info(strip(m)),
          warn: (m) => logger.warn(strip(m)),
        });
        if (blocking) {
          throw new Error(
            `${blocking} placeholder(s) left in dist/ (see above). Leave the unknown fact out instead, ` +
              'or list the page in HVD_ALLOW_PLACEHOLDERS for a draft build.',
          );
        }
      },
    },
  };
}

// CLI: node scripts/no-placeholders.mjs [distDir]
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(process.argv[2] ?? path.join(siteRoot, 'dist'));
  process.exit(findPlaceholders(distDir) ? 1 : 0);
}
