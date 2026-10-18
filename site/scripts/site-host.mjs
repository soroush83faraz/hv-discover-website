#!/usr/bin/env node
/**
 * Build variants chosen by environment variables. With both unset, `npm run build` gives the
 * production build, byte for byte the same as before these variables existed.
 *
 *   HVD_SITE_HOST  the host the server configuration answers on (default hvdiscover.com). It fills
 *                  the placeholders __SITE_HOST__ (the host as is: redirect targets) and
 *                  __SITE_HOST_RE__ (the host as a regex: host conditions) in public/.htaccess, and
 *                  is the origin scripts/csp-hashes.mjs counts as "self". The pages themselves keep
 *                  https://hvdiscover.com in their canonical tags and structured data, so a staging
 *                  copy shows exactly the HTML that goes live.
 *   HVD_NOINDEX=1  staging: dist/.htaccess sends no Strict-Transport-Security (a staging host must
 *                  not pin HTTPS rules in browsers) and sends `X-Robots-Tag: noindex, nofollow` on
 *                  every response; the API finds its private config two levels above the staging
 *                  document root (rule 6.8s); robots.txt disallows everything; the sitemaps are
 *                  removed. The old WordPress redirects stay and point to HVD_SITE_HOST.
 *
 * `npm run build:staging` (scripts/build-staging.mjs) sets both. The integration below runs after
 * the CSP step and fails the build when a placeholder or, on another host, a literal
 * hvdiscover.com is left in the server configuration or robots.txt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_HOST = 'hvdiscover.com';
export const HOST_TOKEN = '__SITE_HOST__';
export const HOST_RE_TOKEN = '__SITE_HOST_RE__';

/** Escapes a string for a PCRE / JS regular expression. */
export const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HOST_SHAPE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The canonical host of this build (lower case), from HVD_SITE_HOST. */
export function siteHost(env = process.env) {
  const raw = (env.HVD_SITE_HOST ?? '').trim().toLowerCase();
  if (raw === '') return DEFAULT_HOST;
  if (!HOST_SHAPE.test(raw)) {
    throw new Error(`[site-host] HVD_SITE_HOST must be a plain host name such as staging.hvdiscover.com (got ${JSON.stringify(env.HVD_SITE_HOST)})`);
  }
  // .htaccess treats www.<host> as an alias of <host> (6.3, 6.7): the canonical host has no www.
  if (raw.startsWith('www.')) throw new Error('[site-host] HVD_SITE_HOST must not start with www.');
  return raw;
}

/** true for a staging (noindex) build, from HVD_NOINDEX. */
export function isNoindex(env = process.env) {
  const v = (env.HVD_NOINDEX ?? '').trim();
  if (v === '' || v === '0') return false;
  if (v === '1') return true;
  throw new Error(`[site-host] HVD_NOINDEX must be 1 or unset (got ${JSON.stringify(env.HVD_NOINDEX)})`);
}

/** Fills the host placeholders of the .htaccess template. */
export function fillHost(text, host) {
  return text.split(HOST_RE_TOKEN).join(reEscape(host)).split(HOST_TOKEN).join(host);
}

/* ------------------------------------------------------------------ staging .htaccess */
const HSTS_LINE = /^Header\s+always\s+set\s+Strict-Transport-Security\s/i;
const ROBOTS_HEADER = 'Header always set X-Robots-Tag "noindex, nofollow"';
const NOINDEX_BLOCK = [
  '# Staging build (HVD_NOINDEX=1): no Strict-Transport-Security, so a staging host never pins HTTPS',
  '# rules in browsers; every response, the API included, asks search engines not to index it.',
  ROBOTS_HEADER,
];
const CONFIG_BLOCK = [
  '# 6.8s Staging build only. This copy is served from a subdomain folder (public_html/<name>/), where',
  "#      the API's own lookup (<web root>/../hvd-private/) would land inside public_html. Point it to",
  "#      the domain's private folder, two levels above this document root:",
  '#      /home/<user>/domains/<domain>/hvd-private/config.php (the host-check kit shows the real path).',
  '#      The canonical-host rule 6.7 above runs first, so DOCUMENT_ROOT here is the staging folder.',
  'RewriteRule ^api/ - [E=HVD_CONFIG:%{DOCUMENT_ROOT}/../../hvd-private/config.php]',
];

