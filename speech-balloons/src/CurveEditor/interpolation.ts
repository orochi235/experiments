/**
 * Interpolation mode dispatcher for CurveEditor. The vocabulary of
 * supported algorithms and the unified `sample(...)` entry point that
 * picks the right one. All algorithms produce
 * `(n-1) * samplesPerSegment + 1` points and pass through every
 * anchor — CurveEditor is strictly interpolating, never approximating.
 */

import { sampleCatmullRom, type Point } from './catmullRom';
import { sampleMonotone } from './monotone';

/** Supported interpolation modes. All are interpolating (pass through
 *  every anchor); the differences are in tangent computation and
 *  parameterization. */
export type InterpolationMode =
  | 'linear'
  | 'catmull-rom'           // centripetal (α=0.5) — safe default
  | 'catmull-rom-uniform'   // α=0; can cusp on sharp 2D angles
  | 'catmull-rom-chordal'   // α=1; smoother than uniform
  | 'monotone';             // Fritsch-Carlson / Steffen; no overshoot

/** Sample anchors as a polyline. Produces the same sample count shape
 *  as the Catmull-Rom variants so downstream segment-slicing logic
 *  (hit testing, fill path construction) works uniformly. */
function sampleLinear(
  anchors: readonly Point[],
  samplesPerSegment: number,
): Point[] {
  if (anchors.length < 2) return [];
  if (samplesPerSegment < 1) samplesPerSegment = 1;

  const out: Point[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const startStep = i === 0 ? 0 : 1;
    for (let s = startStep; s <= samplesPerSegment; s++) {
      if (s === 0) { out.push(a); continue; }
      if (s === samplesPerSegment) { out.push(b); continue; }
      const t = s / samplesPerSegment;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Sample `anchors` using the chosen interpolation mode. */
export function sampleByInterpolation(
  anchors: readonly Point[],
  samplesPerSegment: number,
  mode: InterpolationMode,
): Point[] {
  switch (mode) {
    case 'linear':
      return sampleLinear(anchors, samplesPerSegment);
    case 'catmull-rom-uniform':
      return sampleCatmullRom(anchors, samplesPerSegment, 0);
    case 'catmull-rom-chordal':
      return sampleCatmullRom(anchors, samplesPerSegment, 1);
    case 'monotone':
      return sampleMonotone(anchors, samplesPerSegment);
    case 'catmull-rom':
    default:
      return sampleCatmullRom(anchors, samplesPerSegment, 0.5);
  }
}
