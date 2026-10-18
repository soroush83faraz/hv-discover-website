# hvdiscover.com

Production site for HV Discover (high-voltage underground cable fault location instruments).
Astro 5, static output, TypeScript strict, plain CSS, no UI framework.

- Visual reference: `../design/mockups/` (approved). Every page is a **port** of its mockup, not a redesign.
- Binding docs: `../docs/06-build-plan.md` (stack, done criteria), `../docs/05-decisions.md` (sitemap, slugs),
  `../docs/design/01-design-direction.md` (design rules).

## Run

```sh
npm install
npm run dev       # http://localhost:4321 (only one dev server at a time: the machine has 8 GB RAM)
npm run build     # static site in dist/ (runs sync-api first, see "Form API" below)
npm run preview   # serves dist/ on http://localhost:4330
npm run check     # astro check (types in .astro and .ts)
npm run check:placeholders   # the placeholder check alone, on an existing dist/ (see "No placeholders")
npm run sync-api  # copy ../api into public/api/ without building
npm run build:preview   # design preview for GitHub Pages in dist/ (see "Design preview")
npm run build:staging   # staging copy for staging.hvdiscover.com in dist/ (see "Staging build")
```

`npm run build` and `npm run check` must both finish with no errors and no warnings.

## Design preview (`npm run build:preview`)

A static copy of the site for review, hosted under a sub-path without PHP or `.htaccess` (GitHub Pages
project site, e.g. `https://<user>.github.io/hv-discover-website/`). `scripts/build-preview.mjs`:

1. runs the normal `npm run build` with `PUBLIC_PREVIEW=1`, which switches on what the source already holds
   for the preview: `<meta name="robots" content="noindex, nofollow">` and the notice bar above the header
   (BaseLayout, styled by `src/styles/preview.css`, which `astro.config.mjs` adds to that build only), and a form
   client that makes no request (`src/scripts/lib/submit.ts`: every submit shows "This is a design preview: the
   form is not connected yet. Nothing was sent." in the form alert);
2. prefixes every root-relative reference to the site's own routes and files with the base (`PREVIEW_BASE`,
   default `/hv-discover-website`): HTML attributes and srcsets, the `application/json` data blocks, CSS
   `url()`, and the route strings in the JS bundles (`application/ld+json` keeps its absolute URLs);
3. lays `dist/` out for Pages: `products.html` → `products/index.html`, no `.htaccess`, `.user.ini`, `api/` or
   sitemap, a `.nojekyll`, and a `robots.txt` that disallows everything;
4. fails if any root-relative reference without the base is left, and lists them
   (`node scripts/build-preview.mjs --check [dir]` runs that check alone).

The production build is not affected: with `PUBLIC_PREVIEW` unset, `npm run build` gives the same `dist/`
byte for byte. Never upload a preview `dist/` to the Apache host.

## Staging build (`npm run build:staging`)

A test copy for the real Apache/PHP host, served from a subdomain (default `staging.hvdiscover.com`,
document root `public_html/staging/`) while the old site stays live. Another name:
`HVD_SITE_HOST=test.hvdiscover.com npm run build:staging` (PowerShell: `$env:HVD_SITE_HOST = "…"` first).
`scripts/build-staging.mjs` runs the normal build with `HVD_SITE_HOST` and `HVD_NOINDEX=1`
(`scripts/site-host.mjs`). Only the server files differ from production; the pages are byte-identical,
canonical tags and structured data included (they keep `https://hvdiscover.com`):

