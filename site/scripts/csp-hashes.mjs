#!/usr/bin/env node
/**
 * Completes the Content-Security-Policy in dist/.htaccess after the build. No dependencies.
 *
 * public/.htaccess carries the policy with two placeholders:
 *   script-src 'self' __INLINE_SCRIPT_HASHES__; style-src 'self' __INLINE_STYLE_HASHES__;
 * This script reads every dist/**.html, computes the sha256 of each executable inline <script>
 * (classic, module, importmap, speculationrules) and of each <style> element, and writes
 * dist/.htaccess = public/.htaccess with the placeholders replaced by those hashes. JSON data
 * blocks (application/ld+json, application/json) are not executed and need no allowance.
 *
 * The build fails (exit 1 / thrown error) when a page holds something this policy cannot allow
 * without 'unsafe-inline': inline event handlers (onclick=…), javascript: URLs, style="…"
 * attributes, scripts or stylesheets from another origin, frames, objects or media elements.
 *
 * It also fills the host placeholders __SITE_HOST__ / __SITE_HOST_RE__ with HVD_SITE_HOST (default
 * hvdiscover.com, scripts/site-host.mjs), which is also the origin counted as "self" below.
 *
 * Runs from astro.config.mjs (astro:build:done) on every `astro build`; can also be run by hand:
 *   node scripts/csp-hashes.mjs [distDir] [publicDir]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fillHost, siteHost } from './site-host.mjs';

const SITE_HOST = siteHost();
const SITE_ORIGIN = `https://${SITE_HOST}`;
const SCRIPT_TOKEN = '__INLINE_SCRIPT_HASHES__';
const STYLE_TOKEN = '__INLINE_STYLE_HASHES__';

/** Script types a browser executes (HTML "JavaScript MIME type essence" list, plus module). */
const JS_TYPES = new Set([
  '', 'module', 'application/ecmascript', 'application/javascript', 'application/x-ecmascript',
  'application/x-javascript', 'text/ecmascript', 'text/javascript', 'text/javascript1.0',
  'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4',
  'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);
/** Inline JSON blocks that CSP still governs through script-src. */
const CSP_JSON_TYPES = new Set(['importmap', 'speculationrules']);

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR_RE = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster']);
const BLOCKED_ELEMENTS = new Set(['iframe', 'frame', 'object', 'embed', 'applet', 'video', 'audio', 'portal']);

/** sha256 of the element text as the browser sees it (the HTML parser turns CRLF/CR into LF). */
function cspHash(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  return `'sha256-${createHash('sha256').update(normalized, 'utf8').digest('base64')}'`;
}

function decodeEntities(v) {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&colon;/gi, ':').replace(/&tab;/gi, '\t').replace(/&newline;/gi, '\n')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseAttrs(src) {
  const attrs = new Map();
  for (const m of src.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

/** true for URLs that stay on this site (relative, root-relative, the site origin; data: if allowed). */
function sameOrigin(url, allowData = false) {
  const u = url.trim();
  if (u === '' || u.startsWith('#')) return true;
  if (/^data:/i.test(u)) return allowData;
  if (u.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u.startsWith(`${SITE_ORIGIN}/`) || u === SITE_ORIGIN;
  return true;
}

/**
 * Walks one HTML document: returns the inline scripts/styles to hash and any policy problems.
 * A small tokenizer is enough here: the input is Astro's own output.
 */
export function scanHtml(html, file = '') {
  const scripts = [];
  const styles = [];
  const problems = [];
  const report = (msg) => problems.push(`${file}: ${msg}`);
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?' || html[lt + 1] === '/') {
      const end = html.indexOf('>', lt + 1);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(html);
    if (!m) {
      i = lt + 1;
      continue;
    }
    i = TAG_RE.lastIndex;
    const tag = m[1].toLowerCase();
    const attrs = parseAttrs(m[2]);

    for (const [name, value] of attrs) {
      if (/^on[a-z]+$/.test(name)) report(`<${tag} ${name}=…> inline event handler`);
      if (name === 'style') report(`<${tag} style="${value.slice(0, 40)}"> inline style attribute`);
      if (URL_ATTRS.has(name) && /^javascript:/i.test(value.replace(/[\u0000- ]/g, ''))) {
        report(`<${tag} ${name}="javascript:…"> javascript: URL`);
      }
    }
    if (BLOCKED_ELEMENTS.has(tag)) report(`<${tag}> is blocked by the policy (default-src 'none')`);
    if (tag === 'link' && /(^|\s)stylesheet(\s|$)/i.test(attrs.get('rel') ?? '') && !sameOrigin(attrs.get('href') ?? '')) {
      report(`stylesheet from another origin: ${attrs.get('href')}`);
    }
    if (tag === 'form' && attrs.has('action') && !sameOrigin(attrs.get('action'))) {
      report(`form posting to another origin: ${attrs.get('action')}`);
    }
    if (tag === 'img' || tag === 'source' || (tag === 'link' && /icon|preload/i.test(attrs.get('rel') ?? ''))) {
      const urls = [attrs.get('src'), attrs.get('href'), ...(attrs.get('srcset') ?? '').split(',').map((c) => c.trim().split(/\s+/)[0])];
      for (const u of urls) if (u && !sameOrigin(u, true)) report(`<${tag}> loads from another origin: ${u}`);
    }

    if ((tag === 'script' || tag === 'style') && m[3] !== '/') {
      const closeRe = new RegExp(`</${tag}[\\s/>]`, 'ig');
      closeRe.lastIndex = i;
      const close = closeRe.exec(html);
      const end = close ? close.index : html.length;
      const body = html.slice(i, end);
      i = close ? html.indexOf('>', close.index) + 1 : html.length;

      if (tag === 'style') {
        styles.push({ file, hash: cspHash(body), preview: body.slice(0, 60) });
      } else if (attrs.has('src')) {
        if (!sameOrigin(attrs.get('src'))) report(`script from another origin: ${attrs.get('src')}`);
      } else {
        const type = (attrs.get('type') ?? '').trim().toLowerCase();
        if (JS_TYPES.has(type) || CSP_JSON_TYPES.has(type)) {
          scripts.push({ file, type: type || 'classic', hash: cspHash(body), preview: body.slice(0, 60) });
        }
      }
    }
  }
  return { scripts, styles, problems };
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(p));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(p);
  }
  return out.sort();
}

/**
 * Hashes the inline scripts/styles of every page in distDir and writes distDir/.htaccess from
 * publicDir/.htaccess with the placeholders (hashes and host) filled in. Returns the final policy.
 */
export function applyCsp(distDir, publicDir, log = console) {
  const template = path.join(publicDir, '.htaccess');
  const target = path.join(distDir, '.htaccess');
  const pages = htmlFiles(distDir);
  if (pages.length === 0) throw new Error(`[csp] no HTML files in ${distDir}`);

  const scripts = [];
  const styles = [];
  const problems = [];
  for (const file of pages) {
    const r = scanHtml(fs.readFileSync(file, 'utf8'), path.relative(distDir, file).split(path.sep).join('/'));
    scripts.push(...r.scripts);
    styles.push(...r.styles);
    problems.push(...r.problems);
  }
  if (problems.length) {
    throw new Error(`[csp] the pages hold content the Content-Security-Policy would block:\n  ${problems.join('\n  ')}`);
  }

  const scriptHashes = [...new Set(scripts.map((s) => s.hash))].sort();
  const styleHashes = [...new Set(styles.map((s) => s.hash))].sort();

  // Only the one `Header always set Content-Security-Policy "…"` line is touched (comments may
  // name the placeholders too).
  const lines = fs.readFileSync(template, 'utf8').split('\n');
  const cspLines = lines.flatMap((l, n) => (/^\s*Header\s+always\s+set\s+Content-Security-Policy\s+"/i.test(l) ? [n] : []));
  if (cspLines.length !== 1) throw new Error(`[csp] ${template} must hold exactly one "Header always set Content-Security-Policy" line (found ${cspLines.length})`);
  const at = cspLines[0];
  let line = lines[at];
  for (const [token, hashes] of [[SCRIPT_TOKEN, scriptHashes], [STYLE_TOKEN, styleHashes]]) {
    const count = line.split(` ${token}`).length - 1;
    if (count !== 1) throw new Error(`[csp] the CSP line must contain " ${token}" exactly once (found ${count})`);
    line = line.replace(` ${token}`, hashes.length ? ` ${hashes.join(' ')}` : '');
  }
  if (/__INLINE_[A-Z]+_HASHES__/.test(line)) throw new Error('[csp] a placeholder was left in the CSP line');
  lines[at] = line;
  const out = fillHost(lines.join('\n'), SITE_HOST);
  if (/__SITE_HOST/.test(out)) throw new Error('[csp] a __SITE_HOST placeholder was left in .htaccess');
  fs.writeFileSync(target, out);

  const policy = /Content-Security-Policy\s+"([^"]+)"/.exec(line)?.[1] ?? '(not found)';
  log.info?.(`[csp] ${pages.length} pages: ${scripts.length} inline scripts (${scriptHashes.length} distinct), ${styles.length} <style> blocks (${styleHashes.length} distinct)`);
  for (const s of scripts.filter((x, n, all) => all.findIndex((y) => y.hash === x.hash) === n)) {
    log.info?.(`[csp]   ${s.hash} ${s.type} script, e.g. ${s.file}: ${JSON.stringify(s.preview)}`);
  }
  for (const s of styles.filter((x, n, all) => all.findIndex((y) => y.hash === x.hash) === n)) {
    log.info?.(`[csp]   ${s.hash} <style>, e.g. ${s.file}: ${JSON.stringify(s.preview)}`);
  }
  log.info?.(`[csp] wrote ${path.relative(process.cwd(), target) || target}`);
  return policy;
}

/**
 * Astro integration: runs applyCsp after every build.
 * @returns {import('astro').AstroIntegration}
 */
export default function cspHashes() {
  /** @type {string} */
  let publicDir = '';
  return {
    name: 'hvd-csp-hashes',
    hooks: {
      'astro:config:done': ({ config }) => {
        publicDir = fileURLToPath(config.publicDir);
      },
      'astro:build:done': ({ dir, logger }) => {
        applyCsp(fileURLToPath(dir), publicDir, { info: (m) => logger.info(m.replace(/^\[csp\] /, '')) });
      },
    },
  };
}

// CLI: node scripts/csp-hashes.mjs [distDir] [publicDir]
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(process.argv[2] ?? path.join(siteRoot, 'dist'));
  const publicDir = path.resolve(process.argv[3] ?? path.join(siteRoot, 'public'));
  try {
    console.log(applyCsp(distDir, publicDir));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
