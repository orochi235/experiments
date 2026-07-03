import { describe, it, expect } from 'vitest';
import { simplifyRim, clipFaceAbovePieces } from './bevelRegions';
import type { Polygon } from './clipping';

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
