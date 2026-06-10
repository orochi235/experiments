// Straight skeleton of a simple polygon via wavefront simulation, edge-collapse
// events only. Under uniform inset, each wavefront vertex travels along its
// angle bisector — a linear trajectory p(t) = p0 + t·d obtained by intersecting
// the two adjacent edges' offset lines. An edge dies when its two endpoint
// trajectories meet; its neighbors then become adjacent and spawn a new vertex.
//
// Reflex (concave) vertices are NOT split-event-correct: their bisectors are
// traced naively, matching the project's miter-offset behavior. Per the
// 2026-06-09 spec, concave rims render degraded-but-stable in v1.
import type { Point, Polygon } from './clipping';

export interface TrajPoint { t: number; p: Point }

export interface SkeletonCell {
  edgeIndex: number;   // edge from input vertex i to i+1
  n: Point;            // unit inward normal of the edge
  left: TrajPoint[];   // trajectory of the edge's START vertex, t ascending
  right: TrajPoint[];  // trajectory of the edge's END vertex, t ascending
  tDeath: number;      // inset at which the edge vanished (== tMax if it survived)
}

export interface Skeleton {
  cells: SkeletonCell[];           // one per input edge, input order
  ridges: Array<[Point, Point]>;   // bisector segments, for debug overlays
  tMax: number;                    // inset at which the wavefront fully collapsed
}

interface Traj { p0: Point; d: Point }

// Vertex trajectory between edges e and f: the point at inset t on both
// offset lines, (p − a)·n = t for each. Linear in t.
function vertexTrajectory(
  e: { a: Point; n: Point }, f: { a: Point; n: Point },
): Traj | null {
  const det = e.n.x * f.n.y - e.n.y * f.n.x;
  if (Math.abs(det) < 1e-12) {
    // Parallel normals. If they point the same way it's a collinear continuation
    // that survived the pre-filter (near-collinear pair) — return the straight
    // inward trajectory along f's normal. Antiparallel (spike) stays null.
    if (e.n.x * f.n.x + e.n.y * f.n.y > 0) {
      return { p0: f.a, d: f.n };
    }
    return null;
  }
  const ce = e.a.x * e.n.x + e.a.y * e.n.y;
  const cf = f.a.x * f.n.x + f.a.y * f.n.y;
  return {
    p0: { x: (ce * f.n.y - cf * e.n.y) / det, y: (e.n.x * cf - f.n.x * ce) / det },
    d: { x: (f.n.y - e.n.y) / det, y: (e.n.x - f.n.x) / det },
  };
}

const at = (tr: Traj, t: number): Point => ({ x: tr.p0.x + tr.d.x * t, y: tr.p0.y + tr.d.y * t });

