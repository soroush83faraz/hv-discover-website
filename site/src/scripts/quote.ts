/**
 * /request-a-quote and /quote-sent (loaded by both pages).
 * The quote list is the one in lib/quote-store.ts (localStorage "hvd-quote-list", an array
 * of product models). Quantities live beside it in "hvd-quote-qty" ({id: n}).
 *
 * - Both pages embed the product catalog as <script type="application/json" id="quote-catalog">
 *   (components/QuoteCatalog.astro, from getQuoteCatalog() in src/lib/products.ts).
 * - The form uses forms.ts (attachForm) for the inline checks, then sends through
 *   lib/submit.ts (api/CLIENT.md: token fetched at page load, JSON POST to /api/quote.php). On success it stores a summary in sessionStorage "hvd-quote-sent" (with the
 *   reference the API returned), empties the list and goes to /quote-sent?ref=<reference>.
 *   API errors go to the same inline errors and alert.
 * - Answers from the Home quote starter arrive as ?voltage=&length=&fault= (or in
 *   sessionStorage "hvd-quote-starter"); they prefill #q-voltage, #q-length and, if the
 *   page has one, #q-fault.
 * - /quote-sent shows the reference from ?ref= only and, when the stored summary carries the
 *   same reference, "What you sent". It never makes a reference up.
 */
import { attachForm, isBusy, setBusy, showServerErrors } from './forms';
import { REF_RE, submitForm, tokens } from './lib/submit';
import { getQuoteList, renderQuoteCount, setQuoteList } from './lib/quote-store';

interface CatalogItem {
  id: string;
  name: string;
  step: string;
  href: string;
  img?: { src: string; srcset: string };
  drawing?: 'pg-10' | 'crt-015';
}
interface SentData {
  ref: string;
  name?: string;
  email?: string;
  items: { id: string; qty: number }[];
  voltage?: string;
  length?: string;
}

const QKEY = 'hvd-quote-qty';
const SENT = 'hvd-quote-sent';
const STARTER = 'hvd-quote-starter';
const MAX_QTY = 99;

const DRAW: Record<'pg-10' | 'crt-015' | 'generic', string> = {
  'pg-10':
    '<svg viewBox="0 0 400 300" aria-hidden="true"><path class="ln" d="M132 96h152v150H132zM284 96l42-22v146l-42 26M132 96l42-22h152"/><path class="ln-thin" d="M142 106h132v130H142z"/><path class="ln" d="M160 85v-14h52v14M160 71h52M240 82v-14h52v12M240 68h52"/><path class="ln" d="M184 116h48v16h-48z"/><circle class="ln" cx="208" cy="168" r="20"/><path class="ln" d="M196 174l18-14M190 168h4M222 168h4M208 150v4"/><circle class="ln" cx="160" cy="218" r="5"/><circle class="ln" cx="178" cy="218" r="5"/><circle class="ln" cx="250" cy="216" r="10"/><path class="ln" d="M298 130v40l14-7v-40z"/><circle class="pt" cx="226" cy="218" r="4"/></svg>',
  'crt-015':
    '<svg viewBox="0 0 400 300" aria-hidden="true"><path class="ln" d="M96 238l92-168 14 8-92 168z"/><path class="ln" d="M176 92l34 18-12 22-34-18z"/><path class="ln-thin" d="M180 100l22 12-6 11-22-12z"/><path class="ln" d="M196 66l12-22 20 11-12 22"/><path class="ln" d="M232 156h104v80H232z"/><path class="ln" d="M256 156v-22c0-8 6-14 14-14h28c8 0 14 6 14 14v22"/><path class="ln" d="M246 170h44v28h-44z"/><circle class="ln" cx="314" cy="184" r="8"/><path class="ln" d="M306 184h-4M326 184h-4M314 172v4M314 196v-4"/><path class="ln-thin" d="M246 214h76M246 224h76"/><path class="ln" d="M110 246c-6 6-14 8-22 4"/><circle class="pt" cx="102" cy="246" r="4"/></svg>',
  generic:
    '<svg viewBox="0 0 400 300" aria-hidden="true"><path class="ln" d="M130 100h140v110H130z"/><path class="ln-thin" d="M146 116h108v78H146z"/><circle class="pt" cx="200" cy="155" r="4"/></svg>',
};

function readCatalog(): CatalogItem[] {
  try {
    const v: unknown = JSON.parse(document.getElementById('quote-catalog')?.textContent || '[]');
    return Array.isArray(v) ? (v as CatalogItem[]) : [];
  } catch {
    return [];
  }
}
const CATALOG = readCatalog();
const info = (id: string): CatalogItem => CATALOG.find((p) => p.id === id) ?? { id, name: '', step: '', href: '/products' };

