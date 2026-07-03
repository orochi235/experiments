// Straight skeleton of a simple polygon via wavefront simulation. Under
// uniform inset, each wavefront vertex travels along its angle bisector — a
// linear trajectory p(t) = p0 + t·d obtained by intersecting the two adjacent
// edges' offset lines. An edge dies when its two endpoint trajectories meet
// (edge event); a reflex vertex's bisector can also hit a non-adjacent
// wavefront edge, splitting the wavefront in two (split event).
//
// Primary engine: SLAV (list of active vertices) with both event kinds,
// recomputing candidate events from scratch after every processed event —
// the polygons are small, and recomputation eliminates stale-queue bugs.
// Fallback: the v1 naive edge-collapse-only engine, kept for inputs the SLAV
// engine rejects (self-intersections, stalled wavefronts, budget overruns).
import type { Point, Polygon } from './clipping';

export interface FacePoint { t: number; p: Point }

export interface SkeletonFace {
  edgeIndex: number;    // input edge (vertex i → i+1) that sweeps this face
  n: Point;             // unit inward normal of that edge
  outline: FacePoint[]; // closed ring; [0] = edge start, [1] = edge end (both t=0)
  tDeath: number;       // max inset on the face
}

export interface Skeleton {
  faces: SkeletonFace[];
  ridges: Array<[Point, Point]>;   // bisector segments, for debug overlays
  tMax: number;                    // inset at which the wavefront fully collapsed
  method: 'slav' | 'naive';        // diagnostic: which engine produced this
}

// Internal to the naive engine (and its converter).
interface SkeletonCell {
  edgeIndex: number;
  n: Point;
  left: FacePoint[];
  right: FacePoint[];
  tDeath: number;
}

interface Traj { p0: Point; d: Point }

