// Region construction for the analytic lit-bevel renderer. The rim polyline is
// first simplified by turning-angle tolerance (dense sampler output → a
// moderate vertex count; "corner fans" emerge as runs of short edges whose
// azimuths step by ≤ cornerStep). The straight skeleton of the simplified rim
// then yields one face per edge, which is clipped at the bevel seam (an iso-t
// line, since t is affine within a face) into a band strip and (optionally) a
// roof panel. The interior beyond the seam is assembled from the per-face
// "above" pieces via a clipper union, which naturally dissolves shared seams
// into one ring per disjoint island.
import type { Point, Polygon } from './clipping';
import { unionPolygons } from './clipping';
import { computeStraightSkeleton, type FacePoint } from './straightSkeleton';

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

const EPS_T = 1e-9;

function crossingAt(p: FacePoint, q: FacePoint, b: number): FacePoint {
  const u = Math.min(1, Math.max(0, (b - p.t) / (q.t - p.t)));
  return {
    t: b,
    p: { x: p.p.x + (q.p.x - p.p.x) * u, y: p.p.y + (q.p.y - p.p.y) * u },
  };
}

// Drop consecutive duplicates, including the wrap-around pair.
function dedupeRing(ring: FacePoint[]): FacePoint[] {
  const out = ring.filter((fp, i) => {
    if (i === 0) return true;
    const prev = ring[i - 1]!;
    return Math.hypot(fp.p.x - prev.p.x, fp.p.y - prev.p.y) > 1e-6;
  });
  while (out.length > 1) {
    const first = out[0]!, last = out[out.length - 1]!;
    if (Math.hypot(first.p.x - last.p.x, first.p.y - last.p.y) > 1e-6) break;
    out.pop();
  }
  return out;
}

// Clip a face outline against t ≤ b. t is affine within a face, so the cut is
// a straight line and linear interpolation along boundary segments is exact.
// The below-region of a face is always connected (it contains the whole rim
// edge), so a single Sutherland–Hodgman ring is safe here.
function clipFaceBelow(outline: FacePoint[], b: number): FacePoint[] {
  const keep = (t: number) => t <= b + EPS_T;
  const out: FacePoint[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % outline.length]!;
    const pin = keep(p.t);
    if (pin) out.push(p);
    if (pin !== keep(q.t)) out.push(crossingAt(p, q, b));
  }
  return dedupeRing(out);
}

// Pieces of a face with t ≥ b. Each connected component of the above-region
// meets the face boundary in exactly one maximal run of kept vertices, closed
// by a single seam chord — so one ring per run, no zero-width bridges (which
// the renderer's 1px same-paint stroke would otherwise trace as visible lines).
export function clipFaceAbovePieces(outline: FacePoint[], b: number): FacePoint[][] {
  const n = outline.length;
  const kept = outline.map((fp) => fp.t >= b - EPS_T);
  if (kept.every(Boolean)) return [dedupeRing(outline)];
  const pieces: FacePoint[][] = [];
  // Walk from each below→above transition to the matching above→below one.
  for (let i = 0; i < n; i++) {
    if (kept[i] || !kept[(i + 1) % n]) continue;
    const piece: FacePoint[] = [];
    // Entering crossing on edge i → i+1.
    piece.push(crossingAt(outline[i]!, outline[(i + 1) % n]!, b));
    let j = (i + 1) % n;
    while (kept[j]) {
      piece.push(outline[j]!);
      j = (j + 1) % n;
    }
    // Leaving crossing on edge j-1 → j.
    piece.push(crossingAt(outline[(j - 1 + n) % n]!, outline[j]!, b));
    pieces.push(dedupeRing(piece));
  }
  return pieces;
}

function ringArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

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
  const abovePieces: Polygon[] = [];
  // Above-pieces are wasted work unless roof-panels needs them directly, or
  // islands will consume them (skipped entirely once b caps out near tMax).
  const needsAbove = opts.interior === 'roof-panels' || b < tMax * 0.99;

  for (const face of skel.faces) {
    if (face.outline.length < 3) continue;
    const rimMid = {
      x: (face.outline[0]!.p.x + face.outline[1]!.p.x) / 2,
      y: (face.outline[0]!.p.y + face.outline[1]!.p.y) / 2,
    };
    const azimuthDeg = (Math.atan2(-face.n.y, -face.n.x) * 180) / Math.PI;
    const stripEnd = Math.min(b, face.tDeath);

    const strip = clipFaceBelow(face.outline, stripEnd);
    if (strip.length >= 3) {
      regions.push({
        kind: 'strip',
        outline: strip.map((fp) => fp.p),
        azimuthDeg,
        x0: 0,
        x1: stripEnd / tMax,
        frame: {
          kind: 'linear',
          from: rimMid,
          to: { x: rimMid.x + face.n.x * stripEnd, y: rimMid.y + face.n.y * stripEnd },
        },
      });
    }

    // Sliver guard: a panel shallower than half a pixel is the capped-b case
    // (bevelWidth ≥ total collapse) — render it as strip-only.
    if (face.tDeath > b + 0.5 && needsAbove) {
      const pieces = clipFaceAbovePieces(face.outline, b);
      for (const above of pieces) {
        if (above.length < 3) continue;
        if (opts.interior === 'roof-panels') {
          // Same azimuth/x0/x1/frame for every piece of a face — the frame is
          // anchored to the face's seam line, which is exact for every piece.
          const seamMid = { x: rimMid.x + face.n.x * b, y: rimMid.y + face.n.y * b };
          const depth = face.tDeath - b;
          regions.push({
            kind: 'panel',
            outline: above.map((fp) => fp.p),
            azimuthDeg,
            x0: xb,
            x1: face.tDeath / tMax,
            frame: {
              kind: 'linear',
              from: seamMid,
              to: { x: seamMid.x + face.n.x * depth, y: seamMid.y + face.n.y * depth },
            },
          });
        } else {
          abovePieces.push(above.map((fp) => fp.p));
        }
      }
    }
  }

  // Interior islands: the region beyond the seam can be several disjoint
  // pieces (a tail pinches off from the body via a split event). Union the
  // per-face above-pieces with clipper — piece edges coincide along shared
  // skeleton arcs, so the union dissolves them into per-island loops.
  if (opts.interior !== 'roof-panels' && b < tMax * 0.99 && abovePieces.length > 0) {
    const islands = unionPolygons(abovePieces);
    for (const island of islands) {
      if (island.length < 3 || ringArea(island) < 1) continue;
      // Island plateau: centroid of the deepest skeleton points inside the
      // island (an elongated body collapses to a ridge segment, not a point).
      let tIsland = 0;
      for (const f of skel.faces) {
        for (const fp of f.outline) {
          if (fp.t > tIsland + 1e-6 && pointInPolygon(fp.p, island)) tIsland = fp.t;
        }
      }
      if (tIsland <= b) continue;
      let cx = 0, cy = 0, cn = 0;
      for (const f of skel.faces) {
        for (const fp of f.outline) {
          if (fp.t >= tIsland - 1e-6 && pointInPolygon(fp.p, island)) {
            cx += fp.p.x; cy += fp.p.y; cn++;
          }
        }
      }
      if (cn === 0) continue;
      const center = { x: cx / cn, y: cy / cn };
      if (opts.interior === 'dome-blob') {
        regions.push({
          kind: 'blob', outline: island, azimuthDeg: 0,
          x0: tIsland / tMax, x1: xb,
          frame: { kind: 'radial', center, radius: Math.max(tIsland - b, 1e-6) },
        });
      } else {
        regions.push({
          kind: 'flat', outline: island, azimuthDeg: 0,
          x0: tIsland / tMax, x1: tIsland / tMax, frame: { kind: 'solid' },
        });
      }
    }
  }

  return { regions, tMax, ridges: skel.ridges };
}
