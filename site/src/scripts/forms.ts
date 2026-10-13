/**
 * Inline form validation for the quote and contact forms (imported by quote.ts and
 * contact.ts), plus the server side of the same UI: showServerErrors() puts the API's
 * per-field messages into the same inline errors and the alert, setBusy() blocks a second
 * submit while one is on its way.
 * Markup contract, per field:
 *   <input id="x" name="x" required data-msg-required="…" data-msg-invalid="…" aria-describedby="x-error">
 *   <p class="field__error" id="x-error" hidden><svg>…</svg><span></span></p>
 * Optional summary: <div data-form-alert hidden><b data-form-alert-title>…</b> <span data-form-alert-text></span></div>
 * Checks: required, type=email, pattern. Errors show on submit; after that a field re-checks
 * as it changes, and clears as soon as it is valid. Focus goes to the first error.
 */

export type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface FormOptions {
  /** Extra checks across fields; return a message per field ("" when valid). */
  extra?: (form: HTMLFormElement) => { el: Field; msg: string }[];
  /** Runs when every field is valid (the submit event is already prevented). */
  onValid?: (form: HTMLFormElement) => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function errorEl(field: Field): HTMLElement | null {
  return document.getElementById(`${field.id}-error`);
}

export function setError(field: Field, msg: string): void {
  const err = errorEl(field);
  field.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (!err) return;
  err.hidden = !msg;
  const span = err.querySelector('span');
  if (span) span.textContent = msg;
}

function check(field: Field): string {
  const v = (field.value || '').trim();
  if (field.required && !v) return field.getAttribute('data-msg-required') || 'This field is required.';
  if (!v) return '';
  if (field.type === 'email' && !EMAIL.test(v)) return field.getAttribute('data-msg-invalid') || 'Enter a valid email address.';
  const pat = field.getAttribute('pattern');
  if (pat && !new RegExp(`^(?:${pat})$`).test(v)) return field.getAttribute('data-msg-invalid') || 'Check the format.';
  return '';
}

export function attachForm(form: HTMLFormElement, opts: FormOptions = {}): { recheck: (f: Field) => void } {
  let tried = false;
  const fields = Array.from(form.querySelectorAll<Field>('input, select, textarea')).filter((f) => f.id && errorEl(f));

  const recheck = (f: Field): void => {
    if (!tried) return;
    let msg = check(f);
    if (!msg && opts.extra) {
      for (const x of opts.extra(form)) if (x.el === f) msg = x.msg;
    }
    setError(f, msg);
  };

  for (const f of fields) {
    f.addEventListener('input', () => {
      if (f.getAttribute('aria-invalid') === 'true') recheck(f);
    });
    f.addEventListener('change', () => recheck(f));
    f.addEventListener('blur', () => recheck(f));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    tried = true;
    const bad: Field[] = [];
    for (const f of fields) {
      const msg = check(f);
      setError(f, msg);
      if (msg) bad.push(f);
    }
    if (opts.extra) {
      for (const x of opts.extra(form)) {
        if (x.msg) {
          setError(x.el, x.msg);
          if (bad.indexOf(x.el) < 0) bad.push(x.el);
        }
      }
    }
    if (bad.length) {
      focusFirst(form, bad);
      return;
    }
    hideAlert(form);
    opts.onValid?.(form);
  });

  return { recheck };
}

/* ---------------------------------------------------------------- alert and server errors */

const ALERT_TITLE = 'Check the form.';

function showAlert(form: HTMLFormElement, text: string, title = ALERT_TITLE): HTMLElement | null {
  const alert = form.querySelector<HTMLElement>('[data-form-alert]');
  if (!alert) return null;
  const t = alert.querySelector('[data-form-alert-title]');
  if (t) t.textContent = title;
  const x = alert.querySelector('[data-form-alert-text]');
  if (x) x.textContent = text;
  alert.hidden = false;
  return alert;
}

function hideAlert(form: HTMLFormElement): void {
  const alert = form.querySelector<HTMLElement>('[data-form-alert]');
  if (alert) alert.hidden = true;
}

function focusFirst(form: HTMLFormElement, bad: Field[]): void {
  bad.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  showAlert(form, bad.length === 1 ? 'One field needs your attention.' : `${bad.length} fields need your attention.`);
  bad[0]?.focus();
}

/**
 * Shows the API's errors ({name: message}, api/CLIENT.md §4) in the form: a key that names a
 * field with an inline error gets that error; "form" and "items" (and any other key) go to
 * the alert. Focus goes to the first field in error, or to the alert.
 */
export function showServerErrors(form: HTMLFormElement, errors: Record<string, string>): void {
  const bad: Field[] = [];
  for (const [name, msg] of Object.entries(errors)) {
    if (name === 'form' || name === 'items') continue;
    const el = form.elements.namedItem(name);
    if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.id && errorEl(el)) {
      setError(el, msg);
      bad.push(el);
    }
  }
  const named = new Set(bad.map((f) => f.name));
  const general = errors.form || errors.items || Object.entries(errors).find(([k]) => k !== 'form' && k !== 'items' && !named.has(k))?.[1];
  if (!general) {
    focusFirst(form, bad);
    return;
  }
  // a refusal of the whole request (rate limit, server, network) is not about the fields
  const alert = showAlert(form, general, bad.length || errors.items ? ALERT_TITLE : 'Not sent.');
  bad.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  if (bad[0]) {
    bad[0].focus();
  } else if (alert) {
    alert.tabIndex = -1;
    alert.focus();
  }
}

const SENDING = 'Sending…';

/**
 * While a request is in flight: the submit button is disabled, aria-busy and reads
 * "Sending…"; its label comes back afterwards.
 */
export function setBusy(form: HTMLFormElement, busy: boolean): void {
  form.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach((b) => {
    if (busy) {
      if (!b.dataset.label) b.dataset.label = b.textContent ?? '';
      b.textContent = SENDING;
      b.setAttribute('aria-busy', 'true');
    } else {
      if (b.dataset.label) b.textContent = b.dataset.label;
      b.removeAttribute('aria-busy');
    }
    b.disabled = busy;
  });
}

export function isBusy(form: HTMLFormElement): boolean {
  return form.querySelector('button[type="submit"][aria-busy="true"]') !== null;
}
