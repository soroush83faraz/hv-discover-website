/**
 * Hero TDR scenarios (TdrInstrument.astro, src/scripts/tdr.ts). Ten plausible low-voltage TDR
 * shots, one shown per visit. ALL visitor-facing copy of the instrument lives in this file so it
 * can be reviewed in one place: COPY (shared strings) and, per scenario, the readout label, the
 * teaching sentence (≤ 25 words), the event cards and the zones between events.
 *
 * Model (see synth.ts): distances use v/2 = 80 m/µs (propagation velocity 160 m/µs, typical for
 * XLPE), so the round-trip time in µs is distance / 80. Each trace is the launch pulse plus a list
 * of echoes; an echo is a copy of the launch pulse (same polarity for amp > 0, inverted for amp < 0)
 * that the synthesiser attenuates and widens with distance. `amp` is the effective reflection at
 * the event (coefficient × transmission through earlier events), before cable loss.
 *
 * Copy rules: sentence case, British English, short lines, technically correct, no hype.
 * Card lines: `coef` = reflection coefficient and polarity, `seeing` = what you are seeing,
 * `next` = what to do next. `{dz}` and `{ns}` in COPY are filled in from the scenario's pulse.
 */

/** One echo on a trace. `shape: 'S'` is a short impedance bump (a joint): an up-down wiggle. */
export interface Echo {
  at: number;
  amp: number;
  widen?: number;
  shape?: 'S';
}

export interface TraceDef {
  echoes: Echo[];
  /** A gradual fall in impedance over a length (water ingress): the trace droops. */
  droop?: { from: number; to: number; depth: number };
  /** 'lv' = the low-voltage reference shot (ARM), 'ghost' = the other state of an intermittent fault. */
  style?: 'lv' | 'ghost';
  /** A small legend written next to the trace at distance `at`. */
  legend?: { text: string; at: number };
}

/** An event the cursor snaps to (10 px either side of `at`). */
export interface EventDef {
  at: number;
  name: string;
  coef?: string;
  seeing: string;
  next: string;
  /** Short tag drawn on the trace; defaults to `name`. Empty string: no tag (the main event has its marker). */
  tag?: string;
}

/** A stretch of trace with its own description (instead of "Clean cable"). */
export interface ZoneDef {
  from: number;
  to: number;
  name?: string;
  coef?: string;
  seeing: string;
  next?: string;
}

export interface Scenario {
  /** Sentence case; lower-cased first letter in "Showing trace 4 of 10: arc reflection". */
  title: string;
  /** Axis length in metres (the useful range of the shot). */
  range: number;
  /** Launch pulse width in ns: sets the pulse shape and the dead zone (width × v/2). */
  pulseNs: number;
  /** The answer: the fault, or the cable end / the feature on a healthy cable. */
  main: number;
  /** True when `main` is a fault: orange marker and hot echo. Other events are graphite. */
  fault: boolean;
  /** Readout label above the big figure. Ending in "at" or "from" reads on into the figure. */
  label: string;
  /** Teaching sentence under the trace, ≤ 25 words. */
  teach: string;
  /** The far end, when the trace shows it (for "x m to the cable end"). */
  end?: number;
  /** Name of that end in the relation line; default "cable end". */
  endName?: string;
  events: EventDef[];
  zones?: ZoneDef[];
  /** traces[0] is drawn first; an ARM scenario has the low-voltage shot first. */
  traces: TraceDef[];
  /** Index of the trace that carries the fault echo (orange). Default 0. */
  hot?: number;
  /** Shade the dead zone near the launch pulse. */
  band?: boolean;
}

