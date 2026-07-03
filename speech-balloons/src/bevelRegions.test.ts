import { describe, it, expect } from 'vitest';
import { simplifyRim, clipFaceAbovePieces } from './bevelRegions';
import type { Polygon } from './clipping';
import { inflatePathsD, JoinType, EndType } from 'clipper2-ts';

function circlePoly(n: number, r = 50, cx = 100, cy = 100): Polygon {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

describe('simplifyRim', () => {
  it('dense circle: vertex count shrinks to ~360/cornerStep', () => {
    const dense = circlePoly(120); // 3° per edge
    const out = simplifyRim(dense, 12);
    expect(out.length).toBeGreaterThanOrEqual(24);
    expect(out.length).toBeLessThanOrEqual(36); // ~30 ± slack
  });

  it('rectangle survives unchanged (every turn exceeds tolerance)', () => {
    const rect: Polygon = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
    ];
    expect(simplifyRim(rect, 12)).toHaveLength(4);
  });

  it('collinear midpoints are dropped', () => {
    const withMid: Polygon = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 100 }, { x: 0, y: 100 },
    ];
    expect(simplifyRim(withMid, 12)).toHaveLength(4);
  });

  it('never returns fewer than 3 vertices even at degenerate tolerance', () => {
    const dense = circlePoly(120);
    expect(simplifyRim(dense, 200).length).toBeGreaterThanOrEqual(3);
  });
});

import { buildRegions } from './bevelRegions';

const rect200x100: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
];