/* ---------------------------------------------------------- storage (guarded) */
let memQty: Record<string, number> | null = null;
function getQty(): Record<string, number> {
  if (memQty) return { ...memQty };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(QKEY) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function save(list: string[], qty: Record<string, number>): void {
  setQuoteList(list);
  memQty = { ...qty };
  try {
    localStorage.setItem(QKEY, JSON.stringify(qty));
  } catch {
    /* private mode: keep in memory */
  }
}
function qtyOf(qty: Record<string, number>, id: string): number {
  const n = parseInt(String(qty[id]), 10);
  return n >= 1 ? Math.min(MAX_QTY, n) : 1;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);
function media(p: CatalogItem): string {
  if (p.img) return `<img src="${esc(p.img.src)}" srcset="${esc(p.img.srcset)}" sizes="160px" alt="" width="800" height="600" loading="lazy" decoding="async">`;
  return `<div class="drawing">${DRAW[p.drawing ?? 'generic']}</div>`;
}

/* ---------------------------------------------------------- quote page */
const page = document.querySelector<HTMLElement>('[data-quote-page]');
if (page) setupQuotePage(page);

function setupQuotePage(page: HTMLElement): void {
  const q = <T extends Element = HTMLElement>(sel: string): T | null => page.querySelector<T>(sel);
  const listEl = q('[data-qlist]');
  const emptyEl = q('[data-qempty]');
  const countEl = q('[data-qcount]');
  const footEl = q('[data-qfoot]');
  const statusEl = q('[data-qstatus]');
  const statusText = q('[data-qstatus-text]');
  const undoBtn = q<HTMLButtonElement>('[data-qundo]');
  const live = q('[data-qlive]');
  const addWrap = q('[data-qadd]');
  const addBox = q('[data-qadd-wrap]');
  const addTitle = q('[data-qadd-title]');
  if (!listEl || !emptyEl || !countEl || !footEl || !statusEl || !statusText || !undoBtn || !live || !addWrap || !addBox || !addTitle) return;

  let lastRemoved: { id: string; idx: number; qty: number } | null = null;
  let recheckMessage: () => void = () => {};

  const announce = (msg: string): void => {
    live.textContent = '';
    window.setTimeout(() => {
      live.textContent = msg;
    }, 30);
  };

  const renderAdd = (): void => {
    const list = getQuoteList();
    const rest = CATALOG.filter((p) => list.indexOf(p.id) < 0);
    addBox.hidden = rest.length === 0;
    addTitle.textContent = list.length ? 'Add another product' : 'Add a product';
    addWrap.innerHTML = rest
      .map((p) => `<li><button class="btn btn--secondary btn--sm" type="button" data-qadd-id="${esc(p.id)}"><span class="sr-only">Add </span>${esc(p.id)}</button></li>`)
      .join('');
  };

  const render = (): void => {
    const list = getQuoteList();
    const qty = getQty();
    const n = list.length;
    countEl.textContent = n === 0 ? 'Empty' : `${n}${n === 1 ? ' product' : ' products'}`;
    emptyEl.hidden = n > 0;
    listEl.hidden = n === 0;
    footEl.hidden = n === 0;
    listEl.innerHTML = list
      .map((id) => {
        const p = info(id);
        const n2 = qtyOf(qty, id);
        const e = esc(id);
        return (
          `<li class="qitem" data-id="${e}">` +
          `<a class="qitem__media plate" href="${esc(p.href)}" tabindex="-1" aria-hidden="true">${media(p)}</a>` +
          '<div class="qitem__info">' +
          (p.step ? `<p class="qitem__step">${esc(p.step)}</p>` : '') +
          `<h3 class="qitem__model nameplate"><a href="${esc(p.href)}">${e}</a></h3>` +
          (p.name ? `<p class="qitem__name">${esc(p.name)}</p>` : '') +
          '</div>' +
          '<div class="qitem__controls">' +
          '<div class="qitem__qty"><span class="qty-label" aria-hidden="true">Qty</span>' +
          `<div class="stepper" role="group" aria-label="Quantity, ${e}">` +
          `<button class="stepper__btn" type="button" data-qstep="-1" aria-label="One fewer ${e}"${n2 <= 1 ? ' disabled' : ''}><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" stroke-width="1.8"/></svg></button>` +
          `<input class="stepper__input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${n2}" aria-label="Quantity of ${e}" data-qinput>` +
          `<button class="stepper__btn" type="button" data-qstep="1" aria-label="One more ${e}"${n2 >= MAX_QTY ? ' disabled' : ''}><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10M7 2v10" stroke="currentColor" stroke-width="1.8"/></svg></button>` +
          '</div></div>' +
          `<button class="qitem__remove" type="button" data-qremove>Remove<span class="sr-only"> ${e} from the quote list</span></button>` +
          '</div></li>'
        );
      })
      .join('');
    renderAdd();
    renderQuoteCount(false);
    recheckMessage();
  };

  const rowOf = (id: string): HTMLElement | null => listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);

  const setQty = (id: string, nIn: number, focusSel: string): void => {
    const list = getQuoteList();
    const qty = getQty();
    const n = Math.max(1, Math.min(MAX_QTY, nIn || 1));
    qty[id] = n;
    save(list, qty);
    render();
    const row = rowOf(id);
    if (row) {
      let f = row.querySelector<HTMLButtonElement | HTMLInputElement>(focusSel);
      if (f && f.disabled) f = row.querySelector<HTMLInputElement>('[data-qinput]');
      f?.focus();
    }
    announce(`${id}, quantity ${n}.`);
  };

  listEl.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest<HTMLElement>('.qitem');
    if (!target || !row) return;
    const id = row.dataset.id ?? '';
    const step = target.closest<HTMLElement>('[data-qstep]');
    if (step) {
      const d = parseInt(step.dataset.qstep ?? '0', 10);
      setQty(id, qtyOf(getQty(), id) + d, `[data-qstep="${d}"]`);
      return;
    }
    if (target.closest('[data-qremove]')) {
      const list = getQuoteList();
      const qty = getQty();
      const idx = list.indexOf(id);
      lastRemoved = { id, idx, qty: qtyOf(qty, id) };
      list.splice(idx, 1);
      delete qty[id];
      save(list, qty);
      render();
      renderQuoteCount(true);
      const rows = listEl.querySelectorAll<HTMLElement>('.qitem');
      const next = rows[Math.min(idx, rows.length - 1)];
      statusText.textContent = `${id} removed.`;
      statusEl.hidden = false;
      if (next) next.querySelector<HTMLElement>('[data-qremove]')?.focus();
      else undoBtn.focus();
      announce(`${id} removed from the quote list. ${list.length}${list.length === 1 ? ' product' : ' products'} left.`);
    }
  });
  listEl.addEventListener('change', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-qinput]')) return;
    const id = input.closest<HTMLElement>('.qitem')?.dataset.id ?? '';
    setQty(id, parseInt(input.value.replace(/\D/g, ''), 10), '[data-qinput]');
  });
  listEl.addEventListener('keydown', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-qinput]')) return;
    const id = input.closest<HTMLElement>('.qitem')?.dataset.id ?? '';
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setQty(id, qtyOf(getQty(), id) + (e.key === 'ArrowUp' ? 1 : -1), '[data-qinput]');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
      input.focus();
    }
  });

  undoBtn.addEventListener('click', () => {
    if (!lastRemoved) return;
    const list = getQuoteList();
    const qty = getQty();
    if (list.indexOf(lastRemoved.id) < 0) list.splice(Math.min(lastRemoved.idx, list.length), 0, lastRemoved.id);
    qty[lastRemoved.id] = lastRemoved.qty;
    save(list, qty);
    render();
    renderQuoteCount(true);
    statusEl.hidden = true;
    rowOf(lastRemoved.id)?.querySelector<HTMLElement>('[data-qremove]')?.focus();
    announce(`${lastRemoved.id} is back in the quote list.`);
    lastRemoved = null;
  });

  addWrap.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-qadd-id]') : null;
    if (!b) return;
    const id = b.dataset.qaddId ?? '';
    const list = getQuoteList();
    const qty = getQty();
    if (list.indexOf(id) < 0) list.push(id);
    qty[id] = qtyOf(qty, id);
    save(list, qty);
    statusEl.hidden = true;
    render();
    renderQuoteCount(true);
    rowOf(id)?.querySelector<HTMLElement>('.qitem__model a')?.focus();
    announce(`${id} added to the quote list.`);
  });

  render();

  /* -------------------------------------------------------- prefill from the Home quote starter */
  let starter: Record<string, string> = {};
  try {
    starter = JSON.parse(sessionStorage.getItem(STARTER) || '{}') as Record<string, string>;
  } catch {
    starter = {};
  }
  const params = new URLSearchParams(location.search);
  for (const [name, id] of [['voltage', 'q-voltage'], ['length', 'q-length'], ['fault', 'q-fault']] as const) {
    const value = params.get(name) ?? starter[name];
    const select = document.getElementById(id);
    if (value && select instanceof HTMLSelectElement && Array.from(select.options).some((o) => o.value === value)) {
      select.value = value;
    }
  }

  /* -------------------------------------------------------- the form */
  const form = document.getElementById('quote-form');
  const msg = document.getElementById('q-message');
  if (!(form instanceof HTMLFormElement) || !(msg instanceof HTMLTextAreaElement)) return;
  const ctl = attachForm(form, {
    extra: () => {
      const empty = getQuoteList().length === 0 && !msg.value.trim();
      return [{ el: msg, msg: empty ? 'Add a product to the list, or tell us here what you need.' : '' }];
    },
    onValid: () => {
      if (isBusy(form)) return;
      void send();
    },
  });
  const quoteTokens = tokens('quote');
  void quoteTokens.load(); // early, so min_wait has passed by submit time (api/CLIENT.md)

  async function send(): Promise<void> {
    if (!(form instanceof HTMLFormElement)) return;
    const pick = (id: string): string => {
      const s = document.getElementById(id);
      return s instanceof HTMLSelectElement && s.value ? (s.options[s.selectedIndex]?.text ?? '') : '';
    };
    const value = (name: string): string => {
      const f = form.elements.namedItem(name);
      return f instanceof HTMLInputElement || f instanceof HTMLSelectElement || f instanceof HTMLTextAreaElement ? f.value.trim() : '';
    };
    setBusy(form, true);
    // select values (not their text) go to the API; the summary below keeps the text
    const res = await submitForm('quote', quoteTokens, () => ({
      name: value('name'),
      company: value('company'),
      country: value('country'),
      email: value('email'),
      phone: value('phone'),
      voltage: value('voltage'),
      length: value('length'),
      message: value('message'),
      items: getQuoteList().map((id) => ({ model: id, qty: qtyOf(getQty(), id) })),
      website: value('website'),
    }));
    if (!res.ok) {
      setBusy(form, false);
      showServerErrors(form, res.errors);
      return;
    }
    const items = getQuoteList().map((id) => ({ id, qty: qtyOf(getQty(), id) }));
    const summary: SentData = {
      ref: res.reference,
      name: value('name'),
      email: value('email'),
      items,
      voltage: pick('q-voltage'),
      length: pick('q-length'),
    };
    try {
      sessionStorage.setItem(SENT, JSON.stringify(summary));
      sessionStorage.removeItem(STARTER);
    } catch {
      /* /quote-sent still shows the reference from the URL */
    }
    save([], {}); // the request is sent: start a fresh list
    window.location.href = `/quote-sent?ref=${encodeURIComponent(res.reference)}`;
  }
  recheckMessage = () => ctl.recheck(msg);
}

