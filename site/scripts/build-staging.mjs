#!/usr/bin/env node
/**
 * Staging build for a test copy of the site on its own host, on the same Apache/PHP server:
 *
 *   npm run build:staging                                   # host staging.hvdiscover.com
 *   HVD_SITE_HOST=test.hvdiscover.com npm run build:staging # another host name
 *   (PowerShell: $env:HVD_SITE_HOST = "test.hvdiscover.com"; npm run build:staging)
 *
 * Runs the normal `npm run build` (sync-api, astro build, CSP hashes, placeholder check) with
 * HVD_NOINDEX=1 and HVD_SITE_HOST (default staging.hvdiscover.com). What that changes is described
 * in scripts/site-host.mjs; the pages are the production pages. Then checks dist/ once more and
 * prints what differs from production. Exit code 1 when the build or the check fails.
 *
 * Never upload a staging dist/ to the production web root: its .htaccess sends every visitor of
 * the production host to the staging host.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVariant, DEFAULT_HOST, siteHost } from './site-host.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(siteRoot, 'dist');

function fail(msg) {
  console.error(`[staging] ${msg}`);
  process.exit(1);
}

const env = { ...process.env, HVD_NOINDEX: '1', HVD_SITE_HOST: (process.env.HVD_SITE_HOST ?? '').trim() || `staging.${DEFAULT_HOST}` };
let host;
try {
  host = siteHost(env);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
if (host === DEFAULT_HOST) fail(`HVD_SITE_HOST is the production host ${DEFAULT_HOST}: a staging build needs its own host`);

const npmCli = process.env.npm_execpath;
const r = npmCli && /\.c?js$/.test(npmCli)
  ? spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: siteRoot, env, stdio: 'inherit' })
  : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: siteRoot, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) fail(`npm run build failed (exit ${r.status ?? r.signal ?? r.error})`);

const problems = checkVariant(DIST, host, true);
if (problems.length) fail(`dist/ is not a valid staging build:\n  ${problems.join('\n  ')}`);
console.log(`[staging] dist/ is a staging build for https://${host}/`);
console.log('[staging]   .htaccess: canonical host, www/HTTPS redirects and old-URL redirects -> ' + host + '; no HSTS; X-Robots-Tag noindex; API config from <domain>/hvd-private (6.8s)');
console.log('[staging]   robots.txt: Disallow: /; no sitemap files; pages identical to production');
console.log('[staging] never upload this dist/ to the production web root');
