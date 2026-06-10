// Region construction for the analytic lit-bevel renderer. The rim polyline is
// first simplified by turning-angle tolerance (dense sampler output → a
// moderate vertex count; "corner fans" emerge as runs of short edges whose
// azimuths step by ≤ cornerStep). The straight skeleton of the simplified rim
// then yields one cell per edge, which is cut at the bevel seam into a band
// strip and (optionally) a roof panel.
import type { Point, Polygon } from './clipping';

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Merge runs of edges whose cumulative turning stays under cornerStepDeg.
// Anchored at the sharpest corner so hard corners are never smoothed away.
export function simplifyRim(poly: Polygon, cornerStepDeg: number): Polygon {
  const pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  const n = pts.length;
  if (n <= 4) return pts;
  const tol = (Math.max(1, cornerStepDeg) * Math.PI) / 180;
  const heading = (i: number) => {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const turnAt = (i: number) => Math.abs(angleDiff(heading(i), heading((i - 1 + n) % n)));

  let start = 0, sharpest = -1;
  for (let i = 0; i < n; i++) {
    const t = turnAt(i);
    if (t > sharpest) { sharpest = t; start = i; }
  }
  const kept: Point[] = [pts[start]!];
  let acc = 0;
  for (let k = 1; k < n; k++) {
    const i = (start + k) % n;
    acc += turnAt(i);
    if (acc >= tol) { kept.push(pts[i]!); acc = 0; }
  }
  return kept.length >= 3 ? kept : pts;
}