/* ---------------------------------------------------------- quote-sent page */
const sent = document.querySelector<HTMLElement>('[data-quote-sent]');
if (sent) setupSentPage(sent);

function setupSentPage(sent: HTMLElement): void {
  let stored: SentData | null = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(SENT) || 'null') as SentData | null;
  } catch {
    stored = null;
  }
  // The URL always wins (api/CLIENT.md §4): no valid ?ref=, no reference on the page.
  const fromUrl = new URLSearchParams(location.search).get('ref') ?? '';
  const ref = REF_RE.test(fromUrl) ? fromUrl : '';
  // the stored summary describes this request only if it carries the same reference
  const d = ref && stored && stored.ref === ref ? stored : null;

  sent.querySelectorAll('[data-ref]').forEach((n) => {
    n.textContent = ref;
  });
  const refWrap = sent.querySelector<HTMLElement>('[data-ref-wrap]');
  if (refWrap) refWrap.hidden = !ref;

  const who = sent.querySelector('[data-reply-to]');
  if (who && d?.email) who.textContent = d.email;
  const whoWrap = sent.querySelector<HTMLElement>('[data-reply-wrap]');
  if (whoWrap) whoWrap.hidden = !d?.email;

  const sumWrap = sent.querySelector<HTMLElement>('[data-summary-wrap]');
  const sum = sent.querySelector('[data-summary]');
  if (sum && sumWrap) {
    const rows = (d?.items || []).map((it) => {
      const p = info(it.id);
      return `<li><span><b>${esc(it.id)}</b>${p.name ? ' ' + esc(p.name) : ''}</span><span class="qty">${it.qty || 1}</span></li>`;
    });
    if (d?.voltage) rows.push(`<li><span>Cable voltage</span><span class="qty">${esc(d.voltage)}</span></li>`);
    if (d?.length) rows.push(`<li><span>Approximate length</span><span class="qty">${esc(d.length)}</span></li>`);
    sum.innerHTML = rows.join('');
    sumWrap.hidden = rows.length === 0;
  }
  renderQuoteCount(false);
}
