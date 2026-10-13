# HV Discover form API: client integration

How the static Astro site talks to the two PHP form endpoints. The API folder is copied to
`site/public/api/` and is served at `/api/` (same origin as the pages, no CORS).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/token.php?form=quote` or `?form=contact` | GET | Issue a signed timestamp token for one form |
| `/api/quote.php` | POST | Quote request from `/request-a-quote` |
| `/api/contact.php` | POST | Message from `/contact` |

Accepted bodies: `application/json` (what the site's JavaScript sends) or
`application/x-www-form-urlencoded` (the plain HTML form post used when JavaScript is off).
Nothing else (multipart, text/plain) is accepted. Body limit: 64 KB.

---

## 1. The flow

```
page load ──GET /api/token.php?form=quote──▶ {ok, token, min_wait: 3 (10 in busy mode), expires_in: 7200}
user fills the form (client validation as today: forms.js)
submit ──POST /api/quote.php (JSON, includes token)──▶
   200 {ok:true, reference:"HVD-2026-7KQ2MX"}        → quote: go to /quote-sent?ref=…  contact: show "Message sent"
   422 {ok:false, errors:{field: message}}           → show inline errors (same UI as client errors)
   403 {ok:false, errors:{form}, code:"token"}       → get a new token, wait min_wait, resend once (automatic)
   429 {ok:false, errors:{form}, code:"retry", retry_after:2}  → wait retry_after seconds, resend once (automatic)
   other (403 forbidden, 413, 415, 429 rate_limited, 5xx, network) → show errors.form in the form alert
```

Without JavaScript the browser posts the form normally (`action="/api/quote.php" method="post"`).
The server answers with a small "Check your details, then send" page carrying a fresh token and
the values typed so far; pressing Send there completes the request and redirects to the success page.

---

## 2. Markup changes to the two forms

Quote form (`/request-a-quote`):

```html
<form class="form-plate plate" id="quote-form" action="/api/quote.php" method="post" novalidate aria-labelledby="form-title">
  ...existing fields...
  <!-- honeypot: real people never see it; the server drops any request where it is filled -->
  <div class="hp-field">
    <label for="q-website">Leave this field empty</label>
    <input id="q-website" name="website" type="text" tabindex="-1" autocomplete="off">
  </div>
  ...
