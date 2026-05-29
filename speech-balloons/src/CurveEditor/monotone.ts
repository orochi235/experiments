/**
 * Monotone cubic interpolation (Fritsch-Carlson / Steffen variant).
 *
 * Passes through every anchor and guarantees the curve never
 * overshoots `min(neighbors)` / `max(neighbors)` along either axis.
 * The right choice for animation timing curves (no anticipation) or
 * audio envelopes (no out-of-range values).
 *
 * Parameterized by index — works for both 1D (function-shaped) and
 * 2D (parametric) anchor sequences. The x and y coordinates are
 * interpolated independently as functions of the anchor index.
 *
 * Reference: Fritsch & Carlson 1980, "Monotone piecewise cubic
 * interpolation." Steffen's 1990 refinement is conceptually the same;
 * we use a min-clamp variant that's monotonicity-preserving by
 * construction.
 */

import type { Point } from './catmullRom';

/** Per-axis tangent computation for a 1D series of y-values sampled at
 *  unit intervals (index-parameterized). Returns one tangent per
 *  anchor. */
function tangents(ys: readonly number[]): number[] {
  const n = ys.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Secant slopes (dx = 1 in index parameterization).
  const m: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) m[i] = ys[i + 1] - ys[i];

  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      // Sign change or flat → local extremum; tangent is zero (forces
      // the curve to settle without overshoot).
      t[i] = 0;
    } else {
      // Weighted average of adjacent secants (with dx_i = dx_{i-1} = 1,
      // this is just the arithmetic mean). Clamped by Steffen's rule
      // so the cubic stays monotone within each segment.
      const avg = (m[i - 1] + m[i]) / 2;
      const mag = Math.min(Math.abs(m[i - 1]), Math.abs(m[i]), Math.abs(avg));
      t[i] = Math.sign(avg) * mag;
    }
  }
  return t;
}

/** Cubic Hermite basis at parameter t ∈ [0, 1] given endpoint values
 *  p0, p1 and endpoint tangents m0, m1. */
function hermite(
  p0: number, p1: number, m0: number, m1: number, t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1
  );
}

/**
 * Sample the monotone-cubic curve through `anchors`. Returns
 * `(n-1) * samplesPerSegment + 1` points (same shape as
 * `sampleCatmullRom`). `[]` for fewer than 2 anchors.
 */
export function sampleMonotone(
  anchors: readonly Point[],
  samplesPerSegment: number,
): Point[] {
  if (anchors.length < 2) return [];
  if (samplesPerSegment < 1) samplesPerSegment = 1;

  const n = anchors.length;
  const xs = anchors.map((a) => a.x);
  const ys = anchors.map((a) => a.y);
  const tx = tangents(xs);
  const ty = tangents(ys);

  const out: Point[] = [];
  for (let i = 0; i < n - 1; i++) {
    const startStep = i === 0 ? 0 : 1; // skip duplicate boundary
    for (let s = startStep; s <= samplesPerSegment; s++) {
      if (s === 0) { out.push(anchors[i]); continue; }
      if (s === samplesPerSegment) { out.push(anchors[i + 1]); continue; }
      const t = s / samplesPerSegment;
      out.push({
        x: hermite(xs[i], xs[i + 1], tx[i], tx[i + 1], t),
        y: hermite(ys[i], ys[i + 1], ty[i], ty[i + 1], t),
      });
    }
  }
  return out;
}
