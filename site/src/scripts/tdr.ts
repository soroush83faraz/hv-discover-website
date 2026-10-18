/**
 * Hero TDR instrument (TdrInstrument.astro): one of ten modelled low-voltage TDR shots
 * (tdr/scenarios.ts, waveforms from tdr/synth.ts), a load sequence (design spec 6.1) and an
 * operable cursor with an info card that explains the echo under it (spec 6.2).
 *
 * - Scenario: ?trace=N (1–10) forces one; otherwise random, never the previous visit's
 *   (localStorage `hvd-hero-last`; plain random when storage fails). "Show another trace"
 *   picks a different one and replays the shot.
 * - The scenario's text is set at load; the trace itself (synthesis, SVG, the first layout read) is
 *   built when the panel comes within half a screen of the viewport, or at once when the visitor
 *   reaches it first (focus, pointer, "Show another trace"). The instrument sits below the first
 *   screen on Home, so none of that work competes with the page load.
 * - The shot plays when the trace scrolls into view (IntersectionObserver); with reduced motion
 *   the final frame shows at once.
 * - Pointer, touch drag and keys (arrows, Shift+arrows, PageUp/PageDown, Home/End) move the cursor;
 *   it snaps to events within 10 px. The card follows the cursor (beside the event, never on it);
 *   below 600 px it docks above the trace so the finger does not cover it.
 */
import { COPY, SCENARIOS, fill, inSentence, type EventDef, type Scenario, type ZoneDef } from './tdr/scenarios';
import { NEG, SAMPLES, V2, extentAt, pulseM, synth, valueAt } from './tdr/synth';

const SVGNS = 'http://www.w3.org/2000/svg';
const STORE_KEY = 'hvd-hero-last';
const T_AXIS = 600;
const T_TRAVEL = 1200;
const T_SHOT = 1000; // each of the two shots in an arc reflection scenario
const T_TAIL = 800;
const SNAP_PX = 10;
const CARD_GAP = 14;

/** "1284.6" → "1,284.6" (en-GB grouping), d decimals. Plain code: Intl formatters are slow to create. */
function fmt(n: number, d: number): string {
  const [i, f] = n.toFixed(d).split('.');
  return i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
}
const total = SCENARIOS.length;

/* ---------------------------------------------------------- scenario choice */
function randomExcept(last: number): number {
  if (last < 0 || last >= total) return Math.floor(Math.random() * total);
  let i = Math.floor(Math.random() * (total - 1));
  if (i >= last) i++;
  return i;
}

function firstIndex(): number {
  const q = new URLSearchParams(window.location.search).get('trace');
  if (q && /^\d{1,2}$/.test(q)) {
    const n = Number(q);
    if (n >= 1 && n <= total) return n - 1;
  }
  let last = -1;
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    if (v && /^\d{1,2}$/.test(v)) last = Number(v);
  } catch {
    /* storage blocked: plain random */
  }
  return randomExcept(last);
}

function remember(i: number): void {
  try {
    window.localStorage.setItem(STORE_KEY, String(i));
  } catch {
    /* storage blocked */
  }
}

/* ---------------------------------------------------------- the model of one shot */
interface Ev extends EventDef {
  ext: number;
  launch?: boolean;
}

interface Phase {
  traces: number[];
  to: number;
  label: string;
  hot: number;
  start: number;
  end: number;
}

interface Model {
  sc: Scenario;
  index: number;
  traces: Float32Array[];
  events: Ev[];
  zones: ZoneDef[];
  dz: number;
  hot: number;
  phases: Phase[];
  lock: number;
  end: number;
}

function makeModel(index: number): Model {
  const sc = SCENARIOS[index]!;
  const dz = pulseM(sc);
  const traces = sc.traces.map((t) => synth(sc, t, 4099 + index * 7919));
  const widenOf = (at: number): number => {
    let w = 1;
    for (const t of sc.traces) for (const e of t.echoes) if (e.at === at && e.widen) w = Math.max(w, e.widen);
    return w;
  };
  const events: Ev[] = [
    { ...COPY.launch, ext: 0, launch: true },
    ...sc.events.map((e) => ({ ...e, ext: extentAt(sc, e.at, widenOf(e.at)) })),
  ];
  const vars = { dz: fmt(dz, 0), ns: sc.pulseNs };
  const zones: ZoneDef[] = [
    ...(sc.zones ?? []),
    { from: 0, to: dz, name: COPY.deadZone.name, seeing: fill(COPY.deadZone.seeing, vars), next: COPY.deadZone.next },
  ];
  if (sc.end != null) zones.push({ from: sc.end + extentAt(sc, sc.end), to: sc.range, seeing: COPY.pastEndZone.seeing });

  const hot = sc.hot ?? 0;
  const raw: Omit<Phase, 'start' | 'end'>[] =
    sc.traces[0]?.style === 'lv'
      ? [
          { traces: [0], to: sc.range, label: COPY.lvShot, hot: 0 },
          { traces: [1], to: sc.main, label: COPY.arcShot, hot: 1 },
        ]
      : [{ traces: sc.traces.map((_, i) => i), to: sc.main, label: COPY.pulseAt, hot }];
  const ms = raw.length > 1 ? T_SHOT : T_TRAVEL;
  let t = T_AXIS;
  const phases = raw.map((p) => {
    const ph = { ...p, start: t, end: t + ms };
    t += ms;
    return ph;
  });
  return { sc, index, traces, events, zones, dz, hot, phases, lock: t, end: t + T_TAIL };
}