// Vertex trajectory between edges e and f: the point at inset t on both
// offset lines, (p − a)·n = t for each. Linear in t.
function vertexTrajectory(
  e: { a: Point; n: Point }, f: { a: Point; n: Point },
): Traj | null {
  const det = e.n.x * f.n.y - e.n.y * f.n.x;
  if (Math.abs(det) < 1e-9) {
    // Parallel normals. If they point the same way it's a collinear continuation
    // that survived the pre-filter (near-collinear pair) — return the straight
    // inward trajectory along f's normal. Antiparallel (spike) stays null.
    // The threshold is widened from the naive 1e-12 on purpose: near-parallel
    // same-direction pairs with a tiny nonzero det would otherwise take the
    // "true intersection" branch below, where dividing by that near-zero det
    // causes catastrophic cancellation (speeds blowing up to ~1e9). The
    // straight-line fallback here is safe even though it discards the true
    // (numerically unstable) intersection point, because new vertices are
    // always re-anchored through their actual birth point afterward
    // (see trajThrough), so the fallback's anchor error never leaks in.
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

// Drop zero-length edges, then drop collinear (redundant) vertices: a vertex
// whose two incident edges are nearly parallel in the same direction adds no
// geometry and its null trajectory breaks face coverage.
function cleanPolygon(poly: Polygon): Point[] {
  const rawPts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  return rawPts.filter((p, i) => {
    const m = rawPts.length;
    const prev = rawPts[(i - 1 + m) % m]!;
    const next = rawPts[(i + 1) % m]!;
    const dx0 = p.x - prev.x, dy0 = p.y - prev.y;
    const len0 = Math.hypot(dx0, dy0);
    const dx1 = next.x - p.x, dy1 = next.y - p.y;
    const len1 = Math.hypot(dx1, dy1);
    if (len0 < 1e-6 || len1 < 1e-6) return true;
    const ux0 = dx0 / len0, uy0 = dy0 / len0;
    const ux1 = dx1 / len1, uy1 = dy1 / len1;
    const cross = Math.abs(ux0 * uy1 - uy0 * ux1);
    const dot = ux0 * ux1 + uy0 * uy1;
    return !(cross < 1e-6 && dot > 0);
  });
}

const EPS_T = 1e-9;
// EPS_MATCH is deliberately 100x looser than the 1e-6 px floor used elsewhere
// to decide whether an arc/vertex-motion is nonzero-length: junction points
// reach this comparison via several accumulated trajectory evaluations
// (split events re-anchoring through birth points, chained offset-line
// intersections), so float error can grow well past 1e-6 by the time two
// arc endpoints that are "the same junction" are compared here. All of these
// thresholds — 1e-6, 1e-4, EPS_T, EPS_DENOM below — are absolute px/dimensionless
// constants, not scaled to input size; they're only valid at the roughly
// 10–1000 px rim scale this lab's balloons operate at.
const EPS_MATCH = 1e-4; // px — junction identity when chaining arcs into faces

interface OrigEdge { index: number; a: Point; n: Point; u: Point }

interface WfVertex {
  traj: Traj | null;      // null = degenerate (antiparallel neighbors); can't move
  birthT: number;
  birthP: Point;
  prevEdge: OrigEdge;     // wavefront edge entering this vertex
  nextEdge: OrigEdge;     // wavefront edge leaving this vertex
  prev: WfVertex;
  next: WfVertex;
}

// A vertex-lifetime segment. Each arc bounds exactly two faces: the face of
// the edge on its left (nextEdge) and on its right (prevEdge).
interface Arc { aT: number; aP: Point; bT: number; bP: Point; left: number; right: number }

function windingSign(pts: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    area2 += p.x * q.y - q.x * p.y;
  }
  return area2 > 0 ? 1 : -1;
}

function isReflex(v: WfVertex, sign: number): boolean {
  const cross = v.prevEdge.u.x * v.nextEdge.u.y - v.prevEdge.u.y * v.nextEdge.u.x;
  return cross * sign < -1e-12;
}

function slavSkeleton(pts: Point[]): Skeleton {
  const n = pts.length;
  const sign = windingSign(pts);
  const edges: OrigEdge[] = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { index: i, a, n: { x: -u.y * sign, y: u.x * sign }, u };
  });

  const initial: WfVertex[] = pts.map((p, i) => ({
    traj: null, birthT: 0, birthP: p,
    prevEdge: edges[(i - 1 + n) % n]!, nextEdge: edges[i]!,
    prev: null as unknown as WfVertex, next: null as unknown as WfVertex,
  }));
  for (let i = 0; i < n; i++) {
    initial[i]!.prev = initial[(i - 1 + n) % n]!;
    initial[i]!.next = initial[(i + 1) % n]!;
    initial[i]!.traj = vertexTrajectory(initial[i]!.prevEdge, initial[i]!.nextEdge);
  }

  const alive = new Set<WfVertex>(initial);
  const arcs: Arc[] = [];
  const ridges: Array<[Point, Point]> = [];
  let tNow = 0;

  const posAt = (v: WfVertex, t: number): Point => (v.traj ? at(v.traj, t) : v.birthP);

  // Trajectory for a vertex born at p at time t between edges e and f. A true
  // bisector trajectory already passes through p (both offset lines meet
  // there); the parallel-same-direction fallback in vertexTrajectory anchors
  // at f.a instead — right direction, wrong point — so re-anchor through p.
  const trajThrough = (e: OrigEdge, f: OrigEdge, p: Point, t: number): Traj | null => {
    const tr = vertexTrajectory(e, f);
    if (!tr) return null;
    const q = at(tr, t);
    if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-6) {
      return { p0: { x: p.x - tr.d.x * t, y: p.y - tr.d.y * t }, d: tr.d };
    }
    return tr;
  };

  const die = (v: WfVertex, t: number, p: Point) => {
    alive.delete(v);
    if (Math.hypot(p.x - v.birthP.x, p.y - v.birthP.y) > 1e-6) {
      arcs.push({
        aT: v.birthT, aP: v.birthP, bT: t, bP: p,
        left: v.nextEdge.index, right: v.prevEdge.index,
      });
      ridges.push([v.birthP, p]);
    }
  };

  // Retire a 2-vertex LAV: the wavefront between two vertices is a zero-area
  // 2-gon that dies instantly. Both vertices die at their current positions,
  // and the coincident final wavefront segment becomes a closing arc between
  // the two remaining faces (this is the ridge segment of e.g. a rectangle).
  const retire2 = (v: WfVertex, t: number) => {
    const w = v.next;
    const pv = posAt(v, t), pw = posAt(w, t);
    die(v, t, pv);
    die(w, t, pw);
    if (Math.hypot(pv.x - pw.x, pv.y - pw.y) > 1e-6) {
      arcs.push({
        aT: t, aP: pv, bT: t, bP: pw,
        left: v.nextEdge.index, right: v.prevEdge.index,
      });
      ridges.push([pv, pw]);
    }
  };

  // A LAV containing a null-trajectory vertex is pinned: antiparallel fronts
  // have fused, which only happens once that LAV has collapsed onto a line.
  // Retire it in place — every vertex dies at its position, and overlapping
  // opposite-facing front intervals pair into closing arcs. This generalizes
  // retire2's closing arc to rings whose sides are subdivided by fused
  // parallel fronts (e.g. a body pinched by a tail: the bottom front is two
  // collinear edges' fronts joined by a ridge-carrying phantom vertex).
  // Returns false if the ring is not yet collinear (same-t events pending).
  const retireNullRing = (v0: WfVertex, t: number): boolean => {
    const ring: WfVertex[] = [];
    for (let v = v0; ; v = v.next) { ring.push(v); if (v.next === v0) break; }
    const pos = ring.map((v) => posAt(v, t));
    // Line through the two most distant positions.
    let iA = 0, iB = 0, dMax = 0;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const d = Math.hypot(pos[j]!.x - pos[i]!.x, pos[j]!.y - pos[i]!.y);
        if (d > dMax) { dMax = d; iA = i; iB = j; }
      }
    }
    if (dMax < 1e-6) { // point collapse
      for (let i = 0; i < ring.length; i++) die(ring[i]!, t, pos[i]!);
      return true;
    }
    const uL = { x: (pos[iB]!.x - pos[iA]!.x) / dMax, y: (pos[iB]!.y - pos[iA]!.y) / dMax };
    const nL = { x: -uL.y, y: uL.x };
    const o = pos[iA]!;
    if (pos.some((p) => Math.abs((p.x - o.x) * nL.x + (p.y - o.y) * nL.y) > 1e-6)) return false;

    for (let i = 0; i < ring.length; i++) die(ring[i]!, t, pos[i]!);

    // Closing arcs: cut the line at every front endpoint; each elementary
    // interval must be covered by exactly one front from each side.
    const sOf = (p: Point) => (p.x - o.x) * uL.x + (p.y - o.y) * uL.y;
    interface Span { lo: number; hi: number; side: number; edge: number }
    const spans: Span[] = [];
    for (let i = 0; i < ring.length; i++) {
      const sA = sOf(pos[i]!), sB = sOf(pos[(i + 1) % ring.length]!);
      if (Math.abs(sB - sA) < 1e-6) continue;
      const e = ring[i]!.nextEdge;
      const side = e.n.x * nL.x + e.n.y * nL.y;
      if (Math.abs(side) < 0.5) throw new Error('skeleton: degenerate ring: skew front');
      spans.push({ lo: Math.min(sA, sB), hi: Math.max(sA, sB), side: Math.sign(side), edge: e.index });
    }
    const cuts = spans.flatMap((sp) => [sp.lo, sp.hi]).sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k]!, b = cuts[k + 1]!;
      if (b - a < 1e-6) continue;
      const mid = (a + b) / 2;
      const covers = spans.filter((sp) => sp.lo <= mid && mid <= sp.hi);
      const plus = covers.filter((sp) => sp.side > 0);
      const minus = covers.filter((sp) => sp.side < 0);
      if (plus.length !== 1 || minus.length !== 1) {
        throw new Error('skeleton: degenerate ring pairing failed');
      }
      const pv = { x: o.x + a * uL.x, y: o.y + a * uL.y };
      const pw = { x: o.x + b * uL.x, y: o.y + b * uL.y };
      arcs.push({
        aT: t, aP: pv, bT: t, bP: pw,
        left: plus[0]!.edge, right: minus[0]!.edge,
      });
      ridges.push([pv, pw]);
    }
    return true;
  };

  // Find the alive wavefront segment carried by original edge `e` in v's own
  // LAV whose offset span at time t contains s. Returns the segment's start
  // vertex, or null (event invalidated by earlier topology changes).
  const splitTarget = (v: WfVertex, e: OrigEdge, s: Point, t: number): WfVertex | null => {
    let cur = v.next;
    while (cur !== v) {
      // Null-trajectory endpoints are stationary, not invalid: a segment whose
      // endpoint came from an antiparallel merge can still be split.
      if (cur.nextEdge === e && cur.next !== v) {
        const pa = posAt(cur, t), pb = posAt(cur.next, t);
        const lo = (s.x - pa.x) * e.u.x + (s.y - pa.y) * e.u.y;
        const hi = (pb.x - s.x) * e.u.x + (pb.y - s.y) * e.u.y;
        if (lo > -1e-6 && hi > -1e-6) return cur;
      }
      cur = cur.next;
    }
    return null;
  };

  // denom above is a dimensionless (unit-normal-dot-product) quantity, unlike
  // the px-scale thresholds elsewhere, so it gets its own epsilon.
  const EPS_DENOM = 1e-9;

  const MAX_EVENTS = 8 * n;
  for (let ev = 0; ; ev++) {
    if (ev >= MAX_EVENTS) throw new Error('skeleton: event budget exceeded');

    // Retire every LAV already reduced to ≤ 2 vertices, plus every LAV that
    // has gone degenerate (collinear ring pinned by a null-trajectory vertex).
    let retired = true;
    while (retired) {
      retired = false;
      for (const v of alive) {
        if (v.next === v) { die(v, tNow, posAt(v, tNow)); retired = true; break; }
        if (v.next.next === v) { retire2(v, tNow); retired = true; break; }
        if (!v.traj && retireNullRing(v, tNow)) { retired = true; break; }
      }
    }
    if (alive.size === 0) break;

    // --- scan for the earliest event (recomputed from scratch each round) ---
    let bestT = Infinity;
    let bestEdgeV: WfVertex | null = null;
    for (const v of alive) {
      const w = v.next;
      if (!v.traj || !w.traj) continue;
      const u = v.nextEdge.u;
      const c0 = (w.traj.p0.x - v.traj.p0.x) * u.x + (w.traj.p0.y - v.traj.p0.y) * u.y;
      const c1 = (w.traj.d.x - v.traj.d.x) * u.x + (w.traj.d.y - v.traj.d.y) * u.y;
      let tc: number;
      if (c0 + c1 * tNow < 1e-9 && c1 <= 1e-12) {
        // Already zero-length and not growing (vertex events leave coincident
        // pairs whose segment merely translates, c1 = 0): collapse now.
        tc = tNow;
      } else {
        if (c1 >= -1e-12) continue; // not shrinking
        tc = -c0 / c1;
        if (tc < tNow - EPS_T) continue;
        if (tc < Math.max(v.birthT, w.birthT) - EPS_T) continue;
      }
      if (tc < bestT - EPS_T) { bestT = tc; bestEdgeV = v; }
    }

    let bestSplit: { t: number; v: WfVertex; edge: OrigEdge; s: Point } | null = null;
    for (const v of alive) {
      if (!v.traj || !isReflex(v, sign)) continue;
      for (const e of edges) {
        if (e === v.prevEdge || e === v.nextEdge) continue;
        // Reflex bisector meets e's offset line when (p(t) − a)·n = t.
        const denom = 1 - (v.traj.d.x * e.n.x + v.traj.d.y * e.n.y);
        if (denom <= EPS_DENOM) continue;
        const num = (v.traj.p0.x - e.a.x) * e.n.x + (v.traj.p0.y - e.a.y) * e.n.y;
        const tc = num / denom;
        if (tc < tNow - EPS_T || tc < v.birthT - EPS_T) continue;
        // Edge events win ties; among splits keep the earliest.
        if (tc >= bestT - EPS_T) continue;
        if (bestSplit && tc >= bestSplit.t - EPS_T) continue;
        const s = at(v.traj, tc);
        if (!splitTarget(v, e, s, tc)) continue;
        bestSplit = { t: tc, v, edge: e, s };
      }
    }

    if (bestSplit) {
      tNow = bestSplit.t;
      const { v, edge, s } = bestSplit;
      const a = splitTarget(v, edge, s, tNow);
      if (!a) throw new Error('skeleton: split target vanished');
      const b = a.next;
      const prev = v.prev, next = v.next;
      die(v, tNow, s);
      // LAV 1: … prev → x → b …   LAV 2: … a → y → next …
      const x: WfVertex = {
        traj: trajThrough(v.prevEdge, edge, s, tNow), birthT: tNow, birthP: s,
        prevEdge: v.prevEdge, nextEdge: edge,
        prev, next: b,
      };
      const y: WfVertex = {
        traj: trajThrough(edge, v.nextEdge, s, tNow), birthT: tNow, birthP: s,
        prevEdge: edge, nextEdge: v.nextEdge,
        prev: a, next,
      };
      prev.next = x; b.prev = x;
      a.next = y; next.prev = y;
      alive.add(x); alive.add(y);
    } else if (bestEdgeV) {
      tNow = bestT;
      const v = bestEdgeV, w = v.next;
      const pv = at(v.traj!, tNow), pw = at(w.traj!, tNow);
      const m = { x: (pv.x + pw.x) / 2, y: (pv.y + pw.y) / 2 };
      const prev = v.prev, next = w.next;
      die(v, tNow, m);
      die(w, tNow, m);
      const x: WfVertex = {
        traj: trajThrough(v.prevEdge, w.nextEdge, m, tNow), birthT: tNow, birthP: m,
        prevEdge: v.prevEdge, nextEdge: w.nextEdge,
        prev, next,
      };
      prev.next = x; next.prev = x;
      alive.add(x);
    } else {
      throw new Error('skeleton: wavefront stalled');
    }
  }

  // ---- face reconstruction: chain each edge's arcs from rim end to rim start ----
  let tMax = 0;
  for (const arc of arcs) tMax = Math.max(tMax, arc.aT, arc.bT);

  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < EPS_MATCH;

  const faces: SkeletonFace[] = [];
  for (const e of edges) {
    const A = pts[e.index]!;
    const B = pts[(e.index + 1) % n]!;
    const mine = arcs.filter((c) => c.left === e.index || c.right === e.index);
    const used = new Set<Arc>();
    const outline: FacePoint[] = [{ t: 0, p: A }, { t: 0, p: B }];
    let cur = B;
    let closed = false;
    for (let guard = 0; guard <= mine.length; guard++) {
      let step: FacePoint | null = null;
      for (const c of mine) {
        if (used.has(c)) continue;
        if (near(c.aP, cur)) { step = { t: c.bT, p: c.bP }; used.add(c); break; }
        if (near(c.bP, cur)) { step = { t: c.aT, p: c.aP }; used.add(c); break; }
      }
      if (!step) break;
      if (near(step.p, A)) { closed = true; break; }
      outline.push(step);
      cur = step.p;
    }
    if (!closed) throw new Error(`skeleton: face ${e.index} failed to chain`);
    for (const c of mine) {
      if (!used.has(c) && Math.hypot(c.aP.x - c.bP.x, c.aP.y - c.bP.y) > EPS_MATCH) {
        throw new Error(`skeleton: face ${e.index} left arcs unconsumed`);
      }
    }
    const tDeath = outline.reduce((m, fp) => Math.max(m, fp.t), 0);
    faces.push({ edgeIndex: e.index, n: e.n, outline, tDeath });
  }

  return { faces, ridges, tMax, method: 'slav' };
}

