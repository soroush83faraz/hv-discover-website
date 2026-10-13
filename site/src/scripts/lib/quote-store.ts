/**
 * The quote list: an array of product ids (the product `model`, e.g. "TDR-901") kept in
 * localStorage under "hvd-quote-list". Shared by the header counter and Add to quote
 * buttons (quote-list.ts) and the quote page (quote.ts). Storage is guarded: in private mode
 * the list lives in memory for the page.
 *
 * Only the six quotable models (src/data/quotable.ts) are kept. A list saved by an older
 * version of the site may still hold "Cable test van", which the API now refuses: unknown ids
 * are dropped silently when the list is read, and the cleaned list is saved back.
 */
import { isQuotableModel } from '../../data/quotable';

export const QUOTE_KEY = 'hvd-quote-list';

let memory: string[] | null = null;

function readStorage(): string[] {
  let stored: unknown[];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(QUOTE_KEY) || '[]');
    stored = Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
  const list = stored.filter((x, i): x is string => typeof x === 'string' && isQuotableModel(x) && stored.indexOf(x) === i);
  if (list.length !== stored.length) {
    try {
      localStorage.setItem(QUOTE_KEY, JSON.stringify(list));
    } catch {
      /* private mode: the cleaned list lives in memory */
    }
  }
  return list;
}

export function getQuoteList(): string[] {
  if (memory === null) memory = readStorage();
  return memory.slice();
}

export function setQuoteList(list: string[]): void {
  memory = list.slice();
  try {
    localStorage.setItem(QUOTE_KEY, JSON.stringify(list));
  } catch {
    /* private mode: keep in memory */
  }
}

/** Adds the id if missing, removes it if present. Returns true when it is now in the list. */
export function toggleQuoteItem(id: string): boolean {
  if (!isQuotableModel(id)) return false;
  const list = getQuoteList();
  const i = list.indexOf(id);
  if (i > -1) list.splice(i, 1);
  else list.push(id);
  setQuoteList(list);
  return i < 0;
}

/**
 * Updates every header counter ([data-quote-count]) and quote link label
 * ([data-quote-link]). With pulse, the counter plays the brand pulse ring once.
 */
export function renderQuoteCount(pulse = false): void {
  const n = getQuoteList().length;
  document.querySelectorAll<HTMLElement>('[data-quote-count]').forEach((c) => {
    c.textContent = String(n);
    c.classList.toggle('has-items', n > 0);
    if (pulse) {
      c.classList.remove('is-pulsing');
      void c.offsetWidth; // restart the ring
      c.classList.add('is-pulsing');
    }
  });
  document.querySelectorAll('[data-quote-link]').forEach((a) => {
    a.setAttribute('aria-label', `Quote ${n}${n === 1 ? ' item' : ' items'} in your list`);
  });
}