</form>
```

Contact form (`/contact`): the same, with `action="/api/contact.php"` and `id="c-website"`.

Rules:

- Hide the honeypot with a class in the site stylesheet, **not** inline and not off-screen:
  `.hp-field { display: none !important; }`. Browsers never autofill a `display:none` field (an
  off-screen field can get autofilled, and then a real request would be silently dropped), and
  bots that read only the HTML still see an ordinary field. Do not give it an `-error` element:
  forms.js then ignores it.
- Do not add a hidden `token` input to the static HTML. JavaScript sends the token in the JSON
  body; without JavaScript the server's review page supplies one.
- Add `maxlength` to match the server limits (below), so the browser stops typing at the limit.
- Keep option values exactly as in the mockup. The server accepts the `value` of each
  `<option>`: `""`, the visible text for options without a `value`, and `unknown` for
  "I don't know". (It also accepts the visible text "I don’t know".)
- Optional fix: the mockup's phone pattern `[0-9+()\s.\-]{6,24}` is invalid under the `v` regex
  flag that current browsers use for `pattern`, so native validation would ignore it. The forms
  use `novalidate` and forms.js compiles the pattern itself, so nothing breaks; if you ever drop
  `novalidate`, write it as `[0-9+\(\)\s.\-]{6,24}`.

### Server-side rules (mirrors forms.js plus limits)

| Field | Quote | Contact | Server rule |
|---|---|---|---|
| `name` | required | required | 1–100 characters, no web addresses |
| `company` | required | optional | up to 150 characters, no web addresses |
| `country` | required | – | 2–80 characters, no web addresses |
| `email` | required | required | up to 254, plain `name@domain.tld` (ASCII; no quoted or unusual forms) |
| `phone` | optional | – | `[0-9+(). -]{6,24}` with at least 6 digits |
| `voltage`, `length` | optional | – | one of the option values |
| `message` | required only when `items` is empty | required | up to 5000 characters, at most 5 links |
| `items` | list | – | up to 6 entries `{model, qty}`, `model` one of the 6 quotable ids, `qty` integer 1–99, no repeats |
| `website` | must be empty | must be empty | honeypot |
| `token` | required | required | from token.php, at least `min_wait` seconds old |

Quotable models (exact strings, as in quote.js `CATALOG` ids; keep both lists in sync, the server
list is `HVD_PRODUCTS` in `api/lib/forms.php`): `TDR-901`, `ARM Filter`, `PG-10`, `PG-32`,
`AP-01`, `CRT-015`.

The **cable test van is not quotable**: remove it from quote.js `CATALOG` and from any "Add to
quote" button. A list that still names it is refused with the normal `items` message ("One of the
products in your list is not in our catalog…"). Visitors may still have it in localStorage from
an older visit, so filter the stored list against `CATALOG` when reading it (`getList()`) and
drop unknown ids silently, rather than letting the send fail.

Line breaks are removed from single-line fields and control/invisible characters are dropped
server-side; the client does not need to do that.

Error messages for the client-side rules are the same strings as the `data-msg-*` attributes in
the mockups. Server-only messages (shown as they are):

- `Use 100 characters or fewer.` (or 150, 5000), `Use at least 2 characters.`
- `Remove the web address from this field.`, `Use at most 5 links in your message.`
- `This field contains characters we cannot read. Retype it and try again.`
- `items`: `Your quote list could not be read. Remove the products and add them again.`,
  `One of the products in your list is not in our catalog. Remove it and try again.`,
  `Set each quantity to a whole number from 1 to 99.`

---

## 3. Request bodies

Quote, `POST /api/quote.php`, headers `Content-Type: application/json` and `Accept: application/json`:

```json
{
  "name": "Alex Morgan",
  "company": "Northern Grid Services Ltd",
  "country": "United Kingdom",
  "email": "alex.morgan@example.com",
  "phone": "+44 20 7946 0000",
  "voltage": "20 kV",
  "length": "unknown",
  "message": "Fault types, cable type, training needs...",
  "items": [ { "model": "TDR-901", "qty": 2 }, { "model": "PG-32", "qty": 1 } ],
  "website": "",
  "token": "v1.quote.1791720000.xxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
}
```

`items` comes from the quote list exactly as quote.js keeps it: `getList()` (localStorage
`hvd-quote-list`) with `qtyOf(getQty(), id)` (localStorage `hvd-quote-qty`). Send the select
**values** (`select.value`), not the option text that quote.js's `pick()` reads today.

Contact, `POST /api/contact.php`: `{ "name", "email", "company", "message", "website", "token" }`.

Always send `Accept: application/json`. A request whose `Accept` asks for HTML gets redirects and
HTML pages instead (that is the no-JavaScript path).

---

## 4. Responses and how to show them

| Status | Body | Client action |
|---|---|---|
| 200 | `{"ok":true,"reference":"HVD-2026-7KQ2MX"}` | Success (below). Validate the reference with `/^HVD-\d{4}-[A-HJ-NP-Z2-9]{6}$/` |
| 422 | `{"ok":false,"errors":{"email":"Enter an email…","items":"…"}}` | For each key that names a form field, `HVDForm.setError(field, message)`; `items` (and `form`, if present) go to the form alert. Focus the first field in error. |
| 403 `code:"token"` | token missing, expired, used or invalid | Fetch a new token, wait `min_wait`, resend once. If it fails again, show `errors.form`. |
| 429 `code:"retry"` | sent too soon after the token was issued | Wait `retry_after` seconds (also in `Retry-After`), resend once. Keep showing "Sending…". |
| 429 `code:"rate_limited"` | too many requests from this address or network (IPv4 /24, IPv6 /48), or the site-wide hourly/daily caps; in busy mode (unusual volume site-wide) each network may send one email per hour | Show `errors.form` (it names the email address to use instead). Do not retry. |
| 403 `code:"forbidden"`, 400, 405, 413, 415 | | Show `errors.form`. |
| 503 / 500 `code:"server"` | mail or server problem | Show `errors.form`. The same request can be resent later. |
| anything not JSON, network error | | Show: `We could not send your request just now. Please try again, or email info@hvdiscover.com.` |

Every error body has the shape `{ok:false, errors:{...}}`; form-level problems use the key `form`.
A repeated identical request within an hour returns the first request's reference and sends no
second email, so a double click or a retry after a lost response is harmless. Still disable the
submit button while a request is in flight.

### Success

- **Quote:** clear the list (`save([], {})` as today), keep the summary in sessionStorage
  (`hvd-quote-sent`) **with `ref: response.reference`**, then
  `location.href = "/quote-sent?ref=" + encodeURIComponent(reference)`.
- **Quote-sent page:** read `ref` from `location.search`, check it against the regex above and
  insert it with `textContent`. If it is missing or does not match, show the page without a
  reference (never invent one: remove the mockup's `makeRef()`). Show the "What you sent" summary
  only when `sessionStorage` data has the same `ref`. The URL always wins: the mockup's current
  code shows `sessionStorage` data first, and a browser test showed it displaying an older
  reference after a second request was sent from the same tab without JavaScript.
- **Contact:** show the existing `[data-form-done]` box with the email and the reference, reset
  the form. Without JavaScript the server redirects to `/contact?ref=…#message-sent`: give the
  "Message sent" box `id="message-sent"` and reveal it with CSS `#message-sent:target { display: block; }`
  (or read `ref` from the URL when scripts run).