function area(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

describe('buildRegions', () => {
  const opts = { rim: rect200x100, bevelWidthPx: 20, interior: 'roof-panels' as const, cornerStepDeg: 12 };

  it('rectangle, roof-panels: 4 strips + 4 panels that tile the body', () => {
    const { regions, tMax } = buildRegions(opts);
    expect(tMax).toBeCloseTo(50, 3);
    const strips = regions.filter((r) => r.kind === 'strip');
    const panels = regions.filter((r) => r.kind === 'panel');
    expect(strips).toHaveLength(4);
    expect(panels).toHaveLength(4);
    const total = regions.reduce((s, r) => s + area(r.outline), 0);
    expect(total).toBeCloseTo(200 * 100, -1); // within ~5 px²
  });

  it('x-ranges: strips span [0, x_b], panels start at x_b and end ≤ 1', () => {
    const { regions, tMax } = buildRegions(opts);
    const xb = 20 / tMax;
    for (const r of regions) {
      if (r.kind === 'strip') {
        expect(r.x0).toBe(0);
        expect(r.x1).toBeCloseTo(xb, 6);
      } else if (r.kind === 'panel') {
        expect(r.x0).toBeCloseTo(xb, 6);
        expect(r.x1).toBeGreaterThan(r.x0);
        expect(r.x1).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('dome-blob: strips + one radial blob region', () => {
    const { regions } = buildRegions({ ...opts, interior: 'dome-blob' });
    const blobs = regions.filter((r) => r.kind === 'blob');
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.frame.kind).toBe('radial');
  });

  it('flat: strips + one solid region', () => {
    const { regions } = buildRegions({ ...opts, interior: 'flat' });
    const flats = regions.filter((r) => r.kind === 'flat');
    expect(flats).toHaveLength(1);
    expect(flats[0]!.frame.kind).toBe('solid');
    expect(flats[0]!.x0).toBe(1);
  });

  it('bevelWidth past total collapse: strips only, capped at the ridge', () => {
    const { regions } = buildRegions({ ...opts, bevelWidthPx: 500 });
    expect(regions.every((r) => r.kind === 'strip')).toBe(true);
  });

  it('strip gradient frame runs inward from the rim edge midpoint', () => {
    const { regions } = buildRegions(opts);
    const top = regions.find((r) => r.kind === 'strip' && r.outline[0]!.y === 0)!;
    expect(top.frame.kind).toBe('linear');
    if (top.frame.kind === 'linear') {
      expect(top.frame.to.y).toBeGreaterThan(top.frame.from.y); // inward = +y for the top edge
    }
  });
});

describe('clipFaceAbovePieces', () => {
  // Synthetic W-shaped face: boundary dips below the seam in the middle,
  // so {t ≥ b} is two components. (Shape: rim edge at t=0 from (0,0)→(100,0),
  // then up the right side to t=30, across with a dip to t=10 at x=50, and
  // back down the left side.)
  const outline = [
    { t: 0, p: { x: 0, y: 0 } },
    { t: 0, p: { x: 100, y: 0 } },
    { t: 30, p: { x: 90, y: 30 } },
    { t: 10, p: { x: 50, y: 10 } },
    { t: 30, p: { x: 10, y: 30 } },
  ];

  it('splits a dipping face into one ring per component', () => {
    const pieces = clipFaceAbovePieces(outline, 20);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      expect(piece.length).toBeGreaterThanOrEqual(3);
      // Every crossing sits exactly on the seam.
      for (const fp of piece) expect(fp.t).toBeGreaterThanOrEqual(20 - 1e-9);
    }
  });

  it('returns a single ring when nothing dips below the seam', () => {
    const pieces = clipFaceAbovePieces(outline, 5);
    expect(pieces).toHaveLength(1);
  });

  it('returns no pieces when the whole face is below', () => {
    expect(clipFaceAbovePieces(outline, 40)).toHaveLength(0);
  });
});

const tailRect: Polygon = [
  { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
  { x: 120, y: 100 }, { x: 100, y: 140 }, { x: 90, y: 100 },
  { x: 0, y: 100 },
];

const dumbbell: Polygon = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 180, y: 40 },
  { x: 180, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 100 }, { x: 180, y: 100 },
  { x: 180, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

// Independent implementation of the inset ring, for cross-validation.
// Mirror the call shape of offsetClosedPolygon in src/clipping.ts, but force
// miter joins so corners match the skeleton's straight-line offsets.
function miterInsetArea(poly: Polygon, delta: number): number {
  const paths = inflatePathsD([poly], -delta, JoinType.Miter, EndType.Polygon, 2, 3);
  return paths.reduce((s, path) => s + area(path as { x: number; y: number }[]), 0);
}

describe('buildRegions — concave rims', () => {
  it('tail-on-rect: every rim edge gets a strip; regions tile the polygon (roof-panels)', () => {
    const { regions } = buildRegions({
      rim: tailRect, bevelWidthPx: 12, interior: 'roof-panels', cornerStepDeg: 12,
    });
    const strips = regions.filter((r) => r.kind === 'strip');
    expect(strips.length).toBe(7); // one per input edge
    const total = regions.reduce((s, r) => s + area(r.outline), 0);
    expect(total).toBeCloseTo(area(tailRect), -1);
  });

  it('tail-on-rect: interior island matches a miter-join clipper inset (oracle)', () => {
    const b = 12;
    const { regions } = buildRegions({
      rim: tailRect, bevelWidthPx: b, interior: 'dome-blob', cornerStepDeg: 12,
    });
    const got = regions
      .filter((r) => r.kind === 'blob')
      .reduce((s, r) => s + area(r.outline), 0);
    const oracle = miterInsetArea(tailRect, b);
    expect(Math.abs(got - oracle) / oracle).toBeLessThan(0.03);
  });

  it('dumbbell at b=15: the neck pinches off → two blob islands', () => {
    // Neck is 20 px tall → its local collapse is at t=10 < 15, so the seam
    // ring at t=15 splits into one loop per square.
    const { regions, tMax } = buildRegions({
      rim: dumbbell, bevelWidthPx: 15, interior: 'dome-blob', cornerStepDeg: 12,
    });
    expect(tMax).toBeCloseTo(50, 2);
    const blobs = regions.filter((r) => r.kind === 'blob');
    expect(blobs).toHaveLength(2);
    for (const blob of blobs) {
      expect(blob.frame.kind).toBe('radial');
      if (blob.frame.kind === 'radial') {
        // Each island's plateau is its square's center at t=50.
        expect(blob.frame.center.y).toBeCloseTo(50, 0);
        expect(blob.frame.radius).toBeCloseTo(50 - 15, 0);
      }
      expect(blob.x0).toBeCloseTo(1, 3); // both islands reach global tMax
    }
    const centersX = blobs
      .map((r) => (r.frame.kind === 'radial' ? r.frame.center.x : NaN))
      .sort((a, b2) => a - b2);
    expect(centersX[0]).toBeCloseTo(50, 0);
    expect(centersX[1]).toBeCloseTo(230, 0);
  });

  it('tail-on-rect at small b: the tail stays fused to the body as a single island', () => {
    const { regions } = buildRegions({
      rim: tailRect, bevelWidthPx: 8, interior: 'dome-blob', cornerStepDeg: 12,
    });
    const blobs = regions.filter((r) => r.kind === 'blob');
    // CORRECTED EXPECTATION (plan draft said blobs.length === 2, reasoning
    // that the tail "pinches off" the way the dumbbell's neck does). That
    // doesn't hold for this fixture: the tail is a single reentrant bump on
    // one edge, not a narrow waist joining two separate high regions, so its
    // above-b region never disconnects from the body's. Probed buildRegions
    // at b = 5, 8, 10, 12, 15, 18, 20, 21, 21.4, 21.5, 22, 24, 30, 35, 38, 40,
    // 42, 45, 48, 49, 49.5 (tMax = 50) — every value below total collapse
    // (~49.5) yields exactly one blob island whose x0 is 1 (it reaches the
    // shape's global tMax, on the rectangle side). So at b = 8 there is one
    // fused island, not a separate shallow tail island.
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.x0).toBeCloseTo(1, 3);
  });

  it('flat interior on dumbbell: two solid islands', () => {
    const { regions } = buildRegions({
      rim: dumbbell, bevelWidthPx: 15, interior: 'flat', cornerStepDeg: 12,
    });
    const flats = regions.filter((r) => r.kind === 'flat');
    expect(flats).toHaveLength(2);
    for (const f of flats) expect(f.frame.kind).toBe('solid');
  });
});
