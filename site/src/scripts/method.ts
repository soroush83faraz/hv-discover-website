/**
 * /fault-location, step 1 (not wired yet; load it from the fault-location page): the
 * visitor moves a fault along a 2,000 m XLPE cable and the TDR trace, reflection time and
 * distance follow. Distance = v/2 × t, with v/2 = 80 m/µs (a typical XLPE value, stated on
 * the page). The slider steps 8 m = 0.1 µs, so the shown time times v/2 gives the shown
 * distance exactly. No animation: it redraws on input only.
 * Markup contract: [data-tdr-lab] with [data-lab-plot], #fault-pos (range), [data-lab-pos],
 * [data-lab-t], [data-lab-d], [data-lab-formula] and radios name="lab-type" (open|short).
 */

const LEN = 2000; // m
const V2 = 80; // m/µs, v/2 for XLPE (typical)
const T_END = LEN / V2; // 25 µs round trip to the far end
const SVGNS = 'http://www.w3.org/2000/svg';
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type FaultType = 'open' | 'short';

// fixed, smoothed noise so the trace looks measured but never jitters between redraws
let seed = 901;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 - 0.5;
}
const NOISE_N = 1001;
const rawN: number[] = [];
for (let i = 0; i < NOISE_N; i++) rawN.push(rnd());
const noise = rawN.map((v, k) => ((rawN[k - 1] ?? 0) + 2 * v + (rawN[k + 1] ?? 0)) / 4);
const noiseAt = (d: number): number => noise[Math.min(NOISE_N - 1, Math.max(0, Math.round((d / LEN) * (NOISE_N - 1))))] ?? 0;

function g(x: number, mu: number, s: number): number {
  const t = (x - mu) / s;
  return Math.exp(-t * t);
}

// signal model, in units of the launch pulse height
function wave(d: number, df: number, type: FaultType): number {
  let y = 0.95 * g(d, 10, 7) - 0.12 * g(d, 34, 12) + 0.03 * g(d, 64, 12); // launch pulse + ringing
  // reflection: starts at the fault, smaller and wider with distance (attenuation, dispersion)
  const u = d - df;
  if (u >= 0) {
    const A = 0.62 * Math.exp(-df / 2600);
    const s = 9 + df / 70;
    y += (type === 'short' ? -1 : 1) * A * (u / s) * Math.exp(1 - u / s);
  }
  y += noiseAt(d) * (u >= 0 ? 0.012 : 0.022);
  return y;
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}
function txt(parent: Element, cls: string, x: number, y: number, s: string, anchor?: string): SVGTextElement {
  const t = el('text', { class: cls, x, y }, parent);
  if (anchor) t.setAttribute('text-anchor', anchor);
  t.textContent = s;
  return t;
}

interface Geo {
  w: number;
  h: number;
  narrow: boolean;
  x0: number;
  xEnd: number;
  cond: number;
  scr: number;
  outY: number;
  backY: number;
  axisY: number;
  top: number;
  bottom: number;
  timeY: number;
  base: number;
  amp: number;
  x: (d: number) => number;
  y: (v: number) => number;
}

interface Els {
  cond: SVGPathElement;
  endLabel: SVGTextElement;
  fault: SVGPathElement;
  faultPt: SVGCircleElement;
  faultLabel: SVGTextElement;
  out: SVGPathElement;
  back: SVGPathElement;
  guide: SVGPathElement;
  trace: SVGPathElement;
  reflLabel: SVGTextElement;
}

