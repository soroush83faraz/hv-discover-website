/**
 * Waveform synthesis for the hero TDR scenarios (scenarios.ts). Pure functions, no DOM.
 *
 * A trace = launch pulse + echoes + seeded noise, sampled on a fixed distance grid (so the same
 * scenario looks the same on every load and at every width).
 * - Pulse shape: f(t) = t² e^(2−t) / 4 (peak 1 at t = 2), with a small undershoot; t = u / σ, u = metres
 *   past the echo's take-off point. The take-off point is the event distance.
 * - σ at the launch = pulse width (ns × v/2) / 7, so the launch pulse is about one pulse width long.
 * - Each echo is the launch shape, scaled by its reflection (times a display gain of 1.5), attenuated
 *   (e^(−d/2800 m)) and widened by dispersion (σ × (1 + d/1200 m)), its peak falling as it widens.
 * - The display saturates softly above the launch level, as a real instrument clips its launch pulse.
 */
import type { Scenario, TraceDef } from './scenarios';

export const V2 = 80; // m/µs, half the propagation velocity
export const SAMPLES = 1200;
export const NEG = 0.62; // display room below the baseline, in launch units

const LOSS_M = 2800;
const ECHO_GAIN = 1.5; // display gain on echoes; the launch pulse saturates instead
const DISP_M = 1200;

/** Pulse width in metres (one-way equivalent): the dead zone. */
export const pulseM = (sc: Scenario): number => (sc.pulseNs * V2) / 1000;

/** Width parameter of an echo from distance d. */
export const sigmaAt = (sc: Scenario, d: number, widen = 1): number => (pulseM(sc) / 7) * (1 + d / DISP_M) * widen;

/** Distance past the take-off point over which an echo is visible. */
export const extentAt = (sc: Scenario, d: number, widen = 1): number => 7.5 * sigmaAt(sc, d, widen);

function shape(t: number): number {
  if (t <= 0) return 0;
  const u = t - 6.6;
  return (t * t * Math.exp(2 - t)) / 4 - 0.07 * Math.exp(-(u * u) / 3.2);
}

/** Derivative-like wiggle for a short impedance bump (joint), peak normalised to ±1. */
function shapeS(t: number): number {
  if (t <= 0) return 0;
  return ((2 * t - t * t) * Math.exp(2 - t)) / 4 / 0.85;
}

function soft(y: number): number {
  if (y > 0.85) return 0.85 + 0.15 * Math.tanh((y - 0.85) / 0.15);
  if (y < -0.5) return -0.5 - 0.12 * Math.tanh((-y - 0.5) / 0.12);
  return y;
}

function noise(seed: number): Float32Array {
  let s = seed >>> 0;
  const raw = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    raw[i] = s / 4294967296 - 0.5;
  }
  const out = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) out[i] = ((raw[i - 1] ?? 0) + 2 * raw[i]! + (raw[i + 1] ?? 0)) / 4;
  return out;
}

/** Samples of one trace over [0, sc.range], SAMPLES + 1 points. */
export function synth(sc: Scenario, def: TraceDef, seed: number): Float32Array {
  const n = noise(seed);
  const out = new Float32Array(SAMPLES + 1);
  const s0 = sigmaAt(sc, 0);
  for (let i = 0; i <= SAMPLES; i++) {
    const d = (i / SAMPLES) * sc.range;
    let y = 1.25 * shape(d / s0);
    for (const e of def.echoes) {
      const u = d - e.at;
      if (u <= 0) continue;
      const w = (1 + e.at / DISP_M) * (e.widen ?? 1);
      const s = s0 * w;
      const a = ECHO_GAIN * e.amp * Math.exp(-e.at / LOSS_M) * Math.pow(w, -0.5);
      y += a * (e.shape === 'S' ? shapeS(u / s) : shape(u / s));
    }
    if (def.droop) {
      const { from, to, depth } = def.droop;
      if (d > from) {
        const p = Math.min(1, (d - from) / (to - from));
        let off = -depth * Math.pow(p, 1.6);
        if (d > to) off *= Math.exp(-(d - to) / (sigmaAt(sc, to) * 3)); // back to the baseline past the end
        y += off;
      }
    }
    y += n[i]! * (0.022 + 0.012 * (d / sc.range));
    out[i] = soft(y);
  }
  return out;
}

/** Linear interpolation of a trace at distance d. */
export function valueAt(sc: Scenario, samples: Float32Array, d: number): number {
  const f = Math.max(0, Math.min(SAMPLES, (d / sc.range) * SAMPLES));
  const i = Math.floor(f);
  const a = samples[i]!;
  const b = samples[Math.min(SAMPLES, i + 1)]!;
  return a + (b - a) * (f - i);
}
