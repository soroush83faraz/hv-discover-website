/**
 * Home quote starter (QuoteStarter.astro): three questions. On submit it checks the two
 * required answers, then shows a summary and a "Continue to the quote form" link that
 * carries the answers to /request-a-quote as query parameters (voltage, length, fault:
 * the option text, or "unknown"). The answers are also kept in sessionStorage under
 * "hvd-quote-starter" so the quote page can prefill its form either way.
 * Without JS the form submits the same parameters to /request-a-quote with GET.
 */
export const STARTER_KEY = 'hvd-quote-starter';

const form = document.querySelector<HTMLFormElement>('[data-quote-starter]');

if (form) {
  const required = ['voltage', 'fault'] as const;
  const messages: Record<(typeof required)[number], string> = {
    voltage: 'Choose the cable voltage, or pick “I don’t know”.',
    fault: 'Choose what the cable is doing, or pick “I don’t know”.',
  };

  const field = (name: string): HTMLSelectElement | null =>
    form.querySelector<HTMLSelectElement>(`[name="${name}"]`);

  const setError = (name: string, msg: string): void => {
    const el = field(name);
    const err = document.getElementById(`${name}-error`);
    el?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (!err) return;
    err.hidden = !msg;
    const span = err.querySelector('span');
    if (span) span.textContent = msg;
  };

  form.addEventListener('change', (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement && el.getAttribute('aria-invalid') === 'true' && el.value) {
      setError(el.name, '');
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let firstBad: HTMLSelectElement | null = null;
    for (const name of required) {
      const el = field(name);
      const bad = !el?.value;
      setError(name, bad ? messages[name] : '');
      if (bad && !firstBad) firstBad = el;
    }
    const status = form.querySelector<HTMLElement>('.form-status');
    if (!status) return;
    if (firstBad) {
      status.hidden = true;
      firstBad.focus();
      return;
    }

    const text = (name: string): string => {
      const s = field(name);
      return s ? (s.options[s.selectedIndex]?.text ?? '') : '';
    };
    const summary = status.querySelector('[data-summary]');
    if (summary) {
      summary.textContent = `${text('voltage')}, ${text('length').toLowerCase()}, ${text('fault').toLowerCase()}.`;
    }

    // Carry the answers: query string on the continue link, and sessionStorage.
    const params = new URLSearchParams();
    const answers: Record<string, string> = {};
    for (const name of ['voltage', 'length', 'fault']) {
      const v = field(name)?.value ?? '';
      if (v) {
        params.set(name, v);
        answers[name] = v;
      }
    }
    const link = status.querySelector<HTMLAnchorElement>('[data-continue]');
    if (link) link.href = `${form.action || '/request-a-quote'}?${params.toString()}`;
    try {
      sessionStorage.setItem(STARTER_KEY, JSON.stringify(answers));
    } catch {
      /* storage blocked: the query string still carries the answers */
    }

    status.hidden = false;
    status.focus();
  });
}