/* ---------------------------------------------------------- svg helpers */
function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}

const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface Geo {
  w: number;
  h: number;
  padT: number;
  axisY: number;
  base: number;
  amp: number;
  x: (dm: number) => number;
  y: (v: number) => number;
  d: (px: number) => number;
}

interface Els {
  cable: SVGLineElement;
  ticks: { node: SVGElement; x: number }[];
  clips: SVGRectElement[];
  paths: string[];
  hot: SVGPathElement;
  hotClip: SVGRectElement;
  dot: SVGCircleElement;
  ring: SVGCircleElement | null;
  marker: SVGGElement;
  tags: { node: SVGElement; at: number }[];
  legends: SVGElement[];
  cursor: SVGGElement;
  cLine: SVGLineElement;
  cDot: SVGCircleElement;
  /** Horizontal extent [left, right] in px of each event's tag or marker label, by distance. */
  boxes: Map<number, [number, number]>;
  drawn: number;
  tagOn: boolean[];
}

/** Width of a text in the instrument's face, measured on a canvas (no layout). */
let measureCtx: CanvasRenderingContext2D | null = null;
// the face from tokens.css (--font); reading it with getComputedStyle would force a style pass
const family = '"Archivo Variable", Archivo, "Helvetica Neue", Arial, sans-serif';
const widths = new Map<string, number>();
function textW(text: string | null, weight: number, size: number): number {
  text ??= '';
  const font = `${weight} ${size}px ${family}`;
  const key = font + '|' + text;
  let v = widths.get(key);
  if (v === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return text.length * size * 0.55;
    if (measureCtx.font !== font) measureCtx.font = font; // setting the font is the costly part
    v = measureCtx.measureText(text).width;
    widths.set(key, v);
  }
  return v;
}

/** SVG path of a trace; on narrow plots each pixel column keeps its min and max, so no echo is lost. */
function pathOf(s: Float32Array, g: Geo, range: number): string {
  const step = Math.floor(SAMPLES / g.w);
  let out = '';
  if (step < 2) {
    for (let i = 0; i <= SAMPLES; i++) out += (i ? 'L' : 'M') + g.x((i / SAMPLES) * range).toFixed(1) + ' ' + g.y(s[i]!).toFixed(1);
    return out;
  }
  for (let i = 0; i <= SAMPLES; i += step) {
    let lo = i;
    let hi = i;
    for (let j = i; j < Math.min(SAMPLES + 1, i + step); j++) {
      if (s[j]! < s[lo]!) lo = j;
      if (s[j]! > s[hi]!) hi = j;
    }
    for (const j of lo < hi ? [lo, hi] : [hi, lo]) out += (out ? 'L' : 'M') + g.x((j / SAMPLES) * range).toFixed(1) + ' ' + g.y(s[j]!).toFixed(1);
  }
  return out;
}

