#!/usr/bin/env node
/**
 * Copies the form API from ../api (its single source of truth, outside this repo) into
 * public/api/, so `astro build` ships it as dist/api/. Runs as `prebuild` and as
 * `npm run sync-api`. No dependencies.
 *
 * What is copied (allow-list, see api/CLIENT.md §6 and §8):
 *   quote.php, contact.php, token.php, .htaccess, .user.ini   (top level, nothing else)
 *   lib/                                                       (recursively, minus the skip list)
 * Never copied: tests/, CLIENT.md, config.php, config.sample.php, data/, .gitignore, any other
 * top-level file, and inside lib/: dotfiles other than .htaccess, *.md, *.eml, *.log, backups and
 * editor files, config.php, data/, tests/.
 *
 * public/api/ is deleted first, so a file removed from ../api never lingers in a build, and it is
 * gitignored: fixes made in ../api reach the next build automatically.
 * Symlinks are refused (a link could pull in files from outside ../api).
 * Exit code 1 (and so a failed `npm run build`) when ../api is missing or the result is wrong.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.resolve(siteRoot, '..', 'api');
const DEST = path.join(siteRoot, 'public', 'api');

const TOP_FILES = ['quote.php', 'contact.php', 'token.php', '.htaccess', '.user.ini'];
const TOP_DIRS = ['lib'];
const REQUIRED = [...TOP_FILES, 'lib/bootstrap.php'];

/** Names never copied from inside lib/ (any depth). */
const SKIP_NAME = /^(?:config\.php|data|tests|node_modules)$|\.(?:md|eml|log|bak|orig|old|swp|swo|tmp)$|~$/i;

function fail(msg) {
  console.error(`[sync-api] ${msg}`);
  process.exit(1);
}

/** Refuse anything that is not a plain file or directory. */
function statPlain(p) {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink()) fail(`refusing symlink: ${path.relative(SRC, p)}`);
  if (!st.isFile() && !st.isDirectory()) fail(`refusing special file: ${path.relative(SRC, p)}`);
  return st;
}

const copied = [];
const skipped = [];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied.push(path.relative(DEST, to).split(path.sep).join('/'));
}

function copyDir(from, to) {
  for (const name of fs.readdirSync(from).sort()) {
    const src = path.join(from, name);
    const rel = path.relative(SRC, src).split(path.sep).join('/');
    const st = statPlain(src);
    if (SKIP_NAME.test(name) || (name.startsWith('.') && name !== '.htaccess')) {
      skipped.push(rel + (st.isDirectory() ? '/' : ''));
      continue;
    }
    if (st.isDirectory()) copyDir(src, path.join(to, name));
    else copyFile(src, path.join(to, name));
  }
}

// --- guards
if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  fail(`${SRC} not found. The forms need the API: keep the api/ folder next to site/.`);
}
// DEST is computed above; make sure a future edit cannot point the rm -rf below anywhere else.
if (path.relative(siteRoot, DEST) !== path.join('public', 'api')) fail(`unexpected destination ${DEST}`);

// --- copy
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

for (const name of fs.readdirSync(SRC).sort()) {
  const src = path.join(SRC, name);
  const st = statPlain(src);
  if (st.isFile() && TOP_FILES.includes(name)) copyFile(src, path.join(DEST, name));
  else if (st.isDirectory() && TOP_DIRS.includes(name)) copyDir(src, path.join(DEST, name));
  else skipped.push(name + (st.isDirectory() ? '/' : ''));
}

// --- verify the result
const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(DEST, f)));
if (missing.length) fail(`missing after copy: ${missing.join(', ')}`);

const forbidden = [];
(function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(DEST, p).split(path.sep).join('/');
    if (/^(?:config\.php|config\.sample\.php|CLIENT\.md|tests|data|\.gitignore)$/i.test(name) || /\.(?:eml|log|md)$/i.test(name)) {
      forbidden.push(rel);
    }
    if (fs.lstatSync(p).isDirectory()) scan(p);
  }
})(DEST);
if (forbidden.length) fail(`must not be shipped: ${forbidden.join(', ')}`);

console.log(`[sync-api] ${path.relative(siteRoot, SRC).split(path.sep).join('/')} -> public/api: ${copied.length} files`);
console.log(`[sync-api]   copied:  ${copied.join(', ')}`);
console.log(`[sync-api]   skipped: ${skipped.join(', ') || '(none)'}`);