function naiveCells(pts: Point[]): { cells: SkeletonCell[]; ridges: Array<[Point, Point]>; tMax: number } {
  const n = pts.length;
  if (n < 3) return { cells: [], ridges: [], tMax: 0 };

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

// Old two-chain cells → face outlines. left runs A→apex ascending, right runs
// B→apex ascending, so the ring [A, B, ...right minus B..., ...left minus A
// reversed...] walks the boundary with the rim edge first.
function facesFromCells(cells: SkeletonCell[]): SkeletonFace[] {
  const faces: SkeletonFace[] = [];
  for (const cell of cells) {
    if (cell.left.length < 1 || cell.right.length < 1) continue;
    const outline: FacePoint[] = [
      { t: cell.left[0]!.t, p: cell.left[0]!.p },
      { t: cell.right[0]!.t, p: cell.right[0]!.p },
      ...cell.right.slice(1).map((tp) => ({ t: tp.t, p: tp.p })),
      ...cell.left.slice(1).map((tp) => ({ t: tp.t, p: tp.p })).reverse(),
    ];
    // Dedupe consecutive coincident points (apexes often coincide).
    const ring = outline.filter((fp, i) => {
      if (i === 0) return true;
      const prev = outline[i - 1]!;
      return Math.hypot(fp.p.x - prev.p.x, fp.p.y - prev.p.y) > 1e-6;
    });
    if (ring.length < 3) continue;
    faces.push({
      edgeIndex: cell.edgeIndex,
      n: cell.n,
      outline: ring,
      tDeath: cell.tDeath,
    });
  }
  return faces;
}

function naiveSkeleton(pts: Point[]): Skeleton {
  const { cells, ridges, tMax } = naiveCells(pts);
  return { faces: facesFromCells(cells), ridges, tMax, method: 'naive' };
}

export function computeStraightSkeleton(poly: Polygon): Skeleton {
  const pts = cleanPolygon(poly);
  if (pts.length < 3) return { faces: [], ridges: [], tMax: 0, method: 'naive' };
  try {
    return slavSkeleton(pts);
  } catch {
    // Degraded-but-stable: v1 behavior for inputs the SLAV engine rejects
    // (self-intersections, stalled wavefronts, budget overruns).
    return naiveSkeleton(pts);
  }
}
