// Region construction for the analytic lit-bevel renderer. The rim polyline is
// first simplified by turning-angle tolerance (dense sampler output → a
// moderate vertex count; "corner fans" emerge as runs of short edges whose
// azimuths step by ≤ cornerStep). The straight skeleton of the simplified rim
// then yields one cell per edge, which is cut at the bevel seam into a band
// strip and (optionally) a roof panel.
import type { Point, Polygon } from './clipping';
import { computeStraightSkeleton, type TrajPoint } from './straightSkeleton';

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

export type InteriorTreatment = 'roof-panels' | 'dome-blob' | 'flat';

export type GradientFrame =
  | { kind: 'linear'; from: Point; to: Point }   // from = x0 end, to = x1 end
  | { kind: 'radial'; center: Point; radius: number }
  | { kind: 'solid' };

export interface Region {
  kind: 'strip' | 'panel' | 'blob' | 'flat';
  outline: Polygon;
  azimuthDeg: number;  // outward-normal azimuth of the owning rim edge
  x0: number;          // contour-x at gradient offset 0
  x1: number;          // contour-x at gradient offset 1
  frame: GradientFrame;
}

export interface BuildRegionsResult {
  regions: Region[];
  tMax: number;                    // skeleton collapse inset == the dMax for x-normalization
  ridges: Array<[Point, Point]>;   // for debug overlays
}

// Boundary points with t ≤ tCut, plus an interpolated point exactly at tCut.
function cutTraj(traj: TrajPoint[], tCut: number): TrajPoint[] {
  const out: TrajPoint[] = [];
  for (let i = 0; i < traj.length; i++) {
    const tp = traj[i]!;
    if (tp.t <= tCut + 1e-9) { out.push(tp); continue; }
    const prev = traj[i - 1]!;
    const u = (tCut - prev.t) / (tp.t - prev.t);
    out.push({
      t: tCut,
      p: { x: prev.p.x + (tp.p.x - prev.p.x) * u, y: prev.p.y + (tp.p.y - prev.p.y) * u },
    });
    break;
  }
  return out;
}

function rangeTraj(traj: TrajPoint[], t0: number, t1: number): TrajPoint[] {
  const upper = cutTraj(traj, t1);
  const head = cutTraj(traj, t0);
  const start = head[head.length - 1]!;
  return [start, ...upper.filter((tp) => tp.t > t0 + 1e-9)];
}

// left ascending then right descending: closes along the rim edge (or seam).
const ring = (left: TrajPoint[], right: TrajPoint[]): Polygon =>
  [...left.map((tp) => tp.p), ...right.map((tp) => tp.p).reverse()];

export function buildRegions(opts: {
  rim: Polygon;
  bevelWidthPx: number;
  interior: InteriorTreatment;
  cornerStepDeg: number;
}): BuildRegionsResult {
  const rim = simplifyRim(opts.rim, opts.cornerStepDeg);
  const skel = computeStraightSkeleton(rim);
  const tMax = Math.max(skel.tMax, 1e-6);
  const b = Math.min(Math.max(opts.bevelWidthPx, 0.5), tMax * 0.999);
  const xb = b / tMax;
  const regions: Region[] = [];
  const innerRing: Point[] = [];

  for (const cell of skel.cells) {
    if (cell.left.length < 2 || cell.right.length < 2) continue; // degenerate
    const stripEnd = Math.min(b, cell.tDeath);
    const leftCut = cutTraj(cell.left, stripEnd);
    const rightCut = cutTraj(cell.right, stripEnd);
    const outline = ring(leftCut, rightCut);
    if (outline.length < 3) continue;
    const a = leftCut[0]!.p, c = rightCut[0]!.p;
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const azimuthDeg = (Math.atan2(-cell.n.y, -cell.n.x) * 180) / Math.PI;
    regions.push({
      kind: 'strip', outline, azimuthDeg,
      x0: 0, x1: stripEnd / tMax,
      frame: {
        kind: 'linear', from: mid,
        to: { x: mid.x + cell.n.x * stripEnd, y: mid.y + cell.n.y * stripEnd },
      },
    });
    innerRing.push(leftCut[leftCut.length - 1]!.p);

    // Sliver guard: a panel shallower than half a pixel is the capped-b case
    // (bevelWidth ≥ total collapse) — render it as strip-only.
    if (opts.interior === 'roof-panels' && cell.tDeath > b + 0.5) {
      const leftHi = rangeTraj(cell.left, b, cell.tDeath);
      const rightHi = rangeTraj(cell.right, b, cell.tDeath);
      const panelOutline = ring(leftHi, rightHi);
      if (panelOutline.length >= 3) {
        const seamMid = {
          x: (leftHi[0]!.p.x + rightHi[0]!.p.x) / 2,
          y: (leftHi[0]!.p.y + rightHi[0]!.p.y) / 2,
        };
        const depth = cell.tDeath - b;
        regions.push({
          kind: 'panel', outline: panelOutline, azimuthDeg,
          x0: xb, x1: cell.tDeath / tMax,
          frame: {
            kind: 'linear', from: seamMid,
            to: { x: seamMid.x + cell.n.x * depth, y: seamMid.y + cell.n.y * depth },
          },
        });
      }
    }
  }

  if (innerRing.length >= 3 && opts.interior !== 'roof-panels' && b < tMax * 0.99) {
    const cx = innerRing.reduce((s, p) => s + p.x, 0) / innerRing.length;
    const cy = innerRing.reduce((s, p) => s + p.y, 0) / innerRing.length;
    if (opts.interior === 'dome-blob') {
      regions.push({
        kind: 'blob', outline: innerRing, azimuthDeg: 0,
        x0: 1, x1: xb, // radial: offset 0 at center (x=1) → offset 1 at seam (x_b)
        frame: { kind: 'radial', center: { x: cx, y: cy }, radius: tMax - b },
      });
    } else {
      regions.push({
        kind: 'flat', outline: innerRing, azimuthDeg: 0,
        x0: 1, x1: 1, frame: { kind: 'solid' },
      });
    }
  }

  return { regions, tMax, ridges: skel.ridges };
}
