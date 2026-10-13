/**
 * Set-A page behaviour, loaded by /products and /cable-test-van:
 *   1. Catalog family filter (/products): aria-pressed button group, no reload, URL hash
 *      kept in step. Without JS every family is listed (.filter shows only under html.js,
 *      which BaseLayout sets).
 *   2. Callout highlight (/cable-test-van): pointing at or focusing a legend item lights its
 *      marker on the photo, and pointing at a marker lights its legend item.
 * The van is not quotable (src/data/quotable.ts), so nothing here touches the quote list.
 */

/* ---------------------------------------------------------- 1. family filter */
const filter = document.querySelector('[data-filter]');
if (filter) {
  const buttons = Array.from(filter.querySelectorAll<HTMLButtonElement>('[data-filter-value]'));
  const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-family]'));
  const status = document.getElementById('filter-status');
  const ids = groups.map((g) => g.id);

  const apply = (requested: string, announce: boolean): string => {
    const value = ids.indexOf(requested) < 0 ? 'all' : requested;
    let count = 0;
    let name = 'all families';
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.filterValue === value));
    for (const g of groups) {
      const on = value === 'all' || g.id === value;
      g.hidden = !on;
      if (on) count += g.querySelectorAll('.tile').length;
      if (g.id === value) name = g.dataset.family ?? name;
    }
    if (announce && status) {
      status.textContent = `Showing ${name}: ${count}${count === 1 ? ' product.' : ' products.'}`;
    }
    return value;
  };

  for (const b of buttons) {
    b.addEventListener('click', () => {
      const v = apply(b.dataset.filterValue ?? 'all', true);
      history.replaceState(null, '', v === 'all' ? location.pathname + location.search : `#${v}`);
    });
  }
  window.addEventListener('hashchange', () => apply(location.hash.slice(1), true));

  const initial = location.hash.slice(1);
  apply(initial, false);
  if (ids.indexOf(initial) > -1) {
    // The family is now the first thing under the filter, so stay at the top of the page
    // instead of jumping past the page head and the filter to the section.
    const top = (): void => window.scrollTo(0, 0);
    top();
    window.addEventListener('load', () => requestAnimationFrame(top));
  }
}

/* ---------------------------------------------------------- 2. callout highlight */
const callouts = document.querySelector('[data-callouts]');
if (callouts) {
  const light = (n: string, on: boolean): void => {
    callouts.querySelectorAll(`[data-callout="${n}"]`).forEach((el) => el.classList.toggle('is-lit', on));
  };
  callouts.querySelectorAll<HTMLElement>('[data-callout]').forEach((el) => {
    const n = el.dataset.callout ?? '';
    el.addEventListener('mouseenter', () => light(n, true));
    el.addEventListener('mouseleave', () => light(n, false));
    // Legend items are focusable (tabindex="0"), so keyboard users get the same highlight.
    el.addEventListener('focus', () => light(n, true));
    el.addEventListener('blur', () => light(n, false));
  });
}