---

## 5. Drop-in client script

Plain script in the style of forms.js (`window.HVDApi`). Load it after forms.js.

```js
/* api-client.js: token handling, submit and error mapping for the form API. */
(function () {
  "use strict";
  var REF_RE = /^HVD-\d{4}-[A-HJ-NP-Z2-9]{6}$/;
  var FALLBACK = "We could not send your request just now. Please try again, or email info@hvdiscover.com.";

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* One token source per form. load() early (page load), get() at submit time. */
  function tokens(form) {
    var s = { token: "", at: 0, minWait: 3, maxAge: 7200, pending: null };
    function load() {
      if (!s.pending) {
        s.pending = fetch("/api/token.php?form=" + form, { headers: { Accept: "application/json" }, cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (j && j.ok) { s.token = j.token; s.at = Date.now(); s.minWait = j.min_wait; s.maxAge = j.expires_in; }
          })
          .catch(function () { /* the submit will try again */ })
          .then(function () { s.pending = null; });
      }
      return s.pending;
    }
    async function get(forceNew) {
      if (forceNew || !s.token || Date.now() - s.at > (s.maxAge - 300) * 1000) { s.token = ""; await load(); }
      if (!s.token) return "";
      var left = s.minWait * 1000 - (Date.now() - s.at);
      if (left > 0) await wait(left + 150);
      return s.token;
    }
    return { load: load, get: get };
  }

  async function post(endpoint, payload) {
    try {
      var r = await fetch("/api/" + endpoint + ".php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      var body = null;
      try { body = await r.json(); } catch (e) { body = null; }
      return body;
    } catch (e) {
      return null;
    }
  }

  /* Resolves to {ok:true, reference} or {ok:false, errors:{...}}. */
  async function send(endpoint, tok, buildPayload) {
    var forceNew = false;
    for (var attempt = 0; attempt < 3; attempt++) {
      var payload = buildPayload();
      payload.token = await tok.get(forceNew);
      forceNew = false;
      var b = await post(endpoint, payload);
      if (b && b.ok === true && REF_RE.test(b.reference)) return b;
      if (b && b.code === "token") { forceNew = true; continue; }
      if (b && b.code === "retry") { await wait(((b.retry_after | 0) || 3) * 1000 + 200); continue; }
      if (b && b.errors) return { ok: false, errors: b.errors };
      return { ok: false, errors: { form: FALLBACK } };
    }
    return { ok: false, errors: { form: FALLBACK } };
  }

  /* Map server errors onto the existing inline error UI (forms.js markup contract). */
  function showErrors(form, errors) {
    var bad = [];
    Object.keys(errors).forEach(function (name) {
      if (name === "form" || name === "items") return;
      var el = form.elements.namedItem(name);
      if (el && el.id && document.getElementById(el.id + "-error")) {
        window.HVDForm.setError(el, String(errors[name]));
        bad.push(el);
      }
    });
    var alert = form.querySelector("[data-form-alert]");
    var text = errors.form || errors.items ||
      (bad.length === 1 ? "One field needs your attention." : bad.length + " fields need your attention.");
    if (alert) {
      alert.hidden = false;
      alert.querySelector("[data-form-alert-text]").textContent = String(text);
    }
    if (bad[0]) bad[0].focus();
    else if (alert) { alert.setAttribute("tabindex", "-1"); alert.focus(); }
  }

  window.HVDApi = { tokens: tokens, send: send, showErrors: showErrors, REF_RE: REF_RE };
})();
```

Wiring on the quote page (inside quote.js, replacing the current `onValid`):

