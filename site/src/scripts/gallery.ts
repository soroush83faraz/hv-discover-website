/**
 * Product gallery (Gallery.astro): thumbnails swap the stage photo with a 200 ms crossfade.
 * The page ships one stage <img>; the second layer is created on the first switch, so no hidden
 * photo is downloaded before it is asked for. The hidden layer loads the next photo, then the
 * two layers swap.
 * Thumbnails are a roving-tabindex group: arrows, Home and End move between them.
 * Each thumb carries data-src, data-srcset, data-sizes, data-alt and data-caption.
 */
document.querySelectorAll<HTMLElement>('[data-gallery]').forEach((gallery) => {
  const stage = gallery.querySelector<HTMLElement>('.gallery__stage');
  const firstLayer = stage?.querySelector<HTMLImageElement>('img');
  const thumbs = Array.from(gallery.querySelectorAll<HTMLButtonElement>('.thumb'));
  const caption = gallery.querySelector('.gallery__caption');
  if (!stage || !firstLayer || thumbs.length < 2) return;
  const layers: HTMLImageElement[] = [firstLayer];
  let front = 0;

  const backLayer = (): HTMLImageElement => {
    let back = layers[1 - front];
    if (!back) {
      back = document.createElement('img');
      back.className = 'is-hidden';
      back.alt = '';
      back.decoding = 'async';
      back.setAttribute('aria-hidden', 'true');
      stage.append(back);
      layers.push(back);
    }
    return back;
  };

  const select = (idx: number, focus: boolean): void => {
    const t = thumbs[idx];
    if (!t) return;
    if (t.getAttribute('aria-current') === 'true') {
      if (focus) t.focus();
      return;
    }
    thumbs.forEach((x) => {
      x.setAttribute('aria-current', 'false');
      x.tabIndex = -1;
    });
    t.setAttribute('aria-current', 'true');
    t.tabIndex = 0;
    if (focus) t.focus();

    const back = backLayer();
    const cur = layers[front]!;
    const swap = (): void => {
      back.onload = null;
      back.classList.remove('is-hidden');
      cur.classList.add('is-hidden');
      back.removeAttribute('aria-hidden');
      cur.setAttribute('aria-hidden', 'true');
      front = 1 - front;
    };
    back.onload = null;
    back.sizes = t.dataset.sizes ?? '';
    back.srcset = t.dataset.srcset ?? '';
    back.src = t.dataset.src ?? '';
    back.alt = t.dataset.alt ?? '';
    if (back.complete && back.naturalWidth > 0) swap();
    else back.onload = swap;
    if (caption) caption.textContent = t.dataset.caption ?? '';
  };

  thumbs.forEach((t, i) => {
    t.tabIndex = t.getAttribute('aria-current') === 'true' ? 0 : -1;
    t.addEventListener('click', () => select(i, false));
    t.addEventListener('keydown', (e) => {
      let n: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % thumbs.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + thumbs.length) % thumbs.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End') n = thumbs.length - 1;
      if (n !== null) {
        e.preventDefault();
        select(n, true);
      }
    });
  });
});

export {}; // module scope: keeps these names out of the global script scope