function setupLab(root: HTMLElement): void {
  const plot = root.querySelector<HTMLElement>('[data-lab-plot]');
  const range = root.querySelector<HTMLInputElement>('#fault-pos');
  const outPos = root.querySelector('[data-lab-pos]');
  const outT = root.querySelector('[data-lab-t]');
  const outD = root.querySelector('[data-lab-d]');
  const formula = root.querySelector('[data-lab-formula]');
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>("input[name='lab-type']"));
  if (!plot || !range || !outPos || !outT || !outD || !formula) return;

  let geo: Geo | null = null;
  let els: Els | null = null;

  function build(): boolean {
    const w = Math.round(plot!.clientWidth);
    const h = Math.round(plot!.clientHeight);
    if (!w || !h) return false;
    const narrow = w < 520;
    const x0 = 52;
    const xEnd = w - 4;
    const top = 112;
    const bottom = h - 44;
    const base = top + 0.58 * (bottom - top);
    const amp = base - top;
    const gg: Geo = {
      w, h, narrow, x0, xEnd, cond: 22, scr: 38, outY: 52, backY: 60, axisY: 72, top, bottom, timeY: h - 30, base, amp,
      x: (d) => x0 + (d / LEN) * (xEnd - x0),
      y: (v) => base - v * amp,
    };
    geo = gg;

    plot!.innerHTML = '';
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, focusable: 'false' }, plot!);

    // the cable: TDR box, conductor, screen, open far end
    el('rect', { class: 'dg-fill', x: 0, y: gg.cond - 12, width: 44, height: gg.scr - gg.cond + 24, rx: 2 }, svg);
    txt(svg, 'dg-box-text', 22, (gg.cond + gg.scr) / 2 + 5, 'TDR', 'middle');
    const cond = el('path', { class: 'dg-line-2' }, svg);
    el('path', { class: 'dg-grey', d: `M44 ${gg.scr}H${xEnd}` }, svg);
    el('path', { class: 'dg-line', d: `M44 ${gg.cond}H${x0}M44 ${gg.scr}H${x0}` }, svg);
    const endLabel = txt(svg, 'dg-text dg-text--sm', xEnd, 10, 'Cable end', 'end');
    const fault = el('path', { class: 'dg-line-2' }, svg);
    const faultPt = el('circle', { class: 'dg-point', r: 4.5 }, svg);
    const faultLabel = txt(svg, 'dg-hot-text', 0, 10, 'Fault', 'middle');

    // out and back
    const out = el('path', { class: 'dg-line' }, svg);
    const back = el('path', { class: 'dg-grey', 'stroke-dasharray': '5 4' }, svg);

    // distance axis
    el('path', { class: 'dg-thin', d: `M${x0} ${gg.axisY}H${xEnd}` }, svg);
    const dStep = narrow ? 1000 : 500;
    for (let m = 0; m <= LEN; m += 250) {
      const xm = Math.round(gg.x(m)) + 0.5;
      el('path', { class: m % dStep === 0 ? 'dg-grey' : 'dg-thin', d: `M${xm} ${gg.axisY}V${gg.axisY + (m % dStep === 0 ? 6 : 4)}` }, svg);
      if (m % dStep === 0) {
        txt(svg, 'dg-text dg-text--sm', m === LEN ? xEnd : xm, gg.axisY + 22, m === 0 ? '0 m' : fmt0.format(m) + (m === LEN ? ' m' : ''), m === 0 ? 'start' : m === LEN ? 'end' : 'middle');
      }
    }

    // guide from the fault down to its reflection
    const guide = el('path', { class: 'dg-hot-dash' }, svg);

    // trace
    const trace = el('path', { class: 'dg-line-2', 'stroke-width': '1.75' }, svg);
    txt(svg, 'dg-text dg-text--sm', x0 + 14, gg.y(0.95) + 12, 'Launch pulse');
    const reflLabel = txt(svg, 'dg-hot-text', 0, 0, '');

    // time axis
    el('path', { class: 'dg-thin', d: `M${x0} ${gg.timeY}H${xEnd}` }, svg);
    const tStep = narrow ? 10 : 5;
    for (let t = 0; t <= T_END; t += 5) {
      const xt = Math.round(gg.x(t * V2)) + 0.5;
      el('path', { class: t % tStep === 0 ? 'dg-grey' : 'dg-thin', d: `M${xt} ${gg.timeY}V${gg.timeY + 5}` }, svg);
      if (t % tStep === 0 && t < (narrow ? T_END - 5 : T_END)) {
        txt(svg, 'dg-text dg-text--sm', xt, gg.timeY + 22, t === 0 ? '0 µs' : String(t), t === 0 ? 'start' : 'middle');
      }
    }
    txt(svg, 'dg-text dg-text--sm', xEnd, gg.timeY + 22, '25 µs', 'end');

    els = { cond, endLabel, fault, faultPt, faultLabel, out, back, guide, trace, reflLabel };
    return true;
  }

  const type = (): FaultType => (radios.find((r) => r.checked)?.value === 'short' ? 'short' : 'open');

  function draw(): void {
    if (!geo || !els) return;
    const df = Number(range!.value);
    const ft = type();
    const xf = geo.x(df);

    // cable with the fault drawn in
    if (ft === 'open') {
      els.cond.setAttribute('d', `M${geo.x0} ${geo.cond}H${xf - 5}M${xf + 5} ${geo.cond}H${geo.xEnd}`);
      els.fault.setAttribute('d', `M${xf - 5} ${geo.cond - 6}V${geo.cond + 6}M${xf + 5} ${geo.cond - 6}V${geo.cond + 6}`);
      els.faultPt.setAttribute('cx', String(xf));
      els.faultPt.setAttribute('cy', String(geo.cond));
    } else {
      els.cond.setAttribute('d', `M${geo.x0} ${geo.cond}H${geo.xEnd}`);
      els.fault.setAttribute('d', `M${xf} ${geo.cond}V${geo.scr}`);
      els.faultPt.setAttribute('cx', String(xf));
      els.faultPt.setAttribute('cy', String((geo.cond + geo.scr) / 2));
    }
    els.faultLabel.setAttribute('x', String(Math.max(geo.x0 + 16, Math.min(geo.xEnd - 16, xf))));
    els.endLabel.style.display = xf > geo.xEnd - 120 ? 'none' : '';

    // out (solid) and back (dashed) arrows
    const a = 5;
    els.out.setAttribute('d', `M${geo.x0} ${geo.outY}H${xf - 2}M${xf - 2 - a} ${geo.outY - a}L${xf - 2} ${geo.outY}L${xf - 2 - a} ${geo.outY + a}`);
    els.back.setAttribute('d', `M${xf - 2} ${geo.backY}H${geo.x0 + 2}M${geo.x0 + 2 + a} ${geo.backY - a}L${geo.x0 + 2} ${geo.backY}L${geo.x0 + 2 + a} ${geo.backY + a}`);

    // trace
    let d = '';
    for (let px = geo.x0; px <= geo.xEnd; px += 1.5) {
      const dm = ((px - geo.x0) / (geo.xEnd - geo.x0)) * LEN;
      d += (d ? 'L' : 'M') + px.toFixed(1) + ' ' + geo.y(wave(dm, df, ft)).toFixed(1);
    }
    els.trace.setAttribute('d', d);
    els.guide.setAttribute('d', `M${xf} ${geo.scr + 4}V${geo.base}`);

    // reflection time label beside the reflection
    const t = df / V2;
    const A = 0.62 * Math.exp(-df / 2600);
    const peakY = geo.y((ft === 'short' ? -1 : 1) * A);
    const labelRight = xf < geo.xEnd - 90;
    els.reflLabel.textContent = fmt1.format(t) + ' µs';
    els.reflLabel.setAttribute('x', String(labelRight ? xf + 10 : xf - 10));
    els.reflLabel.setAttribute('text-anchor', labelRight ? 'start' : 'end');
    els.reflLabel.setAttribute('y', String(ft === 'short' ? peakY + 18 : peakY - 8));
  }

  let liveTimer: number | undefined;
  function update(announce: boolean): void {
    const df = Number(range!.value);
    const t = df / V2;
    const ft = type();
    const dTxt = fmt0.format(df);
    outPos!.textContent = dTxt + ' m';
    outT!.textContent = fmt1.format(t);
    outD!.textContent = dTxt;
    range!.setAttribute('aria-valuetext', `${dTxt} metres along the cable`);
    draw();
    const text = `${V2} m/µs × ${fmt1.format(t)} µs = `;
    const tail = ` to ${ft === 'open' ? 'an open circuit' : 'a short circuit'}, reflection ${ft === 'open' ? 'upwards' : 'inverted'}.`;
    window.clearTimeout(liveTimer);
    const write = (): void => {
      formula!.textContent = text;
      const b = document.createElement('b');
      b.textContent = dTxt + ' m';
      formula!.appendChild(b);
      formula!.appendChild(document.createTextNode(tail));
    };
    if (announce) write();
    else liveTimer = window.setTimeout(write, 300);
  }

  range.addEventListener('input', () => update(false));
  range.addEventListener('change', () => update(true));
  for (const r of radios) r.addEventListener('change', () => update(true));

  if (!build() || !geo) return;
  update(true);
  let lastW = (geo as Geo).w;
  let lastH = (geo as Geo).h;
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const w = Math.round(plot.clientWidth);
      const h = Math.round(plot.clientHeight);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      build();
      draw();
    }).observe(plot);
  }
}

// Archivo is self-hosted and preloaded; no font wait needed (labels are not measured).
document.querySelectorAll<HTMLElement>('[data-tdr-lab]').forEach(setupLab);

export {}; // module scope: keeps these names out of the global script scope