export function computeStraightSkeleton(poly: Polygon): Skeleton {
  // Drop zero-length edges, then drop collinear (redundant) vertices: a vertex
  // whose two incident edges are nearly parallel in the same direction adds no
  // geometry and its null trajectory breaks cell coverage.
  const rawPts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  const pts = rawPts.filter((p, i) => {
    const m = rawPts.length;
    const prev = rawPts[(i - 1 + m) % m]!;
    const next = rawPts[(i + 1) % m]!;
    // Unit direction of edge arriving at p (prev→p) and leaving p (p→next).
    const dx0 = p.x - prev.x, dy0 = p.y - prev.y;
    const len0 = Math.hypot(dx0, dy0);
    const dx1 = next.x - p.x, dy1 = next.y - p.y;
    const len1 = Math.hypot(dx1, dy1);
    if (len0 < 1e-6 || len1 < 1e-6) return true; // keep; zero-len handled above
    const ux0 = dx0 / len0, uy0 = dy0 / len0;
    const ux1 = dx1 / len1, uy1 = dy1 / len1;
    // Cross product of unit directions ≈ 0 and dot > 0 → collinear continuation.
    const cross = Math.abs(ux0 * uy1 - uy0 * ux1);
    const dot = ux0 * ux1 + uy0 * uy1;
    return !(cross < 1e-6 && dot > 0);
  });
  const n = pts.length;
  const empty: Skeleton = { cells: [], ridges: [], tMax: 0 };
  if (n < 3) return empty;

  // Inward normal from winding (screen coords, y-down).
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!;
    area2 += p.x * q.y - q.x * p.y;
  }
  const sign = area2 > 0 ? 1 : -1;

  interface Wf {
    orig: number;
    a: Point;            // anchor on the original edge line
    n: Point;            // unit inward normal
    u: Point;            // unit edge direction
    cell: SkeletonCell;
    vert: Traj | null;   // trajectory of this edge's START vertex
    vertBirth: Point;    // where that vertex started (for ridges)
  }

  const act: Wf[] = [];
  const cells: SkeletonCell[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nin = { x: -u.y * sign, y: u.x * sign };
    const cell: SkeletonCell = {
      edgeIndex: i, n: nin,
      left: [{ t: 0, p: a }], right: [{ t: 0, p: b }], tDeath: 0,
    };
    cells.push(cell);
    act.push({ orig: i, a, n: nin, u, cell, vert: null, vertBirth: a });
  }
  for (let i = 0; i < n; i++) {
    act[i]!.vert = vertexTrajectory(act[(i - 1 + n) % n]!, act[i]!);
    act[i]!.vertBirth = pts[i]!;
  }

  const ridges: Array<[Point, Point]> = [];
  let tNow = 0;
  const MAX_EVENTS = 4 * n; // runaway guard for degenerate input
  for (let ev = 0; act.length > 2 && ev < MAX_EVENTS; ev++) {
    // Find the earliest edge collapse: signed length along u hits zero.
    let bestI = -1;
    let bestT = Infinity;
    const m = act.length;
    for (let i = 0; i < m; i++) {
      const e = act[i]!;
      const vl = e.vert, vr = act[(i + 1) % m]!.vert;
      if (!vl || !vr) continue;
      const c0 = (vr.p0.x - vl.p0.x) * e.u.x + (vr.p0.y - vl.p0.y) * e.u.y;
      const c1 = (vr.d.x - vl.d.x) * e.u.x + (vr.d.y - vl.d.y) * e.u.y;
      if (c1 >= -1e-12) continue; // not shrinking
      const tc = -c0 / c1;
      if (tc >= tNow - 1e-9 && tc < bestT) { bestT = tc; bestI = i; }
    }
    if (bestI < 0 || !isFinite(bestT)) break; // wavefront escaped (concave/naive)

    const i = bestI;
    const e = act[i]!;
    const prev = act[(i - 1 + act.length) % act.length]!;
    const next = act[(i + 1) % act.length]!;
    const vl = e.vert!, vr = next.vert!;
    const pl = at(vl, bestT), pr = at(vr, bestT);
    const meet = { x: (pl.x + pr.x) / 2, y: (pl.y + pr.y) / 2 };

    // Close the dying edge's cell.
    e.cell.left.push({ t: bestT, p: pl });
    e.cell.right.push({ t: bestT, p: pr });
    e.cell.tDeath = bestT;
    // Record breakpoints on the neighbors that shared the dead vertices.
    prev.cell.right.push({ t: bestT, p: pl });
    next.cell.left.push({ t: bestT, p: pr });
    ridges.push([e.vertBirth, meet], [next.vertBirth, meet]);

    // Remove e; next's start vertex is now the prev↔next bisector from `meet`.
    act.splice(i, 1);
    next.vert = vertexTrajectory(prev, next);
    next.vertBirth = meet;
    tNow = bestT;
  }

  // Terminate: survivors die together at tNow; their boundaries already end
  // at the last recorded breakpoints. Append final positions + ridge stubs.
  for (let i = 0; i < act.length; i++) {
    const e = act[i]!;
    const vl = e.vert, vr = act[(i + 1) % act.length]!.vert;
    if (vl) {
      const p = at(vl, tNow);
      e.cell.left.push({ t: tNow, p });
      ridges.push([e.vertBirth, p]);
    }
    if (vr) e.cell.right.push({ t: tNow, p: at(vr, tNow) });
    e.cell.tDeath = tNow;
  }

  // De-duplicate consecutive boundary points (events can land on existing ones).
  for (const cell of cells) {
    for (const key of ['left', 'right'] as const) {
      cell[key] = cell[key].filter((tp, idx, arr) => {
        if (idx === 0) return true;
        const prev = arr[idx - 1]!;
        return Math.abs(tp.t - prev.t) > 1e-9
          || Math.hypot(tp.p.x - prev.p.x, tp.p.y - prev.p.y) > 1e-6;
      });
    }
  }

  return { cells, ridges, tMax: tNow };
}
