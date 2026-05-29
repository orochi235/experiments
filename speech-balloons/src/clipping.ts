// Thin wrapper around clipper2-ts so the rest of the lab can stay agnostic of
// the underlying boolean / offset implementation.
//
// All inputs/outputs are simple {x, y} point arrays. We use the *D (double-precision)
// API so we don't need to scale floats into integer space manually.

import {
  unionD,
  differenceD,
  inflatePathsD,
  FillRule,
  JoinType,
  EndType,
  type PathD,
  type PathsD,
} from 'clipper2-ts';

const PRECISION = 3;

export type Point = { x: number; y: number };
export type Polygon = Point[];

/** Signed 2× polygon area (shoelace). Sign tells us the winding:
 *  positive = CCW in math y-up coords (= CW in SVG y-down screen). */
function signedArea2(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return s;
}

/** Boolean union of multiple polygons → one or more output polygons.
 *  Polygons with opposing windings would XOR-cancel under clipper2's
 *  NonZero rule, so we normalize every input polygon to the dominant
 *  winding (by total absolute area) before the boolean op. */
export function unionPolygons(polys: Polygon[]): Polygon[] {
  if (polys.length === 0) return [];
  const safe = polys.filter((poly) => {
    if (poly.length < 3) return false;
    for (const p of poly) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    }
    return true;
  });
  if (safe.length === 0) return [];
  if (safe.length === 1) return [safe[0]];
  // Decide the target winding from the polygon with the largest |area|.
  let dominant = 0;
  let bestAbs = -1;
  for (const poly of safe) {
    const a = signedArea2(poly);
    if (Math.abs(a) > bestAbs) {
      bestAbs = Math.abs(a);
      dominant = a;
    }
  }
  const targetSign = dominant >= 0 ? 1 : -1;
  const normalized = safe.map((poly) => {
    const a = signedArea2(poly);
    const sign = a >= 0 ? 1 : -1;
    return sign === targetSign ? poly : poly.slice().reverse();
  });
  const result: PathsD = unionD(normalized as PathD[], [], FillRule.NonZero, PRECISION);
  return result.filter((p) => p.length >= 3).map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })));
}

/** Subtract `clips` from `subjects`. Output may include hole subpaths (clipper
 *  emits outer rings CCW and holes CW; render with SVG's default nonzero rule). */
export function differencePolygons(subjects: Polygon[], clips: Polygon[]): Polygon[] {
  if (subjects.length === 0) return [];
  if (clips.length === 0) return subjects;
  const result: PathsD = differenceD(subjects as PathsD, clips as PathsD, FillRule.NonZero, PRECISION);
  return result.filter((p) => p.length >= 3).map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })));
}

/** Inflate an OPEN polyline by `halfWidth` to produce a closed filled ribbon. */
export function inflateOpenPolyline(
  line: Polygon,
  halfWidth: number,
  endType: 'round' | 'square' | 'butt' = 'round',
  joinType: 'round' | 'miter' = 'round',
): Polygon[] {
  const et = endType === 'round' ? EndType.Round : endType === 'square' ? EndType.Square : EndType.Butt;
  const jt = joinType === 'round' ? JoinType.Round : JoinType.Miter;
  const result: PathsD = inflatePathsD([line as PathD], halfWidth, jt, et, 2.0, PRECISION);
  return result.filter((p) => p.length >= 3).map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })));
}

/** Offset (inflate / inset) a CLOSED polygon by `delta`. Positive = grow outward,
 *  negative = shrink inward. Used for puffy fill shells. */
export function offsetClosedPolygon(
  poly: Polygon,
  delta: number,
  joinType: 'round' | 'miter' = 'round',
): Polygon[] {
  const jt = joinType === 'round' ? JoinType.Round : JoinType.Miter;
  const result: PathsD = inflatePathsD([poly as PathD], delta, jt, EndType.Polygon, 2.0, PRECISION);
  return result.filter((p) => p.length >= 3).map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })));
}

/** Offset multiple closed polygons at once (single clipper pass). */
export function offsetClosedPolygons(
  polys: Polygon[],
  delta: number,
  joinType: 'round' | 'miter' = 'round',
): Polygon[] {
  if (polys.length === 0) return [];
  const jt = joinType === 'round' ? JoinType.Round : JoinType.Miter;
  const result: PathsD = inflatePathsD(polys as PathsD, delta, jt, EndType.Polygon, 2.0, PRECISION);
  return result.filter((p) => p.length >= 3).map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })));
}

/** Convert one or more polygons into a compound SVG path-data string. */
export function polygonsToSvgPath(polys: Polygon[]): string {
  if (polys.length === 0) return '';
  return polys
    .map((p) => {
      if (p.length === 0) return '';
      return (
        p.map((pt, i) => (i === 0 ? `M ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}` : `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)).join(' ') +
        ' Z'
      );
    })
    .filter(Boolean)
    .join(' ');
}

/** Discretize a circle into a CCW polygon. `segments` controls smoothness. */
export function circleToPolygon(cx: number, cy: number, r: number, segments = 48): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}
