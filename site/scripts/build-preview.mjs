#!/usr/bin/env node
/**
 * Design preview build for static hosting under a sub-path (GitHub Pages project site):
 *
 *   npm run build:preview                                  # base /hv-discover-website
 *   PREVIEW_BASE=/other-name npm run build:preview         # another base ("" or "/" = domain root)
 *
 * 1. Runs the normal `npm run build` (prebuild sync-api, astro build, CSP hashes) with
 *    PUBLIC_PREVIEW=1. That flag only switches on preview behaviour already in the source:
 *    BaseLayout's notice bar and robots noindex, src/styles/preview.css (astro.config.mjs) and
 *    the form client that never calls the network (src/scripts/lib/submit.ts).
 * 2. Post-processes dist/ for hosting under the base path. The production site lives at the
 *    domain root and links root-relative ("/about", "/_astro/x.js"), so every root-relative
 *    reference to one of the site's own top-level routes or files (ROUTES below) gets the base:
 *      - HTML: every attribute value (href, src, action, data-*, <link rel=preload> ...) and
 *        every URL of a srcset; the JSON data blocks (<script type="application/json">) string
 *        by string. application/ld+json is left as it is (its URLs are absolute).
 *      - CSS: url(/...).
 *      - JS bundles: string literals that start with "/<route>" (tightly anchored to ROUTES).
 *    "/products" becomes "<base>/products/" (the catalog moves to products/index.html, below).
 *    Idempotent: a value that already starts with the base is never touched again.
 * 3. GitHub Pages layout: products.html -> products/index.html (/products and /products/ both
 *    work; GitHub Pages cannot serve products.html beside a products/ folder); .htaccess,
 *    .user.ini and api/ removed (no Apache, no PHP); .nojekyll added (keeps _astro/);
 *    robots.txt disallows everything and the sitemaps are removed (a preview is never indexed).
 * 4. Fails (exit 1) when any root-relative reference without the base is left in the output,
 *    or when the preview markers are missing, and lists every offender.
 *
 * `node scripts/build-preview.mjs --check [dir]` runs only the check of step 4 (and the same
 * base), e.g. on a downloaded Pages artifact.
 *
 * Node built-ins only. The production build (`npm run build`) is not affected by this script.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let DIST = path.join(siteRoot, 'dist');

/** The site's own top-level routes and files: only references to these are rebased. */
const ROUTES = [
  '_astro', 'products', 'about', 'contact', 'support', 'privacy', 'fault-location', 'cable-test-van',
  'request-a-quote', 'quote-sent', 'datasheets', 'favicon.svg', 'robots.txt', '404', 'api',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROUTE_ALT = `(?:${ROUTES.map(esc).join('|')})(?![\\w-])|sitemap[\\w.-]*\\.xml`;
/** A root-relative URL to one of the routes (or the home page "/", "/?…", "/#…"). */
const ROUTE_URL = new RegExp(`^/(?:${ROUTE_ALT}|(?=$|[?#]))`);

function fail(msg) {
  console.error(`[preview] ${msg}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- base path */
function normaliseBase(raw) {
  const b = (raw ?? '').trim().replace(/\/+$/, '');
  if (b === '') return '';
  if (!/^(?:\/[A-Za-z0-9._-]+)+$/.test(b)) fail(`PREVIEW_BASE must look like "/name" (got ${JSON.stringify(raw)})`);
  if (ROUTE_URL.test(b)) fail(`PREVIEW_BASE ${b} collides with a route of the site`);
  return b;
}
const BASE = normaliseBase(process.env.PREVIEW_BASE ?? '/hv-discover-website');

/** Rebases one URL; anything that is not a root-relative route URL, or already rebased, is returned as is. */
function rebase(u) {
  if (!BASE || !u.startsWith('/') || u.startsWith('//')) return u;
  if (u === BASE || /^[/?#]/.test(u.slice(BASE.length)) && u.startsWith(BASE)) return u;
  if (!ROUTE_URL.test(u)) return u;
  return BASE + u.replace(/^\/products(?=$|[?#])/, '/products/');
}

const SRCSET_SHAPE = /^\s*\S+(?:\s+\d+(?:\.\d+)?[wx])?(?:\s*,\s*\S+(?:\s+\d+(?:\.\d+)?[wx])?)*\s*$/;
function rebaseSrcset(v) {
  return v.replace(/(^|,)(\s*)(\S+)/g, (_, sep, ws, url) => sep + ws + rebase(url));
}
/** A value of an attribute or JSON string: a srcset when it looks like one, else a single URL. */
function rebaseValue(v, isSrcset = false) {
  if (isSrcset || (v.includes(',') && /\s\d+(?:\.\d+)?[wx]\s*(?:,|$)/.test(v) && SRCSET_SHAPE.test(v))) return rebaseSrcset(v);
  return rebase(v);
}

/* ---------------------------------------------------------------- HTML */
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR_RE = /(\s+)([^\s"'>/=]+)(?:(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrType(attrs) {
  const m = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attrs);
  return (m ? m[1] ?? m[2] ?? m[3] : '').trim().toLowerCase();
}

function walkJson(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => walkJson(x, fn));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walkJson(x, fn)]));
  return v;
}

/**
 * Walks one document tag by tag (the same small tokenizer as scripts/csp-hashes.mjs: the input
 * is Astro's own output). `onAttr(tag, name, value)` may return a new value; `onRaw(tag, type,
 * body)` gets the text of <script> and <style> elements and may return a new text.
 */
function transformHtml(html, onAttr, onRaw) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end < 0 ? html.length : end + 3;
      out += html.slice(lt, stop);
      i = stop;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?' || html[lt + 1] === '/') {
      const end = html.indexOf('>', lt + 1);
      const stop = end < 0 ? html.length : end + 1;
      out += html.slice(lt, stop);
      i = stop;
      continue;
    }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(html);
    if (!m) {
      out += '<';
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    const attrs = m[2].replace(ATTR_RE, (all, ws, name, eq, dq, sq, uq) => {
      const value = dq ?? sq ?? uq;
      if (value === undefined) return all;
      const next = onAttr(tag, name.toLowerCase(), value);
      if (next === value) return all;
      const q = sq !== undefined ? "'" : '"';
      return `${ws}${name}${eq}${q}${next}${q}`;
    });
    out += `<${m[1]}${attrs}${html.slice(lt + 1 + m[1].length + m[2].length, TAG_RE.lastIndex)}`;
    i = TAG_RE.lastIndex;
    if ((tag === 'script' || tag === 'style') && m[3] !== '/') {
      const closeRe = new RegExp(`</${tag}[\\s/>]`, 'ig');
      closeRe.lastIndex = i;
      const close = closeRe.exec(html);
      const end = close ? close.index : html.length;
      out += onRaw(tag, attrType(m[2]), html.slice(i, end));
      i = end;
    }
  }
  return out + html.slice(i);
}

function rebaseHtml(html, file) {
  return transformHtml(
    html,
    (tag, name, value) => rebaseValue(value, name.endsWith('srcset')),
    (tag, type, body) => {
      if (tag === 'style') return rebaseCss(body);
      if (tag !== 'script' || type !== 'application/json') return body; // ld+json stays absolute
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        fail(`${file}: a <script type="application/json"> block is not valid JSON`);
      }
      // "<" escaped as in QuoteCatalog.astro, so a value can never close the element
      return JSON.stringify(walkJson(data, (s) => rebaseValue(s))).replace(/</g, '\\u003c');
    },
  );
}

/* ---------------------------------------------------------------- CSS and JS */
const CSS_URL_RE = /url\(\s*(['"]?)(\/[^'")\s]*)\1\s*\)/g;
function rebaseCss(css) {
  return css.replace(CSS_URL_RE, (all, q, u) => `url(${q}${rebase(u)}${q})`);
}

const JS_PRODUCTS_RE = /(["'`])\/products(?=["'`?#])/g;
const JS_ROUTE_RE = new RegExp(`(["'\`])(?=/(?:${ROUTE_ALT}))`, 'g');
function rebaseJs(js) {
  if (!BASE) return js;
  return js.replace(JS_PRODUCTS_RE, `$1${BASE}/products/`).replace(JS_ROUTE_RE, `$1${BASE}`);
}

/* ---------------------------------------------------------------- strict check */
/** Is this a root-relative reference that does not carry the base? */
const unbased = (u) => u.startsWith('/') && !u.startsWith('//') && !(BASE && (u === BASE || u.startsWith(`${BASE}/`) || u.startsWith(`${BASE}?`) || u.startsWith(`${BASE}#`)));

function checkHtml(html, file, offenders) {
  const add = (where, u) => offenders.push(`${file}: ${where} ${u}`);
  transformHtml(
    html,
    (tag, name, value) => {
      const urls = name.endsWith('srcset') ? value.split(',').map((c) => c.trim().split(/\s+/)[0]) : [value];
      for (const u of urls) if (u && unbased(u.trim())) add(`<${tag} ${name}>`, u);
      return value;
    },
    (tag, type, body) => {
      if (tag === 'style') checkCss(body, `${file} <style>`, offenders);
      if (tag === 'script' && (type === 'application/json' || type === 'application/ld+json')) {
        try {
          walkJson(JSON.parse(body), (s) => {
            for (const u of s.split(/,\s*/).map((c) => c.split(/\s+/)[0])) if (unbased(u)) add(`<script ${type}>`, u);
            return s;
          });
        } catch {
          add(`<script ${type}>`, '(not valid JSON)');
        }
      } else if (tag === 'script') {
        checkJs(body, `${file} inline <script>`, offenders);
      }
      return body;
    },
  );
}
function checkCss(css, file, offenders) {
  for (const m of css.matchAll(CSS_URL_RE)) if (unbased(m[2])) offenders.push(`${file}: url(${m[2]})`);
}
/** Any quoted string in a bundle that starts with "/" and a name character, without the base. */
const JS_STRING_PATH_RE = /(["'`])(\/[A-Za-z0-9_][^"'`\s]*)/g;
function checkJs(js, file, offenders) {
  for (const m of js.matchAll(JS_STRING_PATH_RE)) if (unbased(m[2])) offenders.push(`${file}: string ${m[1]}${m[2]}`);
}

/* ---------------------------------------------------------------- files */
function filesIn(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(p));
    else if (entry.isFile()) out.push(p);
  }
  return out.sort();
}
const rel = (p) => path.relative(DIST, p).split(path.sep).join('/');

/* ---------------------------------------------------------------- 1. build */
function runBuild() {
  const env = { ...process.env, PUBLIC_PREVIEW: '1' };
  const npmCli = process.env.npm_execpath;
  const r = npmCli && /\.c?js$/.test(npmCli)
    ? spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: siteRoot, env, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: siteRoot, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`npm run build failed (exit ${r.status ?? r.signal ?? r.error})`);
}

/* ---------------------------------------------------------------- 2. rebase */
function rebaseDist() {
  const counts = { html: 0, css: 0, js: 0 };
  for (const file of filesIn(DIST)) {
    const ext = path.extname(file).toLowerCase();
    const kind = ext === '.html' ? 'html' : ext === '.css' ? 'css' : ext === '.js' || ext === '.mjs' ? 'js' : null;
    if (!kind) continue;
    const src = fs.readFileSync(file, 'utf8');
    const out = kind === 'html' ? rebaseHtml(src, rel(file)) : kind === 'css' ? rebaseCss(src) : rebaseJs(src);
    if (out !== src) {
      fs.writeFileSync(file, out);
      counts[kind]++;
    }
  }
  return counts;
}

/* ---------------------------------------------------------------- 3. GitHub Pages layout */
function pagesLayout() {
  const catalog = path.join(DIST, 'products.html');
  const target = path.join(DIST, 'products', 'index.html');
  if (fs.existsSync(catalog)) {
    if (fs.existsSync(target)) fail('dist/products/index.html exists already');
    fs.renameSync(catalog, target);
  } else if (!fs.existsSync(target)) {
    fail('dist/products.html is missing');
  }
  for (const name of ['.htaccess', '.user.ini', 'api']) fs.rmSync(path.join(DIST, name), { recursive: true, force: true });
  for (const name of fs.readdirSync(DIST)) if (/^sitemap.*\.xml$/.test(name)) fs.rmSync(path.join(DIST, name));
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  fs.writeFileSync(path.join(DIST, 'robots.txt'), '# Design preview: not for search engines.\nUser-agent: *\nDisallow: /\n');
}

/* ---------------------------------------------------------------- 4. verify */
function verify() {
  const offenders = [];
  const problems = [];
  const files = filesIn(DIST);
  let pages = 0;
  for (const file of files) {
    const r = rel(file);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.php' || /(^|\/)\.(htaccess|user\.ini)$/.test(r) || /^sitemap.*\.xml$/.test(r)) problems.push(`must not be in a preview: ${r}`);
    if (ext === '.html') {
      pages++;
      const html = fs.readFileSync(file, 'utf8');
      checkHtml(html, r, offenders);
      if (!/<meta name="robots" content="noindex, nofollow">/.test(html)) problems.push(`${r}: no <meta name="robots" content="noindex, nofollow">`);
      if (!/<aside class="preview-bar"/.test(html)) problems.push(`${r}: no preview bar`);
    } else if (ext === '.css') {
      checkCss(fs.readFileSync(file, 'utf8'), r, offenders);
    } else if (ext === '.js' || ext === '.mjs') {
      checkJs(fs.readFileSync(file, 'utf8'), r, offenders);
    }
  }
  for (const need of ['index.html', '404.html', 'products/index.html', '.nojekyll', 'robots.txt']) {
    if (!fs.existsSync(path.join(DIST, need))) problems.push(`missing: ${need}`);
  }
  if (!fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8').includes('Disallow: /\n')) problems.push('robots.txt does not disallow everything');
  if (offenders.length) problems.push(`${offenders.length} root-relative reference(s) without the base ${BASE || '(root)'}:\n    ${offenders.join('\n    ')}`);
  if (problems.length) fail(`dist/ is not a valid preview:\n  ${problems.join('\n  ')}`);
  return { pages, files: files.length };
}

export { rebase, rebaseCss, rebaseHtml, rebaseJs, verify };

function main() {
  // `node scripts/build-preview.mjs --check [dir]`: only step 4, on dir (default dist/).
  const checkAt = process.argv.indexOf('--check');
  if (checkAt > -1) {
    DIST = path.resolve(process.argv[checkAt + 1] ?? DIST);
    const r = verify();
    console.log(`[preview] check passed for ${DIST}: ${r.pages} pages, ${r.files} files, base ${BASE || '(domain root)'}`);
    return;
  }
  runBuild();
  const counts = rebaseDist();
  pagesLayout();
  const result = verify();
  console.log(`[preview] base ${BASE || '(domain root)'}: rebased ${counts.html} HTML, ${counts.css} CSS, ${counts.js} JS files`);
  console.log(`[preview] dist/: ${result.pages} pages, ${result.files} files; products/index.html, .nojekyll, robots.txt Disallow: /; no .htaccess, .user.ini, api/ or sitemap`);
  console.log('[preview] check passed: every root-relative reference carries the base');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