/** The staging changes to a filled-in .htaccess (see the header of this file). */
export function stagingHtaccess(text, host) {
  const lines = text.split('\n');
  const hsts = lines.flatMap((l, n) => (HSTS_LINE.test(l) ? [n] : []));
  if (hsts.length !== 1) throw new Error(`[site-host] expected one Strict-Transport-Security line in .htaccess (found ${hsts.length})`);
  // Drop the HSTS line and the comment lines directly above it; put the noindex header there.
  let start = hsts[0];
  while (start > 0 && lines[start - 1].startsWith('#')) start--;
  lines.splice(start, hsts[0] - start + 1, ...NOINDEX_BLOCK);

  const at = lines.findIndex((l) => l.startsWith('# 6.8 '));
  if (at < 0 || lines.filter((l) => l.startsWith('# 6.8 ')).length !== 1) throw new Error('[site-host] expected one "# 6.8 " section in .htaccess');
  lines.splice(at, 0, ...CONFIG_BLOCK, '');

  lines.splice(1, 0, `# STAGING BUILD for ${host} (npm run build:staging). Never upload it to the production web root.`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ checks */
const directives = (text) => text.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

/**
 * Problems in a finished dist/: placeholders left in .htaccess; for another host, a literal
 * canonical host left in a directive of .htaccess or in robots.txt; for staging, HSTS, the
 * noindex header, robots.txt and the sitemaps.
 */
export function checkVariant(distDir, host, noindex) {
  const problems = [];
  const htPath = path.join(distDir, '.htaccess');
  const robotsPath = path.join(distDir, 'robots.txt');
  const ht = fs.readFileSync(htPath, 'utf8');
  const robots = fs.existsSync(robotsPath) ? fs.readFileSync(robotsPath, 'utf8') : '';
  if (/__SITE_HOST/.test(ht)) problems.push('.htaccess: a __SITE_HOST placeholder is left');

  if (host !== DEFAULT_HOST) {
    const stray = new RegExp(`${reEscape(DEFAULT_HOST)}|${reEscape(reEscape(DEFAULT_HOST))}`, 'i');
    const strip = (l) => l.split(reEscape(host)).join('').split(host).join('');
    for (const [name, text] of [['.htaccess', directives(ht)], ['robots.txt', robots.split('\n')]]) {
      for (const l of text) if (stray.test(strip(l))) problems.push(`${name}: literal ${DEFAULT_HOST} left: ${l.trim().slice(0, 140)}`);
    }
    if (!ht.includes(`https://${host}%{REQUEST_URI}`)) problems.push(`.htaccess: no canonical redirect to https://${host}`);
  }

  const d = directives(ht);
  const hsts = d.filter((l) => /Strict-Transport-Security/i.test(l)).length;
  const robotsHeader = d.filter((l) => l.trim() === ROBOTS_HEADER).length;
  const sitemaps = fs.readdirSync(distDir).filter((n) => /^sitemap.*\.xml$/i.test(n));
  if (noindex) {
    if (hsts) problems.push('.htaccess: Strict-Transport-Security is still sent (staging)');
    if (robotsHeader !== 1) problems.push(`.htaccess: expected one X-Robots-Tag noindex line (found ${robotsHeader})`);
    if (!/^User-agent: \*\nDisallow: \/\n?$/m.test(robots) || /^Sitemap:/im.test(robots)) problems.push('robots.txt does not disallow everything');
    if (sitemaps.length) problems.push(`sitemap files left: ${sitemaps.join(', ')}`);
    if (!d.some((l) => l.includes('E=HVD_CONFIG:'))) problems.push('.htaccess: the staging HVD_CONFIG rule (6.8s) is missing');
  } else {
    if (hsts !== 1) problems.push(`.htaccess: expected one Strict-Transport-Security line (found ${hsts})`);
    if (/X-Robots-Tag/i.test(d.join('\n'))) problems.push('.htaccess: X-Robots-Tag in a build meant for indexing');
  }
  return problems;
}

/** Writes the staging robots.txt and removes the sitemaps. */
function stagingFiles(distDir, log) {
  fs.writeFileSync(path.join(distDir, 'robots.txt'), '# Staging copy of the site: not for search engines.\nUser-agent: *\nDisallow: /\n');
  const removed = [];
  for (const name of fs.readdirSync(distDir)) {
    if (/^sitemap.*\.xml$/i.test(name)) {
      fs.rmSync(path.join(distDir, name));
      removed.push(name);
    }
  }
  log(`robots.txt disallows everything; removed ${removed.join(', ') || 'no sitemap'}`);
}

/**
 * Astro integration: applies HVD_NOINDEX to dist/ and checks the result. Must come after
 * cspHashes() (which writes dist/.htaccess with the host filled in) in astro.config.mjs.
 * @returns {import('astro').AstroIntegration}
 */
export default function siteVariant() {
  return {
    name: 'hvd-site-variant',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const distDir = fileURLToPath(dir);
        const host = siteHost();
        const noindex = isNoindex();
        if (noindex) {
          const htPath = path.join(distDir, '.htaccess');
          fs.writeFileSync(htPath, stagingHtaccess(fs.readFileSync(htPath, 'utf8'), host));
          logger.info(`staging: .htaccess without HSTS, with X-Robots-Tag noindex and rule 6.8s (host ${host})`);
          stagingFiles(distDir, (m) => logger.info(`staging: ${m}`));
        }
        const problems = checkVariant(distDir, host, noindex);
        if (problems.length) throw new Error(`[site-host] dist/ is not a valid ${noindex ? 'staging' : 'production'} build for ${host}:\n  ${problems.join('\n  ')}`);
        if (noindex || host !== DEFAULT_HOST) logger.info(`checked: ${noindex ? 'staging' : 'host-only'} build for ${host}, no placeholder or stray ${DEFAULT_HOST} left`);
      },
    },
  };
}