- `dist/.htaccess`: the template's `__SITE_HOST__` / `__SITE_HOST_RE__` placeholders get the staging host
  (canonical host, www/HTTPS redirect, old WordPress redirects, the subdomain-folder gate 6.3); no
  `Strict-Transport-Security`; `Header always set X-Robots-Tag "noindex, nofollow"`; rule 6.8s points
  the API to `<domain folder>/hvd-private/config.php`, two levels above the staging document root
  (the API's own lookup would land inside `public_html`);
- `robots.txt` is `User-agent: *` / `Disallow: /`; the sitemap files are removed.

The build fails if a placeholder, a literal `hvdiscover.com` (in a directive of `.htaccess` or in
`robots.txt`), HSTS or a sitemap is left. With both variables unset, `npm run build` is unchanged byte for
byte. Check the rules with `python -I ../tools/test_htaccess_rules.py --host staging.hvdiscover.com`.
**Never upload a staging `dist/` to `public_html`**: its `.htaccess` sends every production visitor to the
staging host. The owner's step-by-step go-live guide is kept with the private project notes, outside this repository (production first; staging is its optional appendix).

## Form API (`public/api/`, generated)

The PHP form endpoints live in `../api/` (outside this repo, its own source of truth, with its own
`CLIENT.md`). `scripts/sync-api.mjs` runs before every `npm run build` (`prebuild`) and copies them
into `public/api/`, so the build ships them as `dist/api/`:

- copied: `quote.php`, `contact.php`, `token.php`, `.htaccess`, `.user.ini` and `lib/` (an allow-list:
  any other top-level file in `../api` is skipped and named in the build log);
- never copied: `tests/`, `CLIENT.md`, `config.php`, `config.sample.php`, `data/`, `.gitignore`, and
  inside `lib/` any dotfile other than `.htaccess`, `*.md`, `*.eml`, `*.log`, backups and editor files;
- `public/api/` is deleted and recreated on each run, refuses symlinks, and the script fails the
  build if a required file is missing or a forbidden one appears;
- `public/api/` is gitignored as a whole: fixes made in `../api` reach the next build by themselves.
  Never edit files in `public/api/`.

`dist/api/` must contain exactly `quote.php`, `contact.php`, `token.php`, `lib/`, `.htaccess` and
`.user.ini`. The production `config.php` is made from `../api/config.sample.php` and lives outside
`public_html` (see "Deploy and rollback").

## URLs and output format

`astro.config.mjs` sets `trailingSlash: 'never'` and `build.format: 'file'`:

- each page is emitted as a file (`src/pages/about.astro` → `dist/about.html`,
  `src/pages/products/[slug].astro` → `dist/products/arm-filter.html`);
- every link, canonical tag and sitemap entry uses the clean URL: `/about`, `/products/arm-filter`
  (never `.html`, never a trailing slash);
- Apache maps `/about` to `about.html` with a rewrite in `public/.htaccess`, so there is exactly one
  URL per page; `/about.html`, `/about/` and `/index.html` answer 301 to the clean URL.
  `astro preview` serves the clean URLs the same way (but sends none of the `.htaccess` headers).

Sitemap: `@astrojs/sitemap` writes `sitemap-index.xml`; `/quote-sent` and `/404` are filtered out
(astro.config.mjs). `public/robots.txt` points to it.

Pages to build (docs/05-decisions.md): `/`, `/fault-location`, `/products`, `/products/<slug>`,
`/cable-test-van`, `/request-a-quote`, `/quote-sent`, `/support`, `/about`, `/contact`, `/privacy`, 404.

## Server configuration (`public/.htaccess`)

The DirectAdmin host runs Apache 2.4 (it may run LiteSpeed, which reads the same file).
`public/.htaccess` is a **template**: the build copies it to `dist/.htaccess` and
`scripts/csp-hashes.mjs` fills in the Content-Security-Policy hashes and the host (`__SITE_HOST__`,
`__SITE_HOST_RE__`: `hvdiscover.com` unless `HVD_SITE_HOST` is set, see "Staging build"). **Upload `dist/.htaccess`,
never `public/.htaccess`.** Sections:

1. basics: no directory listings, `index.html`, the site's 404 page for 403/404/410;
2. MIME types (AVIF, WebP, WOFF2, SVG) and Brotli/gzip for text, when the modules exist;
3. security headers (below);
4. caching (below);
5. access rules: dotfiles, `*.md`, `*.map`, `package*.json`, backups and archives (`*.sql`, `*.zip`,
   `*.tar.gz` …) answer 403, and so does the WordPress rollback folder `_wp-rollback/`;
6. URL rules: Let's Encrypt challenges untouched; dot-folders refused; DirectAdmin subdomain folders
   inside `public_html` left alone; no PHP outside `/api/` (404); HTTPS and `hvdiscover.com` (www → apex)
   in one 301; `/_astro/` and `/api/` never rewritten; `.html`/trailing-slash/`index` variants → 301 to
   the clean URL; clean URLs rewritten to the `.html` files.

`mod_rewrite`, `mod_headers` and `mod_setenvif` are required and deliberately not wrapped in
`<IfModule>`: a host without them answers 500 instead of silently serving the site without HTTPS
redirects or security headers. Only directives allowed by DirectAdmin's default `AllowOverride` are used.

Test without Apache: `python -I ../tools/test_htaccess_rules.py` (after `npm run build`). It parses the
rules, re-implements Apache's per-directory processing with Python `re` and checks every old URL, the new
pages and the edge cases (http/www, slashes, `.html`, `/api/`, `/_astro/`, dotfiles, probes, retired
slugs, query strings), each with its status and `Location`.

### Security headers

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS only for a year. **No `includeSubDomains`, no `preload` yet**: `blog.` and `my.hvdiscover.com` exist in DirectAdmin and must all serve HTTPS first; preload is hard to undo. Note that HSTS also covers other ports of `hvdiscover.com` (e.g. `:2222` if the panel is ever opened through this name). |
| `Content-Security-Policy` | see below | XSS and injection containment |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` | no framing (clickjacking) |
| `X-Content-Type-Options` | `nosniff` | no MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | **never `no-referrer`**: the form posts must keep their `Origin` header or the API refuses them |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB, … all `()` | the site uses none of them |
| `Cross-Origin-Opener-Policy` | `same-origin` | isolates the browsing context from other origins' windows |

`/api/` is excluded from all of these except HSTS (`SetEnvIf Request_URI ^/api/` → `env=!HVD_API`): the
API sets its own stricter CSP, frame, referrer, nosniff and cache headers (`../api/lib/http.php`), and
`Header always set` would overwrite them.

### Content-Security-Policy

```
default-src 'none'; script-src 'self' 'sha256-…'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self';
object-src 'none'
```

- `default-src 'none'`: anything not listed (frames, media, workers, manifests) is refused.
- `script-src 'self'` + one hash: every component script is a file in `/_astro/` (`astro.config.mjs`:
  `vite.build.assetsInlineLimit: 0` stops Astro from inlining small scripts). The only inline script is
  BaseLayout's one-line `html.js` class switch, kept inline on purpose (it must run before first paint;
  as a file it would be a render-blocking request). `scripts/csp-hashes.mjs` hashes every executable
  inline script in `dist/**.html` after each build and writes the hashes into `dist/.htaccess`, so editing
  that line never breaks the policy. JSON blocks (`application/ld+json`, `#quote-catalog`) are not executed
  and need no allowance.
- `style-src 'self'`, no `'unsafe-inline'`: `build.inlineStylesheets: 'never'` keeps every stylesheet a file;
  the pages have no `<style>` blocks and no `style="…"` attributes; scripts change styles only through the
  CSSOM (`el.style.x = …`), which CSP does not restrict. If a `<style>` block ever appears it is hashed too.
- `img-src 'self' data:`: the stylesheets use small `data:` SVGs (graticule, select arrow, plus/minus).
- `font-src 'self'` (self-hosted Archivo), `connect-src 'self'` (fetch to `/api/`), `form-action 'self'`
  (the plain POST to `/api/` without JavaScript, the Home starter's GET to `/request-a-quote`).
- `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`.

The build **fails** when a page holds something this policy would block without `'unsafe-inline'`:
an inline event handler (`onclick=`), a `javascript:` URL, a `style` attribute, a script or stylesheet from
another origin, a frame, object or media element. Fix the markup (a class, a script file) rather than
loosening the policy.

### Caching

| What | Cache-Control |
|---|---|
| `/_astro/*` (hashed build files: CSS, JS, images, fonts) | `public, max-age=31536000, immutable` |
| HTML, `sitemap*.xml`, `robots.txt` | `no-cache` (revalidate with the ETag on every visit) |
| other images and fonts (`favicon.svg`) | `public, max-age=2592000` (30 days) |
| `*.pdf` (datasheets keep their names) | `public, max-age=86400` |
| `/api/*` | `no-store, max-age=0` (the API also sends it) |

### Old WordPress URLs

Sections 6.4/6.5 implement `../docs/03-redirect-map.md` (final paths): every old URL (also with the
`/index.php/` prefix, from `http://` or `www.`) reaches its new page in **one** 301 and loses its query
string; the demo content, feeds, archives and demo attachments answer 410; `wp-login.php`, `xmlrpc.php`,
`wp-admin/`, `wp-json/`, `?author=` and any other PHP outside `/api/` answer a plain 404. **A new page
that reuses an old slug** (`/blog`, `/shop`, `/stores`, `/product/…`, `/feed`) must have its rule
removed from 6.5. When a product replaces an old URL, add its
redirect there and a case in `../tools/test_htaccess_rules.py`.

## Folders

```
public/                 .htaccess (template, see "Server configuration"), .user.ini, favicon.svg,
                        robots.txt, datasheets/*.pdf (generated, see "Datasheets"), api/ (generated, gitignored)
scripts/                sync-api.mjs (prebuild), csp-hashes.mjs (runs after every build),
                        build-preview.mjs (`npm run build:preview`, see "Design preview")
src/
  assets/img/           product and van photos (1600 px JPG sources; astro:assets makes AVIF/WebP)
  assets/brand/         logo.svg, logo-reversed.svg (footer), logo-graphite.svg
  components/           one component per design-system part (list below)
  content/products/     one Markdown file per product: the single source of truth
  content.config.ts     products collection schema (zod), with field docs
  data/site.ts          email, placeholder office address and hours (one place), navigation
  data/quotable.ts      the six quotable models (= the API whitelist); the van is not one
  data/families.ts      the 4 workflow steps + integrated system (names, labels, texts)
  layouts/BaseLayout.astro
  lib/products.ts       getProducts(), isQuotable(), productHref(), tileStep(), askHref(), getQuoteCatalog() …
  lib/inline.ts         inline syntax for data strings ({unit}, ~nowrap~, [link](/url))
  pages/                routes
  scripts/              client TypeScript, loaded by the components that need it
  styles/               tokens.css, base.css, components.css (global); pages-a.css, pages-b.css, home.css
                        (per page); preview.css (design preview build only)
```

## CSS

- `tokens.css`, `base.css`, `components.css` are imported once by `BaseLayout.astro` and apply everywhere.
  They are the mockups' `styles.css`, split, with the styleguide-only rules dropped.
- `home.css` (Home only: the hero with the equipment group, the four jobs, the band around the TDR
  instrument; the instrument panel itself is in `components.css`).
- `pages-a.css` (products, product pages, cable test van) and `pages-b.css` (fault location, quote,
  quote sent, about, support, contact, privacy, 404) are the mockups' page CSS, unchanged. **Import the
  right one in the page** (`import '../styles/pages-a.css';`). Never import both on one page: they style
  `.page-head` and `.faq` differently.
- Keep the mockup class names and markup. New CSS goes into the file that owns the part; values come
  from the tokens. No inline styles, no Tailwind, no new colours.

## Fonts

Archivo variable with the width axis (`wdth` 62–125, `wght` 100–900), self-hosted from
`@fontsource-variable/archivo/wdth.css` (font family name `"Archivo Variable"`, `font-display: swap`).
BaseLayout preloads the latin file. Use `font-stretch` (the `--wd-*` tokens) for the width axis.

## Scripts

Client code is TypeScript in `src/scripts/`, loaded with a bundled `<script>` inside the component that
needs it (Astro dedupes and defers it, and emits it as a file: see "Content-Security-Policy"). Nothing
global, no inline scripts except the `html.js` class (hashed into the CSP at build time). No inline
event handlers or `style` attributes: the build fails on them.

| Script | Loaded by | Does |
|---|---|---|
| `menu.ts` | Header | mobile menu sheet |
| `quote-list.ts` | Header (every page) | header count + pulse ring, every `[data-add-quote]` button, `#quote-status` |
| `lib/quote-store.ts` | the scripts below | the quote list in localStorage `hvd-quote-list`; keeps only the six quotable models (`data/quotable.ts`) and drops any other id, e.g. a `Cable test van` saved by an older version, when it reads the list |
| `tdr.ts` | TdrInstrument | Home TDR trace: built when the panel nears the viewport (or on focus/pointer), load sequence when it scrolls into view, cursor, keyboard, reduced motion |
| `gallery.ts` | Gallery | product gallery crossfade and thumbnails; creates the second stage layer on first use (see "Images") |
| `quote-starter.ts` | QuoteStarter | Home form: validation, carries answers to `/request-a-quote?voltage=&length=&fault=` and sessionStorage `hvd-quote-starter` |
| `catalog.ts` | /products, /cable-test-van | family filter, van callouts |
| `method.ts` | /fault-location | the interactive TDR lab |
| `forms.ts` | imported by quote.ts, contact.ts | inline validation (`attachForm`, `setError`), API errors in the same UI (`showServerErrors`), busy button (`setBusy`) |
| `lib/submit.ts` | imported by quote.ts, contact.ts | the form API client per `../api/CLIENT.md`: tokens, JSON POST, retries, `REF_RE` |
| `quote.ts` | /request-a-quote, /quote-sent | quote list page, quantities, form, reference from `?ref=`; needs `#quote-catalog` JSON (`QuoteCatalog.astro`) and prefills from the Home starter |
| `contact.ts` | /contact | contact form, sent box with the reference |

To wire one: `<script>import '../scripts/catalog';</script>` at the end of the page (or its component).

## Components

| Component | Purpose |
|---|---|
| `BaseLayout.astro` (layouts) | `<head>` (title, description, canonical, OG, favicon, font preload, `jsonLd`), skip link, Header, `<main id="main">`, Footer |
| `Header.astro` | logo, main nav, Contact, quote button with count, mobile menu sheet; marks the current page (`aria-current="page"`, `is-current` for a product's section) |
| `Footer.astro` | brand line, product links (from the collection), company links, contact |
| `Button.astro` | `.btn` as `<a>` (with `href`) or `<button>`; `variant` primary/secondary, `size` md/sm |
| `AddToQuote.astro` | the Add to quote toggle for one product model (behaviour from quote-list.ts) |
| `NameplateTile.astro` | product tile: 4:3 photo or drawing, step, nameplate model, figures, Add to quote (the van: a plain link to its page instead); `wide`, `row` |
| `WorkflowLine.astro` | the 1–4 cable line; `variant="compact" current={slug}` for "Where it fits" |
| `SolutionCards.astro` | Home "Four jobs, and an instrument for each": four plates on one cable line (photo, job, one sentence from `families.ts` `job`, family diagram, instrument links) |
| `EquipmentGroup.astro` | Home hero: TDR-901, PG-32 and AP-01 multiplied onto a white stage, with leader-line captions (two photos and a caption list on phones); the TDR-901 photo is the LCP image |
| `FamilyDiagram.astro` | the small physics line diagram per family (1–4, `system`) |
| `KeyFigures.astro` | the four key figures beside the product nameplate (numeric or text) |
| `SpecTable.astro` | grouped spec tables from `product.data.specs` |
| `Gallery.astro` | product page gallery (stage, thumbnails, caption) or the drawing when there is no photo; also the van page "Photos" section (`eager={false}`, own `sizes`) |
| `QuoteBand.astro` | closing quote band; default actions with `model`, or custom ones via `slot="actions"` |
| `Slot.astro` | dashed "[to confirm]" placeholder, for drafts only: the build fails on it (see "No placeholders") |
| `PlaceholderDrawing.astro` | PG-10 line drawing, captioned "Line drawing" and "Illustration only" (CRT-015's drawing is the fallback for its photo) |
| `TdrInstrument.astro` | the TDR instrument as a white panel in the Home band (readout in its header; the page renders the usage hint `#tdr-hint`) |
| `QuoteStarter.astro` | the Home "Tell us about the cable" form |
| `QuoteCatalog.astro` | `#quote-catalog` JSON for quote.ts (/request-a-quote, /quote-sent) |

Bespoke page sections (catalog filter and family heads, ARM "What arc reflection does", PG-10 vs PG-32
comparison, van "What's on board", cabin callouts, rear doors, call-out sequence, FAQ, the fault-location
lab, quote page, forms) are not components yet: build them in the page, or as a component when two pages
share them, copying the mockup markup.

## Products: the single source of truth

`src/content/products/*.md`, schema and field docs in `src/content.config.ts`. Seven entries: the six
instruments, which can be quoted, and the cable test van (`family: system`, page at `/cable-test-van`, not
`/products/…`), which is a **showcase only**: no Add to quote, no quote band (it has a `contactBand` that
points to `/contact`), not in the quote catalog, and refused by the API. The schema enforces `quoteBand` for
instruments and `contactBand` for the van.

- The quotable models are listed in `src/data/quotable.ts` and must equal the API's list
  (`../api/CLIENT.md`); `getQuoteCatalog()` fails the build when the collection and that list disagree.

- `model` is the nameplate and, for an instrument, also the quote-list id (`data-add-quote`), e.g. `TDR-901`.
- The Markdown body is the "Overview" section (empty for the ARM Filter and the van).
- Short text fields render through `lib/inline.ts`: `{kV}` → unit span, `~PG-32~` → no line break,
  `[TDR-901](/products/tdr-901-time-domain-reflectometer)` → link. Everything else is escaped.
- **Publish only confirmed facts.** A value nothing proves (datasheet, a plate or label in our own photos) is
  left out: delete the row, figure or sentence, never guess it and never show a placeholder. The questions
  for what was left out are in `../docs/04-owner-questions.md` (section H). A `slot` field still exists for
  drafting, but the build fails on it (see "No placeholders").
- Get products through `src/lib/products.ts` (`getProducts`, `getInstruments`, `getProduct(slug)`,
  `getProductsBySlugs(worksWith)`), and link with `productHref(product)`.

A product page reads, in this order: `images`/`drawing` → Gallery, `family` → family line and breadcrumb
(`getFamily()`), `model`/`name`/`description` → nameplate and lede, `KeyFigures`, AddToQuote +
`askHref()`, `datasheet`, `fitLead` + `WorkflowLine compact`, body → Overview, `specsSource` +
`SpecTable` + `specsNote`, `inTheBox*`, `worksWith` + `worksWithLead` → NameplateTiles (`tiles--3`),
`quoteBand` → QuoteBand. See `design/mockups/product-tdr-901.html` for the full layout.

### Add a product

1. Put a 1600 px JPG on white in `src/assets/img/` (or set `drawing` while there is no photo).
2. Copy an existing file in `src/content/products/` to `<slug>.md`; set `slug`, `family`, `order`.
3. Fill the fields; leave out anything not confirmed. `npm run check` validates the schema
   (unknown keys in figures and spec rows are errors, so typos fail loudly).
4. It appears in the tiles, the workflow line, the footer and the quote catalog automatically; the
   product page route builds it from the slug. Add a redirect in `.htaccess` if it replaces an old URL.
5. Add its model to `src/data/quotable.ts` and to the API's list (`../api/lib/forms.php`), or the build
   stops and the API refuses it.

## Datasheets

`public/datasheets/{tdr-901,pg-32,ap-01}.pdf` are the English datasheets (A4, two pages, Rev 1,
October 2026). They are **generated** from the product Markdown files by
`../tools/make_datasheets.py`, so a PDF never disagrees with its product page:

```sh
npm ci                                                    # the script embeds Archivo from node_modules
python -P -E ../tools/make_datasheets.py --site .         # writes public/datasheets/*.pdf and checks them
```

- A product gets a PDF when its file has `datasheet: { url: /datasheets/<name>.pdf, note: … }`; it also
  needs `features` (key features) and `applications` (one line), which only the PDF prints.
- The PDF uses the same spec rows as the page, minus every row with a `slot` (unknown values are
  left out, never printed as placeholders), the first Overview paragraph and "In the box".
- After any change to those three product files, rerun the script and commit the PDFs with it.
- The script checks each PDF (two pages at most, nothing overflowing, fonts embedded, no
  non-Latin text or forbidden words, under 600 KB) and fails otherwise. Products without a
  `datasheet` show no datasheet line on their page (no "in preparation" promise).
- Run it with `python -P -E`, not `-I`: Playwright lives in the user site-packages on this machine.

## No placeholders

The published site shows no placeholder: no "[to confirm]", no "coming soon", no reply-time or
delivery promise that needs a fact we do not have. `scripts/no-placeholders.mjs` runs after every
build (an integration in `astro.config.mjs`, next to `csp-hashes.mjs`) and **fails the build** when a
page in `dist/` holds a Slot element (`class="slot"`) or a bracketed "[… to confirm]" / "[… to follow]".
Strict by default; for a draft build, list the pages allowed to keep placeholders in
`HVD_ALLOW_PLACEHOLDERS` (comma-separated paths relative to `dist/`, e.g. `privacy.html`, or `*`); they
are still listed in the log. `npm run check:placeholders` runs the check alone on an existing `dist/`.

## Images

Use `astro:assets` `<Picture>` with `formats={['avif', 'webp']}`, `widths={[480, 800, 1200, 1600]}`
and a `sizes` that matches the layout column. The gallery stage uses `getImage()` WebP srcsets because its
script swaps `src`/`srcset`/`sizes`. Never reference `src/assets` files by URL.

**Photos in `src/assets/img/`** (1600 px long edge, JPEG on white, no EXIF/XMP; prepared by
`../tools/make_remaining_photos.py`, notes per file in `../tools/photos_out/manifest.json`). Gallery order
is the order of `images:` in the product file; the first photo is the lead (tiles, OG image, JSON-LD):

| Product | Photos (gallery order) |
|---|---|
| PG-32 | `pg-32`, `pg-32-front`, `pg-32-panel`, `pg-32-high-angle`, `pg-32-rear`, `pg-32-side`, `pg-32-accessories`, `pg-32-leads` |
| TDR-901 | `tdr-901`, `tdr-901-kit`, `tdr-901-accessories`, `tdr-901-transport-case`, `tdr-901-closed` |
| AP-01 | `ap-01`, `ap-01-case` |
| ARM Filter | `arm-filter` |
| CRT-015 | `crt-015` (see below) |
| Cable test van | `van-exterior`, `van-side-door`, `van-profile`, `van-rear-quarter`, `van-rear`, `van-interior`, `van-cabin` (2:3 portrait) |

- `inTheBoxFigure.image` is an index into `images`: re-check it when the order changes (PG-32: 6, the
  accessories photo).
- The van page picks three photos **by file name** (`van-exterior` hero and OG image, `van-interior` cabin
  callouts, `van-rear` rear doors) and shows all seven in its "Photos" section (the same Gallery).
- JSON-LD `image`: the first five photos, as absolute 1200 px JPG URLs (`src/lib/jsonld.ts`).

**Gallery loading rule** (`Gallery.astro`, `gallery.ts`): only the first photo is in the HTML, eager with
`fetchpriority="high"` in a page hero (`eager={false}` makes it lazy, as on the van page). The second stage
layer is created by the script on the first thumbnail click, so no hidden slide is downloaded before it is
asked for. Thumbnails are `loading="lazy"` WebP at 100/200 px when there are more than four (rows of four
on phones, one row of eight from 600 px: 88 px wide at 1440) and 200/400 px otherwise. Pass `sizes` and
`thumbSizes` when the gallery sits in another column. Portrait photos (`van-cabin`) sit whole on the same
4:3 white plate (`object-fit: contain`), and their `sizes` are scaled to the width they really fill.

**CRT-015**: the only source is low resolution (622 × 682 px of product). It is placed 1:1 on the
1600 × 1200 white canvas, never enlarged, so the set fills about 40 % of the width and looks smaller and
softer than the other photos. Checked by eye on the product page, the catalog, Home and "Works with": it
is used everywhere (gallery, tiles, JSON-LD). `drawing: crt-015` stays in the file as the fallback: empty
`images` and the line drawing returns. Replace the photo when a proper shot exists (owner question F).

## SEO

BaseLayout takes `title` and `description` (unique per page), builds the canonical from the clean URL,
and emits Open Graph tags (default image: the van photo; pass `ogImage` to override). Pass schema.org
objects in `jsonLd`: Home sends Organization (address: London, GB only); product pages send `Product`
(no offers) and `BreadcrumbList`; the van page sends a `WebPage` (`showcaseJsonLd()`), not a `Product`.
Pages are `lang="en-GB"` with `og:locale` `en_GB`.
`src/lib/structured-data.ts` builds `BreadcrumbList` (`breadcrumbs()`), `FAQPage` (`faqPage()`, confirmed
answers only) and the publisher reference used by the fault-location `TechArticle`.
Use `noindex` on `/quote-sent` and 404.

`public/robots.txt` names the sitemap and disallows `/api/`. Check a build with
`python -I ../tools/check_seo.py`: unique titles and descriptions, canonical = clean URL, Open Graph with
an absolute `og:image` that exists, JSON-LD that parses, noindex only on `/quote-sent` and `/404`, the
sitemap listing exactly the indexable pages, and every internal link resolving to a built file.

## Deploy and rollback

The new site replaces the WordPress site in the same `public_html` on the DirectAdmin host
(`private_html` there is a symlink to `public_html`).

**Once, before the switch**

1. Private folder outside the web root: `/home/<user>/domains/hvdiscover.com/hvd-private/` (mode 700)
   with `config.php` (mode 600) made from `../api/config.sample.php` (`../api/CLIENT.md` §8): a new
   `secret`, the mail settings, `dev_mode => false`, and `site_url => 'https://hvdiscover.com'` (the
   canonical host). The API finds it there; builds never ship a `config.php`.
2. The certificate (DirectAdmin Let's Encrypt) covers `hvdiscover.com` **and** `www.hvdiscover.com`
   (the www redirect is served over HTTPS too).

**Switch**

1. `npm run build` (runs `sync-api`, builds, writes the CSP hashes into `dist/.htaccess`).
2. Move the WordPress files out of `public_html`, **dotfiles included** (`.htaccess`, `.user.ini`: a plain
   `mv *` skips them; in a shell run `shopt -s dotglob` first, or select all in the File Manager).
   - Preferred: outside the web root, e.g. `/home/<user>/domains/hvdiscover.com/wp-rollback/`.
   - Or inside it as `public_html/_wp-rollback/` (the placeholder name the root `.htaccess` refuses
     with 403). Then also rename `_wp-rollback/.htaccess` to `.htaccess.wp` and put a `.htaccess`
     holding only `Require all denied` there: the copied WordPress `.htaccess` has rewrite rules of its
     own. Another folder name needs the same name changed in `.htaccess` (sections 5 and 6.2).
   - Keep subdomain folders (`public_html/blog/`, `public_html/my/`) if they exist.
3. Upload the **contents** of `dist/` into `public_html/`, dotfiles included (`.htaccess`, `.user.ini`,
   `api/.htaccess`, `api/.user.ini`). The new root `.user.ini` replaces WordPress's, whose
   `auto_prepend_file` points at a plugin file that is gone; PHP caches `.user.ini` for up to 5 minutes,
   so `/api/` may answer 500 for that long.
4. Run the checks below.

**Rollback**: move the uploaded files out of `public_html` and the WordPress files (with their `.htaccess`
and `.user.ini`) back in. HSTS stays in browsers (WordPress forced HTTPS too, so nothing breaks). Browsers
also keep the new site's 301s (old URL → new page) in their cache.

**Checks after upload** (expected result after `#`; `c` prints the status and the redirect target):

```sh
c() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$@"; }
c http://hvdiscover.com/about                     # 301 https://hvdiscover.com/about
c http://www.hvdiscover.com/about                 # 301 https://hvdiscover.com/about
c https://www.hvdiscover.com/about                # 301 https://hvdiscover.com/about
c https://hvdiscover.com/                         # 200
c https://hvdiscover.com/products/pg-32-surge-generator   # 200
c https://hvdiscover.com/about.html               # 301 https://hvdiscover.com/about
c https://hvdiscover.com/about/                   # 301 https://hvdiscover.com/about
c https://hvdiscover.com/products/                # 301 https://hvdiscover.com/products
c https://hvdiscover.com/404                      # 404
c https://hvdiscover.com/index.php/aboutus/       # 301 https://hvdiscover.com/about
c http://www.hvdiscover.com/index.php/product/cable-fault-locator-32-kv-pg32/   # 301 https://hvdiscover.com/products/pg-32-surge-generator
c 'https://hvdiscover.com/?page_id=29'            # 301 https://hvdiscover.com/contact
c 'https://hvdiscover.com/?attachment_id=10631'   # 301 https://hvdiscover.com/
c 'https://hvdiscover.com/?attachment_id=8'       # 410
c https://hvdiscover.com/index.php/2022/12/13/logitech-pop-keys/   # 410
c https://hvdiscover.com/wp-login.php             # 404 (no redirect)
c http://hvdiscover.com/xmlrpc.php                # 404 (no redirect)
c https://hvdiscover.com/.htaccess                # 403
c https://hvdiscover.com/.user.ini                # 403
c https://hvdiscover.com/.git/config              # 403
c https://hvdiscover.com/_wp-rollback/wp-login.php   # 403
c http://hvdiscover.com/.well-known/acme-challenge/x  # 404, NOT 301
curl -s -D - -o /dev/null https://hvdiscover.com/ | grep -iE '^(strict-transport|content-security|x-frame|x-content-type|referrer|permissions|cross-origin-opener|cache-control)'
#   all eight headers, the CSP with one 'sha256-…', Cache-Control: no-cache
curl -s -D - -o /dev/null https://hvdiscover.com/favicon.svg | grep -i '^cache-control'   # public, max-age=2592000
curl -s https://hvdiscover.com/ | grep -o '/_astro/[^"]*\.css' | head -1   # then, with that path:
curl -s -D - -o /dev/null https://hvdiscover.com/_astro/<file>.css | grep -i '^cache-control'   # public, max-age=31536000, immutable
curl -s -D - -o /dev/null -H 'Accept-Encoding: br, gzip' https://hvdiscover.com/ | grep -i '^content-encoding'   # br or gzip
# API (../api/CLIENT.md §8, on the canonical host):
c 'https://hvdiscover.com/api/token.php?form=quote'   # 200 (curl -i shows the JSON token)
c https://hvdiscover.com/api/quote.php            # 405
c https://hvdiscover.com/api/config.php           # 403
c https://hvdiscover.com/api/lib/bootstrap.php    # 403
c https://hvdiscover.com/api/.user.ini            # 403
c https://hvdiscover.com/api/                     # 403
c -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' https://hvdiscover.com/api/contact.php   # 403
curl -s -D - -o /dev/null 'https://hvdiscover.com/api/token.php?form=quote' | grep -i '^content-security-policy'
#   exactly ONE line, the API's own: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

The same expectations as the offline checker, replayed against the live site (about 280 sampled
requests, one every 0.5 s; `--dry-run` lists them first; it also checks that the live CSP equals this
build's `dist/.htaccess` and that the API sends only its own CSP):

```sh
python -I ../tools/test_htaccess_rules.py --live
```

Then open the site with the browser console: no CSP errors on Home, a product page, `/products`,
`/request-a-quote` and `/contact`; send one quote and one contact message (CLIENT.md §8). If the host
runs **LiteSpeed**, look closely at three results above: `/wp-login.php` must be 404 without a redirect
(the `R=404` flag), `/_wp-rollback/…` 403, and the API exactly one `Content-Security-Policy` (the
`env=!HVD_API` condition).

## Open items for the next stages

- Datasheets: PG-10, ARM Filter and CRT-015 have none yet (`datasheet: null`). See "Datasheets".
  The PDFs are not in the sitemap (`@astrojs/sitemap` lists pages only).
- Forms: the client follows `../api/CLIENT.md` (fetch to `/api/quote.php`, `/api/contact.php`, token from
  `/api/token.php`; plain POST without JS). The API is copied into the build by `sync-api` (above).
- Office address and hours in `src/data/site.ts` are placeholders. Replace them before launch; the footer, contact, about and privacy pages and the mobile menu read them from there. Structured data carries London, GB only.
- HSTS: after a few weeks without problems, and once every subdomain serves HTTPS, consider
  `includeSubDomains` (and only after that, `preload`).

## Commits

End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
