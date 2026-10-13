/**
 * The one place that talks to the form API, as specified in api/CLIENT.md (the PHP endpoints
 * are served from the same origin at /api/). Used by quote.ts and contact.ts after the inline
 * checks in forms.ts pass.
 *
 *   GET  /api/token.php?form=quote|contact -> {ok, token, min_wait, expires_in}
 *   POST /api/quote.php | /api/contact.php, JSON, Accept: application/json, body = the form
 *        fields + `website` (honeypot) + `token` (+ `items: [{model, qty}]` for the quote)
 *   200 {ok:true, reference}                   -> success (reference checked against REF_RE)
 *   403 {code:"token"}                         -> new token, wait min_wait, send again
 *   429 {code:"retry", retry_after}            -> wait retry_after seconds, send again
 *   anything else {ok:false, errors:{…}}       -> errors for the form (forms.ts showServerErrors)
 *   not JSON / network error                   -> FALLBACK in the form alert
 *
 * Without JavaScript the forms post to the same endpoints as plain HTML forms (action/method
 * on the <form>); the API answers with its own review page, then redirects.
 * There is no stand-in API: on `npm run dev` without the local PHP server (CLIENT.md §7),
 * a submit shows the FALLBACK message.
 *
 * Design preview (`npm run build:preview`, PUBLIC_PREVIEW=1, static hosting without PHP):
 * no request is made at all, neither the token nor the post, and every submit answers
 * PREVIEW_MESSAGE in the form alert. In the production build PREVIEW is the constant false
 * and the preview branches are dropped from the bundle.
 */

export type FormName = 'quote' | 'contact';

export const ENDPOINTS: Record<FormName, string> = {
  quote: '/api/quote.php',
  contact: '/api/contact.php',
};
const TOKEN_URL = '/api/token.php';

/** A reference as the API issues it: "HVD-2026-7KQ2MX". */
export const REF_RE = /^HVD-\d{4}-[A-HJ-NP-Z2-9]{6}$/;

export const FALLBACK = 'We could not send your request just now. Please try again, or email info@hvdiscover.com.';

const PREVIEW = import.meta.env.PUBLIC_PREVIEW === '1';
const PREVIEW_MESSAGE = 'This is a design preview: the form is not connected yet. Nothing was sent.';

export type SubmitResult = { ok: true; reference: string } | { ok: false; errors: Record<string, string> };

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/* ---------------------------------------------------------------- tokens */

interface TokenState {
  token: string;
  at: number;
  minWait: number;
  maxAge: number;
  pending: Promise<void> | null;
}

/** One token source per form: load() early (page load), get() at submit time. */
export interface TokenSource {
  load: () => Promise<void>;
  get: (forceNew?: boolean) => Promise<string>;
}

export function tokens(form: FormName): TokenSource {
  const s: TokenState = { token: '', at: 0, minWait: 3, maxAge: 7200, pending: null };

  const load = (): Promise<void> => {
    if (PREVIEW) return Promise.resolve();
    if (!s.pending) {
      s.pending = fetch(`${TOKEN_URL}?form=${form}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
        .then((j) => {
          if (isObject(j) && j.ok === true && typeof j.token === 'string') {
            s.token = j.token;
            s.at = Date.now();
            if (typeof j.min_wait === 'number') s.minWait = j.min_wait;
            if (typeof j.expires_in === 'number') s.maxAge = j.expires_in;
          }
        })
        .catch(() => {
          /* the submit will try again */
        })
        .then(() => {
          s.pending = null;
        });
    }
    return s.pending;
  };

  const get = async (forceNew = false): Promise<string> => {
    if (forceNew || !s.token || Date.now() - s.at > (s.maxAge - 300) * 1000) {
      s.token = '';
      await load();
    }
    if (!s.token) return '';
    const left = s.minWait * 1000 - (Date.now() - s.at);
    if (left > 0) await wait(left + 150);
    return s.token;
  };

  return { load, get };
}

/* ---------------------------------------------------------------- submit */

async function post(form: FormName, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(ENDPOINTS[form], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    try {
      const body: unknown = await r.json();
      return isObject(body) ? body : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function toErrors(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObject(v)) {
    for (const [k, msg] of Object.entries(v)) {
      if (typeof msg === 'string' && msg) out[k] = msg;
    }
  }
  return out;
}

/**
 * Sends one form; never throws. `build` returns the fields (without the token) and is called
 * for every attempt; a "token" or "retry" answer is retried automatically (at most 3 sends).
 */
export async function submitForm(
  form: FormName,
  tok: TokenSource,
  build: () => Record<string, unknown>,
): Promise<SubmitResult> {
  if (PREVIEW) return { ok: false, errors: { form: PREVIEW_MESSAGE } };
  let forceNew = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = build();
    payload.token = await tok.get(forceNew);
    forceNew = false;
    const b = await post(form, payload);
    if (b && b.ok === true && typeof b.reference === 'string' && REF_RE.test(b.reference)) {
      return { ok: true, reference: b.reference };
    }
    if (b && b.code === 'token') {
      forceNew = true;
      continue;
    }
    if (b && b.code === 'retry') {
      const s = typeof b.retry_after === 'number' ? Math.trunc(b.retry_after) : 0;
      await wait((s || 3) * 1000 + 200);
      continue;
    }
    const errors = b ? toErrors(b.errors) : {};
    return { ok: false, errors: Object.keys(errors).length ? errors : { form: FALLBACK } };
  }
  return { ok: false, errors: { form: FALLBACK } };
}
