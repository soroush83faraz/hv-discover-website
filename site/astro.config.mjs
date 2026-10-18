// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cspHashes from './scripts/csp-hashes.mjs';
import noPlaceholders from './scripts/no-placeholders.mjs';
import siteVariant from './scripts/site-host.mjs';

// Design preview build (`npm run build:preview`, scripts/build-preview.mjs sets PUBLIC_PREVIEW=1):
// every page also loads src/styles/preview.css (the notice bar BaseLayout renders in that build).
// Off in the normal build, which stays exactly as it was.
const PREVIEW = process.env.PUBLIC_PREVIEW === '1';
/** @type {import('astro').AstroIntegration} */
const previewStyles = {
  name: 'hvd-preview-styles',
  hooks: {
    'astro:config:setup': ({ injectScript }) => {
      // A root-relative specifier: Vite resolves it from the project root.
      injectScript('page-ssr', `import '/src/styles/preview.css';`);
    },
  },
};

// Static output for the Apache host.
// - trailingSlash 'never' + build.format 'file': every page is emitted as `/about.html`
//   (not `/about/index.html`) and is linked as `/about`. Apache serves the clean URL by
//   mapping `/about` to `about.html` in public/.htaccess, so there is one canonical URL
//   per page; `/about.html` and `/about/` answer 301 to `/about`.
// - Content-Security-Policy (public/.htaccess): script-src and style-src allow same-origin
//   files only, plus the sha256 of each inline script left in the pages (the one-line `html.js`
//   class in BaseLayout). So the build must not inline scripts or stylesheets:
//   `inlineStylesheets: 'never'` and `assetsInlineLimit: 0` keep every bundled script and
//   stylesheet a file under /_astro/. scripts/csp-hashes.mjs (below) hashes whatever inline
//   script remains, writes the hashes into dist/.htaccess and fails the build on inline event
//   handlers, style attributes or javascript: URLs.
// - scripts/no-placeholders.mjs fails the build when a Slot placeholder ("[to confirm]") is left
//   in dist/ (HVD_ALLOW_PLACEHOLDERS lists pages allowed to keep them in a draft build).
// - Staging build (`npm run build:staging`, scripts/build-staging.mjs): HVD_SITE_HOST and HVD_NOINDEX=1
//   change only the server files (dist/.htaccess, robots.txt, no sitemaps), through cspHashes and
//   scripts/site-host.mjs. `site` stays https://hvdiscover.com: the staging pages are the production
//   pages, canonical tags included. With both variables unset the build is unchanged.
export default defineConfig({
  site: 'https://hvdiscover.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Astro inlines component scripts smaller than this limit (4 kB by default); 0 = never.
      // The data: URIs written in the stylesheets are not affected.
      assetsInlineLimit: 0,
    },
  },
  integrations: [
    sitemap({
      // The sitemap lists clean URLs (no .html), matching the canonical tags.
      filter: (page) => !page.includes('/quote-sent') && !page.endsWith('/404'),
    }),
    cspHashes(),
    siteVariant(),
    noPlaceholders(),
    ...(PREVIEW ? [previewStyles] : []),
  ],
});