/** Shared strings. */
export const COPY = {
  pulseAt: 'Pulse at',
  lvShot: 'Low-voltage shot',
  arcShot: 'Shot during the arc',
  count: 'Trace {n} of {total}: {title}',
  showing: 'Showing trace {n} of {total}: {title}',
  hint: 'Move across the trace, drag it, or focus it and use the arrow keys to read any distance and what the echo means.',
  velocity: 'Distances use v/2 = 80 m/µs (a propagation velocity of 160 m/µs, typical for XLPE).',
  another: 'Show another trace',
  roundTrip: '{t} µs round trip',
  next: 'Next:',
  clean: 'Clean cable: no impedance change.',
  measureTip: 'This is the echo of the event. Measure from where it leaves the baseline, not from its peak.',
  onFault: 'On the fault',
  beforeFault: '{d} m before the fault',
  pastFault: '{d} m past the fault',
  toEnd: '{d} m to the {end}',
  pastEnd: '{d} m past the {end}',
  cableEnd: 'cable end',
  metres: 'metres',
  microseconds: 'microseconds',
  launch: {
    at: 0,
    name: 'Launch pulse',
    seeing: 'The pulse leaving the instrument. Every distance is measured from here.',
    next: 'Follow the trace: each change of impedance sends an echo back.',
  } satisfies EventDef,
  deadZone: {
    name: 'Dead zone',
    seeing: 'Echoes from the first {dz} m can hide under the {ns} ns launch pulse.',
    next: 'For a fault this close, use a shorter pulse or test from the far end.',
  },
  pastEndZone: {
    seeing: 'Past the cable end: no cable here, only noise.',
  },
} as const;

/* ----------------------------------------------------------------- shared events */
const joint = (at: number): EventDef => ({
  at,
  name: 'Joint',
  coef: 'A few per cent, up then down',
  seeing: 'A small wiggle where two cable lengths are spliced together.',
  next: 'Normal. Note the distance: joints help you check your place on the route.',
});

const cableEnd = (at: number, seeing: string, next: string, coef = '+100%, positive'): EventDef => ({
  at,
  name: 'Cable end',
  coef,
  seeing,
  next,
});