```js
var quoteTokens = window.HVDApi.tokens("quote");
quoteTokens.load();                                    // early, so min_wait has passed by submit time
var val = function (n) { return form.elements.namedItem(n).value; };
var ctl = window.HVDForm.attach(form, {
  extra: /* unchanged */,
  onValid: async function () {
    var btn = form.querySelector('[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true; btn.setAttribute("aria-busy", "true");
    var res = await window.HVDApi.send("quote", quoteTokens, function () {
      var list = getList(), qty = getQty();
      return {
        name: val("name"), company: val("company"), country: val("country"), email: val("email"),
        phone: val("phone"), voltage: val("voltage"), length: val("length"), message: val("message"),
        items: list.map(function (id) { return { model: id, qty: qtyOf(qty, id) }; }),
        website: val("website")
      };
    });
    btn.disabled = false; btn.removeAttribute("aria-busy");
    if (!res.ok) { window.HVDApi.showErrors(form, res.errors); return; }
    var list = getList(), qty = getQty();
    var pick = function (n) { var s = form.elements.namedItem(n); return s.value ? s.options[s.selectedIndex].text : ""; };
    try {
      sessionStorage.setItem("hvd-quote-sent", JSON.stringify({
        ref: res.reference, email: val("email").trim(),
        items: list.map(function (id) { return { id: id, qty: qtyOf(qty, id) }; }),
        voltage: pick("voltage"), length: pick("length")   // display text, for the summary only
      }));
    } catch (e) { /* the sent page shows the reference from the URL anyway */ }
    save([], {});
    window.location.href = "/quote-sent?ref=" + encodeURIComponent(res.reference);
  }
});
```

The contact page is the same with `tokens("contact")`, the four contact fields and, on success,
the `[data-form-done]` box (`res.reference` can be shown next to the email).

---

## 6. Requirements for the site build and `.htaccess`

- **CSP** on the pages: `connect-src 'self'` (fetch) and `form-action 'self'` (plain post and the
  redirect after it). The API's own responses carry their own strict CSP.
- **Referrer-Policy**: `strict-origin-when-cross-origin` or `same-origin`. **Never
  `no-referrer`** on the form pages: browsers then send `Origin: null` on form posts and the
  server refuses them (403).
- Frame protection for the pages (`frame-ancestors 'self'` or `X-Frame-Options: SAMEORIGIN`).
- Do not cache `/api/*` (no CDN "cache everything" rule, no service-worker caching).
- Do not rewrite `/api/*` URLs in the site's `.htaccess` (clean-URL rules must skip `/api/`),
  and keep `api/.htaccess` and `api/.user.ini` in the build output.
- Do not ship `api/tests/`, `api/CLIENT.md` or `api/config.php` in `public/api/` (they are
  denied anyway, but they do not belong on the server). **`api/config.php` in this folder holds a
  secret generated on the development machine: never deploy it.** The API refuses to run with a
  config file inside the web root unless `dev_mode` is true, so a copy that slips into a build
  answers 503 instead of running with that secret. The site repo must gitignore
  `public/api/config.php` and `public/api/data/`.
- Keep quote.js `CATALOG` ids and `HVD_PRODUCTS` in `api/lib/forms.php` identical.

---

## 7. Local development

PHP's built-in server ignores `.htaccess`; `api/tests/router.php` applies the same allow-list.

1. Make a development config outside the repo, e.g. `F:\work\HV Discover\dev\api-config.php`,
   from `config.sample.php` with: a random `secret`, `dev_mode => true` (allows
   `http://localhost:*` origins, and a config file inside the web root, which this path counts
   as: it sits next to `api/`), `mail_transport => 'file'` (emails are written to
   `<data_dir>/outbox/*.eml` instead of sent), and `data_dir` pointing to a scratch folder.
2. Start the API (PowerShell):
   ```powershell
   $env:HVD_CONFIG = "F:\work\HV Discover\dev\api-config.php"
   & "F:\work\HV Discover\tools\php\php.exe" -S 127.0.0.1:8090 -t "F:\work\HV Discover\api" "F:\work\HV Discover\api\tests\router.php"
   ```
3. Either proxy `/api` from the Astro dev server (same origin for the browser), in `astro.config.mjs`:
   ```js
   vite: { server: { proxy: { "/api": { target: "http://127.0.0.1:8090", rewrite: (p) => p.replace(/^\/api/, "") } } } }
   ```
   or build the site and serve `dist/` (which then contains `api/`) with
   `php -S 127.0.0.1:8090 -t dist dist/api/tests/router.php` (copy `tests/` there for local use only).

Tests: `python -I tools/test_forms_api.py` (add `--php tools/php74/php.exe` for PHP 7.4). They
start their own servers with throwaway configs and a fake SMTP server; nothing is sent anywhere.

