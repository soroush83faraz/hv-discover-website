/**
 * Header quote counter and every "Add to quote" button ([data-add-quote="<model>"]).
 * Loaded once by Header.astro, so it runs on every page. Buttons are handled by event
 * delegation: any AddToQuote.astro on the page works without its own script.
 * A page may hold <p class="sr-only" id="quote-status" aria-live="polite"> for announcements.
 */
import { getQuoteList, renderQuoteCount, toggleQuoteItem } from './lib/quote-store';

function renderButtons(): void {
  const list = getQuoteList();
  document.querySelectorAll<HTMLElement>('[data-add-quote]').forEach((b) => {
    const on = list.indexOf(b.dataset.addQuote ?? '') > -1;
    b.setAttribute('aria-pressed', String(on));
    const label = b.querySelector('.add-quote__label');
    if (label) label.textContent = on ? 'Added to quote' : 'Add to quote';
  });
}

document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const b = target?.closest<HTMLElement>('[data-add-quote]');
  if (!b) return;
  const id = b.dataset.addQuote ?? '';
  const added = toggleQuoteItem(id);
  renderQuoteCount(true);
  renderButtons();
  const status = document.getElementById('quote-status');
  if (status) {
    const n = getQuoteList().length;
    status.textContent = `${id} ${added ? 'added to' : 'removed from'} the quote list. ${n}${n === 1 ? ' item.' : ' items.'}`;
  }
});

document.querySelectorAll<HTMLElement>('[data-quote-count]').forEach((c) => {
  c.addEventListener('animationend', () => c.classList.remove('is-pulsing'));
});

renderQuoteCount(false);
renderButtons();