/* ----------------------------------------------------------------- the ten shots */
export const SCENARIOS: Scenario[] = [
  {
    title: 'Open circuit',
    range: 2000,
    pulseNs: 400,
    main: 1284.6,
    fault: true,
    label: 'Open circuit',
    teach: 'A large positive echo before the cable’s known end means a break. The time to the echo gives the distance.',
    events: [
      joint(612.4),
      {
        at: 1284.6,
        name: 'Open circuit',
        tag: '',
        coef: '+100%, positive',
        seeing: 'A broken conductor: the pulse returns with the same polarity.',
        next: 'Confirm from the far end, then find that distance on the route map.',
      },
    ],
    zones: [
      {
        from: 1284.6,
        to: 2000,
        seeing: 'Past the break: the pulse does not get through, so the rest of the cable is not seen.',
      },
    ],
    traces: [{ echoes: [{ at: 612.4, amp: 0.07, shape: 'S' }, { at: 1284.6, amp: 1 }] }],
  },
  {
    title: 'Short circuit',
    range: 1500,
    pulseNs: 300,
    main: 842.0,
    fault: true,
    label: 'Short circuit',
    teach: 'A large inverted echo means a low-resistance path from conductor to screen. The time to the echo gives the distance.',
    events: [
      {
        at: 842.0,
        name: 'Short circuit',
        tag: '',
        coef: 'Close to −100%, inverted',
        seeing: 'Conductor and screen are joined: the pulse returns upside down.',
        next: 'Trace the route with audio frequency: a solid short gives no surge thump.',
      },
    ],
    zones: [
      {
        from: 842.0,
        to: 1500,
        seeing: 'Past the short: almost no energy gets through, so the rest of the cable is not seen.',
      },
    ],
    traces: [{ echoes: [{ at: 842.0, amp: -0.95 }] }],
  },
  {
    title: 'High-resistance fault',
    range: 2500,
    pulseNs: 400,
    main: 1530.4,
    fault: true,
    label: 'High-resistance fault',
    teach: 'A high-resistance fault barely reflects at low voltage. That is why cables are surged: the arc makes the fault visible.',
    end: 1900,
    events: [
      {
        at: 1530.4,
        name: 'High-resistance fault',
        tag: '',
        coef: 'A few per cent, inverted: close to the noise',
        seeing: 'The fault resistance is far above the cable impedance, so almost nothing reflects.',
        next: 'Apply a surge and use arc reflection.',
      },
      cableEnd(
        1900,
        'The open far end: the pulse passes the fault almost untouched.',
        'The full length shows, so a clean end does not prove a healthy cable.',
      ),
    ],
    traces: [{ echoes: [{ at: 1530.4, amp: -0.03, widen: 1.5 }, { at: 1900, amp: 1 }] }],
  },
  {
    title: 'Arc reflection',
    range: 2000,
    pulseNs: 400,
    main: 1167.3,
    fault: true,
    label: 'Arc reflection',
    teach: 'Compare two shots: at low voltage the fault is hidden; during the surge arc it reflects like a short. Where they part is the fault.',
    end: 1760,
    hot: 1,
    events: [
      {
        at: 1167.3,
        name: 'Fault under arc',
        tag: '',
        coef: 'Close to −100%, inverted (during the arc)',
        seeing: 'Compare the two traces: they part where the surge arc shorts the fault.',
        next: 'Pinpoint along the route with surge and an acoustic receiver.',
      },
      {
        at: 1760,
        name: 'Cable end',
        tag: '',
        coef: '+100%, positive (low-voltage shot)',
        seeing: 'The low-voltage shot reaches the end: during the arc almost all of the pulse turns back at the fault.',
        next: 'Read the fault where the traces part, not at this echo.',
      },
    ],
    zones: [
      { from: 0, to: 1167.3, seeing: 'Both shots agree here: clean cable, no change.' },
    ],
    traces: [
      {
        style: 'lv',
        echoes: [{ at: 1167.3, amp: -0.03, widen: 1.5 }, { at: 1760, amp: 1 }],
        legend: { text: 'Low-voltage shot', at: 1760 },
      },
      {
        echoes: [{ at: 1167.3, amp: -0.92 }, { at: 1760, amp: 0.02 }],
        legend: { text: 'During the arc', at: 1167.3 },
      },
    ],
  },
  {
    title: 'Clean trace with a joint',
    range: 2500,
    pulseNs: 400,
    main: 1950,
    fault: false,
    label: 'Clean trace. Cable ends at',
    teach: 'No low-resistance fault here: a small wiggle at the joint, then a positive echo from the open end at the full length.',
    end: 1950,
    events: [
      joint(641.2),
      {
        ...cableEnd(
          1950,
          'The open far end at the expected length: nothing breaks the cable before it.',
          'If the cable still fails its test, surge it to look for a high-resistance fault.',
        ),
        tag: '',
      },
    ],
    traces: [{ echoes: [{ at: 641.2, amp: 0.08, shape: 'S' }, { at: 1950, amp: 1 }] }],
  },
  {
    title: 'Wet section',
    range: 2000,
    pulseNs: 400,
    main: 900,
    fault: true,
    label: 'Wet section from',
    teach: 'A slow droop instead of a sharp echo suggests the insulation is degrading along a length, often from water getting in.',
    end: 1700,
    events: [
      {
        at: 900,
        name: 'Wet section starts',
        tag: '',
        coef: 'Small, negative, spread over a length',
        seeing: 'The trace starts to droop: the impedance falls gradually along the cable.',
        next: 'Test the insulation resistance and plan to replace this length.',
      },
      cableEnd(
        1700,
        'A smaller, wider end echo: the wet length absorbs part of the pulse.',
        'Check the length against the records.',
        '+100%, positive (weakened)',
      ),
    ],
    zones: [
      {
        from: 900,
        to: 1700,
        name: 'Wet section',
        coef: 'Small, negative, spread over a length',
        seeing: 'Inside the wet length: the trace keeps drooping as the insulation weakens.',
        next: 'Look for the cause: a damaged sheath or a joint letting water in.',
      },
    ],
    traces: [{ echoes: [{ at: 1700, amp: 0.62, widen: 1.5 }], droop: { from: 900, to: 1700, depth: 0.2 } }],
  },
  {
    title: 'Tee joint',
    range: 2000,
    pulseNs: 400,
    main: 720,
    fault: false,
    label: 'Clean trace. Tee at',
    teach: 'An inverted echo where the cable splits in two, then one positive echo from the end of each branch.',
    end: 1640,
    endName: 'main cable end',
    events: [
      {
        at: 720,
        name: 'Tee joint',
        tag: '',
        coef: '−33%, inverted',
        seeing: 'Two cables in parallel halve the impedance, so the echo is inverted.',
        next: 'Expect one end echo per branch. Check both lengths on the route map.',
      },
      {
        at: 1120,
        name: 'Branch end',
        coef: '+100%, positive (weakened by the tee)',
        seeing: 'The open end of the short branch, 400 m past the tee.',
        next: 'If the fault could be on this branch, test from its end too.',
      },
      {
        at: 1640,
        name: 'Main cable end',
        tag: 'Main end',
        coef: '+100%, positive (weakened by the tee)',
        seeing: 'The open end of the main run, 920 m past the tee.',
        next: 'Use the route map to tell the two branches apart.',
      },
    ],
    zones: [
      { from: 720, to: 1640, seeing: 'Past the tee: echoes from both branches share this trace.' },
    ],
    traces: [{ echoes: [{ at: 720, amp: -0.333 }, { at: 1120, amp: 0.444 }, { at: 1640, amp: 0.444 }] }],
  },
  {
    title: 'Cable type change',
    range: 2000,
    pulseNs: 400,
    main: 1800,
    fault: false,
    label: 'Clean trace. Cable ends at',
    teach: 'A small inverted echo and a normal end, matching a splice to lower-impedance cable in the records: a change of cable, not a fault.',
    end: 1800,
    events: [
      {
        at: 1100,
        name: 'Cable type change',
        tag: 'Type change',
        coef: 'About −15%, inverted',
        seeing: 'A larger cross-section starts here: lower impedance, so a small inverted echo.',
        next: 'Check the records: a planned splice to another cable type is normal.',
      },
      {
        ...cableEnd(
          1800,
          'The open far end at the full length.',
          'Cable types can differ in velocity: set v/2 per section for a precise distance.',
        ),
        tag: '',
      },
    ],
    zones: [
      { from: 1100, to: 1800, seeing: 'The larger cable: flat again, no further change.' },
    ],
    traces: [{ echoes: [{ at: 1100, amp: -0.15 }, { at: 1800, amp: 0.98 }] }],
  },
  {
    title: 'Intermittent fault',
    range: 2500,
    pulseNs: 400,
    main: 1421.8,
    fault: true,
    label: 'Intermittent fault',
    teach: 'Two shots disagree: the fault comes and goes. It may only break down under voltage, so surge it and capture the arc.',
    end: 2060,
    hot: 1,
    events: [
      {
        at: 1421.8,
        name: 'Intermittent fault',
        tag: '',
        coef: '0 to about −55%, changes from shot to shot',
        seeing: 'A ghost: one shot shows an inverted echo here, the next shows nothing.',
        next: 'It may only break down under voltage: surge the cable and capture the arc.',
      },
      {
        ...cableEnd(
          2060,
          'The far end echo is full only while the fault is not conducting.',
          'Keep the clean shot as the reference for arc reflection.',
        ),
        tag: '',
      },
    ],
    traces: [
      { echoes: [{ at: 2060, amp: 1 }], legend: { text: 'Not conducting', at: 2060 } },
      {
        style: 'ghost',
        echoes: [{ at: 1421.8, amp: -0.55 }, { at: 2060, amp: 0.2 }],
        legend: { text: 'Conducting', at: 1421.8 },
      },
    ],
  },
  {
    title: 'Clean trace, short cable',
    range: 600,
    pulseNs: 200,
    main: 480,
    fault: false,
    label: 'Clean trace. Cable ends at',
    teach: 'A clean trace: launch pulse, flat cable, one positive echo from the open end. A fault inside the dead zone could hide.',
    end: 480,
    band: true,
    events: [
      {
        ...cableEnd(
          480,
          'The open far end: a positive echo with the shape of the launch pulse.',
          'Save this trace: a reference makes later faults easier to spot.',
        ),
        tag: '',
      },
    ],
    traces: [{ echoes: [{ at: 480, amp: 1 }] }],
  },
];

/** Fills {name} placeholders. */
export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** "Open circuit" → "open circuit" for use inside a sentence. */
export function inSentence(title: string): string {
  return title.charAt(0).toLowerCase() + title.slice(1);
}