---

## 8. Deploying the endpoints (DirectAdmin host)

1. **PHP**: 7.4 or newer (8.1+ recommended). Needs the standard extensions only; `openssl` for
   SMTP with TLS. `mbstring` and `intl` are used when present.
2. **Files**: `public_html/api/` gets `quote.php`, `contact.php`, `token.php`, `lib/`,
   `.htaccess`, `.user.ini`, `config.sample.php`. Not `tests/`, not this file.
3. **Private folder** outside `public_html`:
   `/home/<user>/domains/hvdiscover.com/hvd-private/` (mode 700). Put `config.php` there
   (mode 600, made from `config.sample.php`); the API finds it automatically. `data/` is created
   inside it on first use (rate limits, token claims, logs). New site builds that replace
   `public_html` then never touch configuration or logs. A config file inside `public_html`
   (such as a stray `api/config.php`) is refused with a 503 while `dev_mode` is false; the PHP
   error log then says "the config file in use is inside the web root".
4. **config.php**: new `secret` generated on the server (`php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"`),
   `mail_to` (the mailbox that reads requests), `mail_from` (an address on hvdiscover.com),
   `smtp` (recommended: a dedicated mailbox such as website@hvdiscover.com; host = a name on the
   server's TLS certificate, port 587 `tls` or 465 `ssl`), `dev_mode => false`, `mail_transport`
   `auto` (never `file`). Behind Cloudflare or another proxy: set `trusted_proxies` to its IP
   ranges and `client_ip_header` (e.g. `HTTP_CF_CONNECTING_IP`), otherwise leave them empty.
5. **Mail DNS**: SPF for hvdiscover.com must include this server (mail()) or the SMTP host; enable
   DKIM for the domain in DirectAdmin. If hvdiscover.com mail is hosted elsewhere, set the domain
   to use the remote mail server in DirectAdmin, or local delivery will keep the messages.
6. **Check** (expected result in brackets):
   ```
   curl -i "https://www.hvdiscover.com/api/token.php?form=quote"     [200, JSON with a token]
   curl -i https://www.hvdiscover.com/api/quote.php                   [405]
   curl -i https://www.hvdiscover.com/api/config.php                  [403]
   curl -i https://www.hvdiscover.com/api/config.sample.php           [403]
   curl -i https://www.hvdiscover.com/api/lib/bootstrap.php           [403]
   curl -i https://www.hvdiscover.com/api/.user.ini                   [403]
   curl -i https://www.hvdiscover.com/api/                            [403]
   curl -i -X POST -H "Origin: https://evil.example" -H "Content-Type: application/json" \
        -d "{}" https://www.hvdiscover.com/api/contact.php            [403]
   ```
   Then send one real quote and one real contact message from the live pages, check they arrive,
   that Reply-To is the visitor address and that SPF/DKIM pass, and look at
   `hvd-private/data/log/forms-YYYY-MM.log` (one `"ev":"sent"` line each).
   If every `/api/` URL answers 500, the host refuses a directive in `api/.htaccess`; its error
   log names it (see the comments in that file).
7. **Client IP source** (once after deploying, and again after any change of proxy or CDN). The
   rate limits are only as good as the address the API sees. Send, from your own connection:
   ```
   curl -i -X POST -H "Origin: https://www.hvdiscover.com" -H "Content-Type: application/json" \
        -H "X-Forwarded-For: 1.2.3.4" -d "{}" https://www.hvdiscover.com/api/contact.php   [422]
   ```
   The newest line of `hvd-private/data/log/forms-YYYY-MM.log` is an `"ev":"invalid"` line. Its
   `net` field must be the /24 of **your own public IP address**.
   - `"net":"1.2.3.0/24"`: the forged header was believed. `trusted_proxies` is too wide, or the
     host's `mod_remoteip` trusts `X-Forwarded-For` from anyone; anyone could then pick their
     own rate-limit bucket. Fix it before going live.
   - The server's own address, `127.0.0.0/24`, or the same value whatever connection you test
     from: a proxy in front of PHP hides visitors (DirectAdmin's nginx in front of Apache without
     `mod_remoteip`, or a CDN), and every visitor shares one limit. Either have the host enable
     `mod_remoteip` for that proxy, or set `trusted_proxies` to the proxy's address(es) and
     `client_ip_header` to the header it sets (`HTTP_X_REAL_IP`, `HTTP_X_FORWARDED_FOR`, or
     `HTTP_CF_CONNECTING_IP` for Cloudflare), then repeat this check.
