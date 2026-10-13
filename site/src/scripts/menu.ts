/**
 * Mobile menu sheet (Header.astro): the Menu button opens a full-height sheet below the
 * header. Escape or a link closes it; widening past 1100px closes it too.
 */
const menuBtn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const sheet = document.getElementById('menu-sheet');

if (menuBtn && sheet) {
  const label = menuBtn.querySelector('.menu-btn__label');

  const setOpen = (open: boolean, restoreFocus: boolean): void => {
    menuBtn.setAttribute('aria-expanded', String(open));
    if (label) label.textContent = open ? 'Close' : 'Menu';
    sheet.hidden = !open;
    document.body.classList.toggle('menu-open', open);
    if (open) {
      sheet.querySelector('a')?.focus();
    } else if (restoreFocus) {
      menuBtn.focus();
    }
  };

  menuBtn.addEventListener('click', () => {
    setOpen(menuBtn.getAttribute('aria-expanded') !== 'true', true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) setOpen(false, true);
  });
  sheet.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) setOpen(false, false);
  });
  window.matchMedia('(min-width: 1100px)').addEventListener('change', (mq) => {
    if (mq.matches) setOpen(false, false);
  });
}

export {}; // module scope: keeps these names out of the global script scope