/* ---------------------------------------------------------- the instrument */
function setupInstrument(root: HTMLElement): void {
  const q = <T extends Element>(s: string): T | null => root.querySelector<T>(s);
  const plot = q<HTMLElement>('.tdr__plot');
  const rLabel = q('[data-readout-label]');
  const rValue = q('[data-readout-value]');
  const rSr = q('[data-readout-sr]');
  const count = q('[data-count]');
  const teach = q('[data-teach]');
  const live = q('[data-live]');
  const nextBtn = q<HTMLButtonElement>('[data-next]');
  const card = q<HTMLElement>('[data-card]');
  const cDist = q('[data-c-dist]');
  const cTime = q('[data-c-time]');
  const cName = q<HTMLElement>('[data-c-name]');
  const cCoef = q<HTMLElement>('[data-c-coef]');
  const cSeeing = q<HTMLElement>('[data-c-seeing]');
  const cNext = q<HTMLElement>('[data-c-next]');
  const cNextText = q('[data-c-next] span');
  const cRel = q<HTMLElement>('[data-c-rel]');
  if (!plot || !rLabel || !rValue || !rSr || !count || !teach || !live || !nextBtn || !card) return;
  if (!cDist || !cTime || !cName || !cCoef || !cSeeing || !cNext || !cNextText || !cRel) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let m: Model = makeModel(firstIndex());
  let geo: Geo | null = null;
  let els: Els | null = null;
  const state = { t: 0, done: false, locked: false, cursor: null as number | null, gen: 0 };

  /* -------------------------------------------------------- text outside the plot */
  function applyText(): void {
    const { sc, index } = m;
    const vars = { n: index + 1, total, title: inSentence(sc.title) };
    count!.textContent = fill(COPY.count, vars);
    teach!.textContent = sc.teach;
    const lead = /\b(at|from)$/.test(sc.label) ? sc.label : sc.label + ' at';
    rSr!.textContent = `${fill(COPY.count, vars)}. ${lead} ${fmt(sc.main, 1)} ${COPY.metres}.`;
    setReadout(sc.label, sc.main);
    plot!.setAttribute('aria-valuemax', String(sc.range));
    plot!.setAttribute('aria-valuenow', '0');
    plot!.setAttribute('aria-valuetext', `${fmt(0, 1)} ${COPY.metres}, ${COPY.launch.name.toLowerCase()}`);
    plot!.dataset.mainEvent = String(sc.main);
  }

  function setReadout(label: string, dm: number): void {
    if (rLabel!.textContent !== label) rLabel!.textContent = label;
    rValue!.textContent = fmt(dm, 1);
  }

  /* -------------------------------------------------------- geometry + drawing */
  function build(): boolean {
    const w = Math.round(plot!.clientWidth);
    const h = Math.round(plot!.clientHeight);
    if (!w || !h) return false;
    const { sc, traces, events } = m;
    const range = sc.range;
    const padT = 48;
    const axisY = h - 38;
    const amp = (axisY - 8 - padT) / (1 + NEG);
    const base = padT + amp;
    const g: Geo = {
      w,
      h,
      padT,
      axisY,
      base,
      amp,
      x: (dm) => 0.5 + (dm / range) * (w - 1),
      y: (v) => base - v * amp,
      d: (px) => clamp(((px - 0.5) / (w - 1)) * range, 0, range),
    };
    geo = g;

    // Built detached and inserted once; text is measured on a canvas, so building forces no layout.
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, 'aria-hidden': 'true', focusable: 'false' });
    const defs = el('defs', {}, svg);
    const uid = 'tdr' + Math.random().toString(36).slice(2, 7);
    const clipRect = (id: string): SVGRectElement => {
      const cp = el('clipPath', { id }, defs);
      return el('rect', { x: -4, y: -20, width: 0, height: h + 40 }, cp);
    };

    // dead zone band (only where the scenario teaches it)
    if (sc.band) {
      el('rect', { class: 'tdr-band', x: g.x(0), y: padT - 2, width: g.x(m.dz) - g.x(0), height: axisY - padT + 2 }, svg);
      const bt = el('text', { class: 'tdr-note', x: g.x(0), y: padT - 10 }, svg);
      bt.textContent = COPY.deadZone.name;
    }

    // zero line: the reference for positive and negative echoes
    el('line', { class: 'tdr-zero', x1: 0, x2: w, y1: Math.round(base) + 0.5, y2: Math.round(base) + 0.5 }, svg);

    // the cable / distance axis
    const axis = el('g', { class: 'tdr-axis' }, svg);
    const cable = el('line', { class: 'tdr-cable', x1: 0, x2: w, y1: axisY + 0.5, y2: axisY + 0.5 }, axis);
    cable.style.strokeDasharray = String(w);
    const maxLabels = w >= 900 ? 10 : w >= 600 ? 8 : 5;
    const major = [50, 100, 200, 250, 500, 1000].find((c) => range % c === 0 && range / c <= maxLabels) ?? range;
    const minor = major / 5;
    const ticks: Els['ticks'] = [];
    const labels: SVGTextElement[] = [];
    for (let i = 0; i * minor <= range; i++) {
      const mm = i * minor;
      const isMajor = i % 5 === 0;
      const x = Math.round(g.x(mm)) + 0.5;
      const tick = el('line', { class: 'tdr-tick' + (isMajor ? '' : ' tdr-tick--minor'), x1: x, x2: x, y1: axisY + 1, y2: axisY + (isMajor ? 9 : 5) }, axis);
      ticks.push({ node: tick, x });
      if (isMajor) {
        const first = mm === 0;
        const last = mm === range;
        const t = el('text', { class: 'tdr-label', x: first ? 0 : last ? w : x, y: axisY + 27, 'text-anchor': first ? 'start' : last ? 'end' : 'middle' }, axis);
        t.textContent = first ? '0 m' : last ? fmt(mm, 0) + ' m' : fmt(mm, 0);
        ticks.push({ node: t, x });
        labels.push(t);
      }
    }
    // a label that would touch its neighbour (or the end label) is left out
    const box = (t: SVGTextElement): [number, number] => {
      const lw = textW(t.textContent, 400, 13);
      const lx = Number(t.getAttribute('x'));
      const a = t.getAttribute('text-anchor');
      return a === 'start' ? [lx, lx + lw] : a === 'end' ? [lx - lw, lx] : [lx - lw / 2, lx + lw / 2];
    };
    const endBox = box(labels[labels.length - 1]!);
    let prevRight = -Infinity;
    labels.forEach((t, i) => {
      const [l, r] = box(t);
      const last = i === labels.length - 1;
      if (!last && (l < prevRight + 12 || r > endBox[0] - 14)) t.classList.add('is-hidden');
      else prevRight = r;
    });

    // traces
    const paths = traces.map((s) => pathOf(s, g, range));
    const clips: SVGRectElement[] = [];
    // draw the secondary trace (lv / ghost) underneath the signal trace
    const order = traces.map((_, i) => i).sort((a, b) => (sc.traces[a]?.style ? 0 : 1) - (sc.traces[b]?.style ? 0 : 1));
    for (const i of order) {
      const style = sc.traces[i]?.style;
      const rect = clipRect(`${uid}r${i}`);
      clips[i] = rect;
      el('path', { class: 'tdr-wave' + (style ? ` tdr-wave--${style}` : ''), d: paths[i]!, 'clip-path': `url(#${uid}r${i})` }, svg);
    }
    const hotClip = clipRect(uid + 'h');
    const hot = el('path', { class: 'tdr-wave tdr-wave--hot', d: paths[m.hot]!, 'clip-path': `url(#${uid}h)` }, svg);

    // launch tag
    const tags: Els['tags'] = [];
    const launch = el('text', { class: 'tdr-note', x: g.x(m.dz) + 8, y: g.y(0.95) + 10 }, svg);
    launch.textContent = COPY.launch.name;
    tags.push({ node: launch, at: 0 });

    // secondary events: graphite tag and tick above the echo
    const peakNear = (from: number, to: number): number => {
      let best = 0;
      for (const s of traces) {
        for (let dm = from; dm <= to; dm += range / SAMPLES) best = Math.max(best, valueAt(sc, s, dm));
      }
      return best;
    };
    const boxes = new Map<number, [number, number]>();
    let lastRight = -Infinity;
    for (const e of events) {
      if (e.launch || e.at === sc.main || e.tag === '') continue;
      const xe = g.x(e.at);
      const top = Math.min(g.y(peakNear(e.at, e.at + e.ext)), base) - 10;
      const grp = el('g', { class: 'tdr-evt' }, svg);
      el('line', { x1: xe, x2: xe, y1: top - 2, y2: g.y(valueAt(sc, traces[0]!, e.at)) - 4 }, grp);
      const tt = el('text', { x: xe, y: top - 8, 'text-anchor': 'middle' }, grp);
      tt.textContent = e.tag ?? e.name;
      const tw = textW(tt.textContent, 400, 13);
      let tx = clamp(xe, tw / 2 + 2, w - tw / 2 - 2);
      if (tx - tw / 2 < lastRight + 8) tx = lastRight + 8 + tw / 2; // nudge right of the previous tag
      if (tx + tw / 2 > w) grp.classList.add('is-hidden');
      tt.setAttribute('x', String(tx));
      lastRight = tx + tw / 2;
      boxes.set(e.at, [tx - tw / 2, tx + tw / 2]);
      tags.push({ node: grp, at: e.at });
    }

    // legends for two-trace scenarios
    const legends: SVGElement[] = [];
    sc.traces.forEach((t, i) => {
      if (!t.legend) return;
      const s = traces[i]!;
      const ev = events.find((e) => e.at === t.legend!.at);
      const span = ev ? ev.ext : extentAt(sc, t.legend.at);
      let extD = t.legend.at;
      let extV = 0;
      for (let dm = t.legend.at; dm <= t.legend.at + span; dm += range / SAMPLES) {
        const v = valueAt(sc, s, dm);
        if (Math.abs(v) > Math.abs(extV)) {
          extV = v;
          extD = dm;
        }
      }
      // beside the peak or the dip; when that runs off the plot, above (below) it against the right edge
      const lx = g.x(extD) + 10;
      const ly = g.y(extV) + (extV >= 0 ? 4 : -4); // beside a dip: kept clear of the distance axis
      const lt = el('text', { class: 'tdr-legend' + (t.style ? ` tdr-legend--${t.style}` : '') + (state.done ? ' is-shown' : ''), x: lx, y: ly }, svg);
      lt.textContent = t.legend.text;
      if (lx + textW(t.legend.text, t.style ? 400 : 600, 13) > w - 2) {
        lt.setAttribute('text-anchor', 'end');
        lt.setAttribute('x', String(w - 2));
        lt.setAttribute('y', String(extV >= 0 ? g.y(extV) - 10 : g.y(extV) - 6));
      }
      legends.push(lt);
    });

    // main marker: orange for a fault, graphite otherwise
    const mainEv = events.find((e) => e.at === sc.main && !e.launch)!;
    const xm = g.x(sc.main);
    // on a rebuild of a settled shot (resize) the marker and legends are drawn in place, not animated again
    const settled = state.done || state.locked;
    const marker = el('g', { class: 'tdr-marker' + (sc.fault ? '' : ' is-quiet') + (settled ? ' is-dropped' : '') }, svg);
    el('line', { x1: xm, x2: xm, y1: padT - 2, y2: axisY }, marker);
    el('path', { d: `M${xm - 6} ${padT - 10}h12l-6 8z` }, marker);
    const mt = el('text', { x: xm + 12, y: padT - 26 }, marker);
    mt.textContent = fmt(sc.main, 1) + ' m';
    const ms = el('text', { class: 'tdr-marker__sub', x: xm + 12, y: padT - 10 }, marker);
    ms.textContent = mainEv.name;
    const lw = Math.max(textW(mt.textContent, 650, 15), textW(ms.textContent, 400, 13));
    if (xm + 12 + lw > w - 2) {
      for (const t of [mt, ms]) {
        t.setAttribute('text-anchor', 'end');
        t.setAttribute('x', String(xm - 12));
      }
    }
    boxes.set(sc.main, xm + 12 + lw > w - 2 ? [xm - 12 - lw, xm] : [xm, xm + 12 + lw]);

    // pulse dot and the brand ring (fault only)
    const dot = el('circle', { class: 'tdr-dot', r: 5, cx: 0, cy: base }, svg);
    dot.style.opacity = '0';
    let ring: SVGCircleElement | null = null;
    if (sc.fault) {
      let pk = sc.main;
      let pv = 0;
      const s = traces[m.hot]!;
      for (let dm = sc.main; dm <= sc.main + mainEv.ext; dm += range / SAMPLES) {
        const v = valueAt(sc, s, dm);
        if (Math.abs(v) > Math.abs(pv)) {
          pv = v;
          pk = dm;
        }
      }
      ring = el('circle', { class: 'tdr-ring', cx: g.x(pk), cy: g.y(pv), r: 8 }, svg);
    }

    // cursor
    const cursor = el('g', { class: 'tdr-cursor' }, svg);
    const cLine = el('line', { x1: 0, x2: 0, y1: padT - 2, y2: axisY }, cursor);
    const cDot = el('circle', { r: 4.5, cx: 0, cy: base }, cursor);
    cursor.style.display = 'none';

    plot!.replaceChildren(svg);
    els = { cable, ticks, clips, paths, hot, hotClip, dot, ring, marker, tags, legends, cursor, cLine, cDot, boxes, drawn: -1, tagOn: [] };
    return true;
  }

  /* -------------------------------------------------------- frames */
  function revealDist(i: number, t: number): number {
    let r = 0;
    for (const p of m.phases) {
      if (!p.traces.includes(i)) continue;
      if (t >= p.end) r = Math.max(r, p.to);
      else if (t > p.start) r = Math.max(r, ((t - p.start) / (p.end - p.start)) * p.to);
    }
    if (t >= m.lock) r += easeOut(Math.min(1, (t - m.lock) / T_TAIL)) * (m.sc.range - r);
    return r;
  }

  function frame(t: number): void {
    if (!geo || !els) return;
    const { sc } = m;
    const w = geo.w;
    // 0–0.6 s: the cable line draws left to right with its ticks
    const drawn = easeOut(Math.min(1, t / T_AXIS)) * w;
    // only touch the DOM where something changed: most frames move just the pulse and two clips
    if (drawn !== els.drawn) {
      els.drawn = drawn;
      els.cable.style.strokeDashoffset = String(w - drawn);
      for (const tick of els.ticks) tick.node.style.opacity = tick.x <= drawn + 1 ? '1' : '0';
    }

    let maxReveal = 0;
    els.clips.forEach((c, i) => {
      const r = revealDist(i, t);
      maxReveal = Math.max(maxReveal, r);
      c.setAttribute('width', r > 0 ? String(geo!.x(r) + 4) : '0');
    });
    els.tags.forEach((tag, i) => {
      const on = t >= T_AXIS && maxReveal >= tag.at;
      if (els!.tagOn[i] !== on) {
        els!.tagOn[i] = on;
        tag.node.style.opacity = on ? '' : '0';
      }
    });
    for (const lg of els.legends) lg.classList.toggle('is-shown', t >= m.lock + T_TAIL * 0.5);

    const ph = m.phases.find((p) => t >= p.start && t < p.end);
    if (ph) {
      // the pulse travels at constant speed; the readout counts in sync
      const dm = ((t - ph.start) / (ph.end - ph.start)) * ph.to;
      const x = geo.x(dm);
      const s = m.traces[ph.traces[ph.traces.length - 1]!]!;
      els.dot.setAttribute('cx', String(x));
      els.dot.setAttribute('cy', String(geo.y(valueAt(sc, s, dm))));
      els.dot.style.opacity = '1';
      els.hot.setAttribute('d', els.paths[ph.hot]!);
      els.hotClip.setAttribute('x', String(x - 34));
      els.hotClip.setAttribute('width', '34');
      setReadout(ph.label, dm);
      return;
    }
    els.dot.style.opacity = '0';
    if (t < m.lock) {
      els.hotClip.setAttribute('width', '0');
      setReadout(m.phases[0]!.label, 0);
      return;
    }
    // the echo arrives: the marker drops, the readout locks
    if (!state.locked) {
      state.locked = true;
      els.marker.classList.add('is-dropped');
      if (!reduceMotion && !state.done) els.ring?.classList.add('is-pulsing');
      setReadout(sc.label, sc.main);
    }
    els.hot.setAttribute('d', els.paths[m.hot]!);
    if (sc.fault) {
      const mainEv = m.events.find((e) => e.at === sc.main && !e.launch)!;
      const xf = geo.x(sc.main);
      els.hotClip.setAttribute('x', String(xf - 1));
      els.hotClip.setAttribute('width', String(geo.x(sc.main + mainEv.ext) - xf + 1));
    } else {
      els.hotClip.setAttribute('width', '0');
    }
  }

  function finalFrame(): void {
    state.gen++;
    state.done = true;
    state.locked = false;
    frame(m.end);
    els?.ring?.classList.remove('is-pulsing');
    if (state.cursor != null) setCursor(state.cursor, false, false, cardShown);
  }

  function run(): void {
    if (reduceMotion) {
      finalFrame();
      return;
    }
    const my = ++state.gen;
    state.done = false;
    state.locked = false;
    let start: number | null = null;
    const step = (now: number): void => {
      if (my !== state.gen) return;
      if (start === null) start = now;
      state.t = now - start;
      frame(state.t);
      if (state.t < m.end) requestAnimationFrame(step);
      else state.done = true;
    };
    requestAnimationFrame(step);
  }

  /* -------------------------------------------------------- cursor + info card (spec 6.2) */
  interface Spot {
    dm: number;
    ev: Ev | null;
    on: boolean;
    zone: ZoneDef | null;
  }

  /** Keys move exactly (they stop on events by themselves), the pointer snaps within SNAP_PX. */
  function locate(dmIn: number, snap: boolean): Spot {
    const { sc, events, zones } = m;
    const tolM = snap ? (SNAP_PX / (geo!.w - 1)) * sc.range : 0.05;
    let best: Ev | null = null;
    let bestD = Infinity;
    for (const e of events) {
      const tol = e.launch && snap ? Math.min(tolM, m.dz / 3) : tolM;
      const dd = Math.abs(dmIn - e.at);
      if (dd <= tol && dd < bestD) {
        best = e;
        bestD = dd;
      }
    }
    if (best) return { dm: best.at, ev: best, on: true, zone: null };
    const dm = clamp(dmIn, 0, sc.range);
    let hump: Ev | null = null;
    for (const e of events) if (!e.launch && dm > e.at && dm <= e.at + e.ext && (!hump || e.at > hump.at)) hump = e;
    if (hump) return { dm, ev: hump, on: false, zone: null };
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i]!;
      if (dm >= z.from && dm <= z.to) return { dm, ev: null, on: false, zone: z };
    }
    return { dm, ev: null, on: false, zone: null };
  }

  function relations(sp: Spot): string[] {
    const { sc } = m;
    const out: string[] = [];
    if (sc.fault) {
      const d = sc.main - sp.dm;
      if (sp.on && sp.ev?.at === sc.main) out.push(COPY.onFault);
      else out.push(fill(d > 0 ? COPY.beforeFault : COPY.pastFault, { d: fmt(Math.abs(d), 1) }));
    }
    if (sc.end != null && !(sp.on && sp.ev?.at === sc.end)) {
      const d = sc.end - sp.dm;
      out.push(fill(d >= 0 ? COPY.toEnd : COPY.pastEnd, { d: fmt(Math.abs(d), 1), end: sc.endName ?? COPY.cableEnd }));
    }
    return out;
  }

  const setLine = (node: HTMLElement, text: string): void => {
    node.textContent = text;
    node.hidden = !text;
  };

  let announceTimer: number | undefined;
  let cardShown = false;

  function hideCard(): void {
    card!.hidden = true;
    cardShown = false;
  }

  function setCursor(dmIn: number, announce: boolean, snap = true, showCard = true): void {
    if (!geo || !els) return;
    if (!state.done) finalFrame(); // the visitor takes over: jump to the rested state
    const { sc } = m;
    const sp = locate(dmIn, snap);
    const dm = sp.dm;
    state.cursor = dm;
    const atFault = sp.on && sc.fault && sp.ev?.at === sc.main;

    // cursor line and dot (on the trace that moves most here)
    const x = geo.x(dm);
    let v = 0;
    for (const s of m.traces) {
      const vi = valueAt(sc, s, dm);
      if (Math.abs(vi) > Math.abs(v)) v = vi;
    }
    els.cursor.style.display = '';
    els.cursor.classList.toggle('is-at-fault', atFault);
    els.cLine.setAttribute('x1', String(x));
    els.cLine.setAttribute('x2', String(x));
    els.cDot.setAttribute('cx', String(x));
    els.cDot.setAttribute('cy', String(geo.y(v)));

    // card text
    const ev = sp.ev;
    const z = sp.zone;
    const name = ev ? ev.name : z?.name ?? '';
    const seeing = ev ? (sp.on || ev.launch ? ev.seeing : COPY.measureTip) : z ? z.seeing : COPY.clean;
    const next = ev ? ev.next : z?.next ?? '';
    const coef = ev ? ev.coef ?? '' : z?.coef ?? '';
    const rel = relations(sp);
    const dist = fmt(dm, 1) + ' m';
    const time = fill(COPY.roundTrip, { t: fmt(dm / V2, 2) });
    cDist!.textContent = dist;
    cTime!.textContent = time;
    setLine(cName!, name);
    cName!.classList.toggle('is-fault', !!ev && sc.fault && ev.at === sc.main);
    setLine(cCoef!, coef);
    setLine(cSeeing!, seeing);
    cNextText!.textContent = next;
    cNext!.hidden = !next;
    cRel!.textContent = '';
    rel.forEach((r) => {
      const s = document.createElement('span');
      s.textContent = r;
      cRel!.appendChild(s);
    });
    cRel!.hidden = !rel.length;
    if (showCard) {
      card!.hidden = false;
      cardShown = true;
      placeCard(sp);
    }

    // slider semantics and the polite announcement
    const spoken = name || (z ? z.seeing : COPY.clean).replace(/\.$/, '');
    plot!.setAttribute('aria-valuenow', dm.toFixed(1));
    plot!.setAttribute('aria-valuetext', `${dist.replace(' m', ' ' + COPY.metres)}, ${spoken}`);
    if (announce) {
      const text = [
        `${fmt(dm, 1)} ${COPY.metres}, ${fmt(dm / V2, 2)} ${COPY.microseconds}`,
        name,
        coef,
        seeing,
        next ? `${COPY.next} ${next}` : '',
        ...rel,
      ]
        .filter(Boolean)
        .map((s) => s.replace(/[.:]$/, ''))
        .join('. ');
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => {
        live!.textContent = text + '.';
      }, 400);
    }
  }

  /** Beside the cursor, on the side away from the nearest event; docked above the trace on phones. */
  function placeCard(sp: Spot): void {
    if (!geo) return;
    const stageTop = plot!.offsetTop;
    if (root.clientWidth < 600) {
      // phones: full width above the trace, clear of the finger; when the sticky header would
      // cover it there, below the trace instead (the card stays after the finger lifts)
      card!.classList.add('is-docked');
      card!.style.left = '0px';
      const header = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      const room = plot!.getBoundingClientRect().top - Math.max(0, header);
      if (room >= card!.offsetHeight + 8) {
        card!.style.top = 'auto';
        card!.style.bottom = `${root.clientHeight - stageTop + 4}px`;
      } else {
        card!.style.bottom = 'auto';
        card!.style.top = `${stageTop + plot!.offsetHeight + 4}px`;
      }
      return;
    }
    card!.classList.remove('is-docked');
    card!.style.bottom = 'auto';
    const cw = card!.offsetWidth;
    const w = geo.w;
    let left: number;
    let right: number;
    let preferLeft: boolean;
    if (sp.ev) {
      // the event = its echo plus its tag or marker label: the card stays clear of all of it
      const box = els?.boxes.get(sp.ev.at);
      left = Math.min(geo.x(sp.ev.at), box ? box[0] : Infinity);
      right = Math.max(geo.x(sp.ev.at + (sp.ev.launch ? m.dz : sp.ev.ext)), box ? box[1] : -Infinity);
      preferLeft = !sp.ev.launch;
    } else {
      left = right = geo.x(sp.dm);
      let near: Ev | null = null;
      for (const e of m.events) if (!near || Math.abs(e.at - sp.dm) < Math.abs(near.at - sp.dm)) near = e;
      preferLeft = !!near && near.at > sp.dm;
    }
    const lx = left - CARD_GAP - cw;
    const rx = right + CARD_GAP;
    let cx: number;
    if (preferLeft) cx = lx >= 0 ? lx : rx + cw <= w ? rx : 0;
    else cx = rx + cw <= w ? rx : lx >= 0 ? lx : w - cw;
    card!.style.left = `${plot!.offsetLeft + cx}px`;
    card!.style.top = `${stageTop}px`;
  }

  const pxFromEvent = (e: PointerEvent): number => e.clientX - plot.getBoundingClientRect().left;

  let dragging = false;
  plot.addEventListener('pointerdown', (e) => {
    ensure();
    if (!geo) return;
    dragging = true;
    try {
      plot.setPointerCapture(e.pointerId);
    } catch {
      /* no capturable pointer */
    }
    setCursor(geo.d(pxFromEvent(e)), false);
  });
  plot.addEventListener('pointermove', (e) => {
    if (geo && (e.pointerType === 'mouse' || dragging)) setCursor(geo.d(pxFromEvent(e)), false);
  });
  plot.addEventListener('pointerup', () => {
    if (dragging && state.cursor != null) setCursor(state.cursor, true);
    dragging = false;
  });
  plot.addEventListener('pointercancel', () => {
    dragging = false;
  });
  plot.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && document.activeElement !== plot) hideCard();
  });
  plot.addEventListener('blur', hideCard);
  // a tap elsewhere puts the card away (touch keeps it after the finger lifts)
  document.addEventListener('pointerdown', (e) => {
    if (cardShown && !root.contains(e.target as Node)) hideCard();
  });

  plot.addEventListener('keydown', (e) => {
    const range = m.sc.range;
    const cur = state.cursor ?? 0;
    const small = range / 400;
    const big = e.shiftKey ? range / 40 : small;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = cur + big;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = cur - big;
        break;
      case 'PageUp':
        next = cur + range / 8;
        break;
      case 'PageDown':
        next = cur - range / 8;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = range;
        break;
      default:
        return;
    }
    e.preventDefault();
    next = clamp(next, 0, range);
    // stepping across an event stops on it once, like an instrument cursor
    if (e.key !== 'Home' && e.key !== 'End') {
      const crossed = m.events
        .filter((ev) => (cur < ev.at && next > ev.at) || (cur > ev.at && next < ev.at))
        .sort((a, b) => Math.abs(a.at - cur) - Math.abs(b.at - cur))[0];
      if (crossed) next = crossed.at;
    }
    setCursor(next, true, false);
  });

  /* -------------------------------------------------------- scenario switch */
  function show(index: number, animate: boolean): void {
    m = makeModel(index);
    remember(index);
    state.cursor = null;
    hideCard();
    applyText();
    state.gen++;
    state.done = false;
    state.locked = false;
    state.t = 0;
    if (!build()) return;
    if (animate) run();
    else finalFrame();
  }

  nextBtn.addEventListener('click', () => {
    ensure();
    const i = randomExcept(m.index);
    show(i, !reduceMotion);
    window.clearTimeout(announceTimer);
    live!.textContent = fill(COPY.showing, { n: i + 1, total, title: inSentence(SCENARIOS[i]!.title) });
  });

  /* -------------------------------------------------------- start + resize */
  let built = false;
  function init(): void {
    if (built) return;
    built = true;
    if (!build() || !geo) return;
    // Play the shot when the visitor can see it (on phones the trace sits below the fold).
    if (!reduceMotion && 'IntersectionObserver' in window) {
      frame(0);
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) {
            io.disconnect();
            if (!state.done && state.gen === 0) run();
          }
        },
        { threshold: 0.6 },
      );
      io.observe(plot!);
    } else {
      run();
    }
    let lastW = geo.w;
    let lastH = geo.h;
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        const w = Math.round(plot!.clientWidth);
        const h = Math.round(plot!.clientHeight);
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        const wasLocked = state.locked;
        build();
        if (state.done || reduceMotion) finalFrame();
        else {
          state.locked = false;
          frame(state.t);
          if (wasLocked) els?.marker.classList.add('is-dropped');
        }
      }).observe(plot!);
    }
  }

  // Archivo is self-hosted and preloaded, so it is normally ready by now. The short race
  // only keeps the first frame from being measured against the fallback face.
  let started = false;
  const go = (): void => {
    if (started) return;
    started = true;
    remember(m.index);
    applyText();
    if (!('IntersectionObserver' in window)) {
      init();
      return;
    }
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          near.disconnect();
          init();
        }
      },
      { rootMargin: '50% 0px' },
    );
    near.observe(root);
  };
  /** The visitor got to the instrument before it came near the viewport: build it now. */
  function ensure(): void {
    go();
    init();
  }
  plot.addEventListener('focus', ensure);
  if (document.fonts?.status === 'loaded') go();
  else {
    document.fonts?.ready.then(go);
    window.setTimeout(go, 300);
  }
}

document.querySelectorAll<HTMLElement>('[data-tdr]').forEach(setupInstrument);

export {}; // module scope: keeps these names out of the global script scope
