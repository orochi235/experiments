import { describe, it, expect } from 'vitest';
import {
  buildRoundedRect,
  buildEllipse,
  buildPolygon,
  buildCloud,
  angleToS,
  pointedTailOffsetAt,
  spikesOffsetAt,
  buildBubbles,
  buildCloudPuffs,
  lobesOffsetAt,
  wobbleOffsetAt,
  jitterOffsetAt,
  type BaseSampler,
  type PointedTailConfig,
  type SpikesConfig,
} from './geometry';

const EPS = 1e-3;

describe('buildRoundedRect', () => {
  it('returns a sampler whose bodyPath starts with "M" and has positive totalLen', () => {
    const s = buildRoundedRect(100, 60, 10);
    expect(s.bodyPath.startsWith('M')).toBe(true);
    expect(s.totalLen).toBeGreaterThan(0);
  });

  it('perimeterAt(0) and perimeterAt(totalLen) coincide (wraparound)', () => {
    const s = buildRoundedRect(100, 60, 10);
    const p0 = s.perimeterAt(0);
    const p1 = s.perimeterAt(s.totalLen);
    expect(p1.x).toBeCloseTo(p0.x, 3);
    expect(p1.y).toBeCloseTo(p0.y, 3);
  });

  it('handles r=0 (pure rectangle)', () => {
    const s = buildRoundedRect(40, 20, 0);
    expect(s.bodyPath.startsWith('M')).toBe(true);
    expect(s.totalLen).toBeCloseTo(2 * (40 + 20), 3);
  });
});

describe('buildEllipse', () => {
  it('returns a positive-length sampler with bodyPath starting "M"', () => {
    const s = buildEllipse(80, 40);
    expect(s.bodyPath.startsWith('M')).toBe(true);
    expect(s.totalLen).toBeGreaterThan(0);
  });

  it('s=0 corresponds to the right vertex (W, H/2)', () => {
    const W = 80;
    const H = 40;
    const s = buildEllipse(W, H);
    const p = s.perimeterAt(0);
    expect(p.x).toBeCloseTo(W, 3);
    expect(p.y).toBeCloseTo(H / 2, 3);
  });

  it('normals point outward (away from the center)', () => {
    const W = 80;
    const H = 40;
    const cx = W / 2;
    const cy = H / 2;
    const s = buildEllipse(W, H);
    for (let i = 0; i < 16; i++) {
      const sv = (i / 16) * s.totalLen;
      const p = s.perimeterAt(sv);
      const rx = p.x - cx;
      const ry = p.y - cy;
      // outward normal must have positive dot with radial vector
      expect(p.nx * rx + p.ny * ry).toBeGreaterThan(0);
    }
  });
});

describe('buildPolygon', () => {
  it('hexagon perimeter approximates the inscribed-hexagon perimeter', () => {
    const W = 100;
    const H = 100;
    const N = 6;
    const s = buildPolygon(W, H, N, 0);
    // Regular hexagon inscribed in circle of radius R=W/2: side = R, perim = 6R.
    const expected = 2 * N * (W / 2) * Math.sin(Math.PI / N);
    expect(s.totalLen).toBeCloseTo(expected, 3);
  });

  it('closes (s=0 ≈ s=totalLen)', () => {
    const s = buildPolygon(80, 50, 5, 0);
    const a = s.perimeterAt(0);
    const b = s.perimeterAt(s.totalLen);
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.y).toBeCloseTo(a.y, 3);
  });

  it('outward normals point away from center', () => {
    const W = 100;
    const H = 80;
    const cx = W / 2;
    const cy = H / 2;
    const s = buildPolygon(W, H, 7, 0);
    for (let i = 0; i < 14; i++) {
      const sv = (i / 14) * s.totalLen;
      const p = s.perimeterAt(sv);
      const rx = p.x - cx;
      const ry = p.y - cy;
      expect(p.nx * rx + p.ny * ry).toBeGreaterThan(0);
    }
  });
});

describe('buildCloud', () => {
  it('produces a closed silhouette with perimeter > base ellipse', () => {
    const W = 100;
    const H = 70;
    const cloud = buildCloud(W, H, 8, 0.4);
    const ellipse = buildEllipse(W, H);
    expect(cloud.totalLen).toBeGreaterThan(ellipse.totalLen);
    const a = cloud.perimeterAt(0);
    const b = cloud.perimeterAt(cloud.totalLen);
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.y).toBeCloseTo(a.y, 3);
    expect(cloud.bodyPath.endsWith('Z')).toBe(true);
  });
});

describe('angleToS', () => {
  it('round-trips: perimeterAt(angleToS(θ)) lies along ray from center at angle θ', () => {
    const W = 100;
    const H = 60;
    const cx = W / 2;
    const cy = H / 2;
    const sampler = buildEllipse(W, H);
    for (const deg of [0, 30, 90, 135, 180, 220, 315]) {
      const s = angleToS(deg, sampler, cx, cy);
      const p = sampler.perimeterAt(s);
      const θ = (deg * Math.PI) / 180;
      const vx = p.x - cx;
      const vy = p.y - cy;
      const dot = vx * Math.cos(θ) + vy * Math.sin(θ);
      expect(dot).toBeGreaterThan(0);
    }
  });
});

// A flat-line "sampler stub" used for clean spike / tail math tests.
// Maps s in [0, totalLen] to a point on the x-axis; normal points +y.
function flatLineSampler(totalLen: number): BaseSampler {
  return {
    bodyPath: `M 0 0 L ${totalLen} 0`,
    totalLen,
    perimeterAt: (s: number) => {
      const sm = ((s % totalLen) + totalLen) % totalLen;
      return { x: sm, y: 0, nx: 0, ny: 1 };
    },
  };
}

describe('pointedTailOffsetAt', () => {
  const sampler = flatLineSampler(1000);
  const baseCfg: PointedTailConfig = {
    sc: 500,
    halfBase: 20,
    length: 100,
    arc: 0,
    radial: 0,
    totalLen: sampler.totalLen,
    perimeterAt: sampler.perimeterAt,
  };

  it('returns zero offset outside the half-base', () => {
    const off = pointedTailOffsetAt(baseCfg.sc + baseCfg.halfBase + 1, baseCfg);
    expect(off.dx).toBe(0);
    expect(off.dy).toBe(0);
    const off2 = pointedTailOffsetAt(baseCfg.sc - baseCfg.halfBase - 1, baseCfg);
    expect(off2.dx).toBe(0);
    expect(off2.dy).toBe(0);
  });

  it('at ds=0 outward magnitude equals length + radial', () => {
    const cfg: PointedTailConfig = { ...baseCfg, length: 100, radial: 25 };
    const off = pointedTailOffsetAt(cfg.sc, cfg);
    // Normal is (0,1) -> outward only in +y. Magnitude = length + radial.
    expect(off.dx).toBeCloseTo(0, 6);
    expect(off.dy).toBeCloseTo(125, 6);
  });

  it('wavy config injects a sinusoidal perpendicular shift that vanishes at the base', () => {
    const cfg: PointedTailConfig = {
      ...baseCfg,
      waveFreq: 2,
      waveAmp: 0.3,
    };
    // At exactly the base edge (ds = halfBase), t = 1 - 1 = 0 -> all zero.
    const offAtBase = pointedTailOffsetAt(cfg.sc + cfg.halfBase, cfg);
    expect(offAtBase.dx).toBeCloseTo(0, 6);
    expect(offAtBase.dy).toBeCloseTo(0, 6);
    // Pick a sample where the sine is decidedly nonzero. ds = halfBase/4 →
    // u = 0.25, t = 0.75, sin(2π · 2 · 0.75) = sin(3π) = 0; ds = halfBase/8 →
    // u = 0.125, t = 0.875, sin(2π · 2 · 0.875) = sin(3.5π) = -1 ≠ 0.
    const mid = cfg.sc + cfg.halfBase / 8;
    const offNoWave = pointedTailOffsetAt(mid, baseCfg);
    const offWave = pointedTailOffsetAt(mid, cfg);
    // perp axis on flat sampler with n=(0,1) is (-ny, nx) = (-1, 0) → x component.
    expect(Math.abs(offWave.dx - offNoWave.dx)).toBeGreaterThan(EPS);
  });
});

describe('spikesOffsetAt', () => {
  const sampler = flatLineSampler(1000);
  const baseSpikes: SpikesConfig = {
    spikeWidth: 10,
    spacing: 30,           // period = 40 → ~25 spikes
    length: 50,
    taper: 1,
    vertScale: 1,
    horzScale: 1,
    diagonalScale: 1,
    irregularity: 0,
    cornerCompensation: 0,
    phase: 0,
    totalLen: sampler.totalLen,
    perimeterAt: sampler.perimeterAt,
  };

  it('between spike footprints returns near-zero offset', () => {
    const period = baseSpikes.spikeWidth + baseSpikes.spacing; // 40
    // First spike center is at s ≈ period/2 (phase=0) — actually spikes start at i=0 → s=0.
    // To find a definitely-empty region, sample at s = period/2 where ds from i=0 is period/2
    // which > halfBase=5.
    const s = period / 2;
    const off = spikesOffsetAt(s, baseSpikes);
    expect(Math.abs(off.dx)).toBeLessThan(EPS);
    expect(Math.abs(off.dy)).toBeLessThan(EPS);
  });

  it('on a flat sampler with phase=0, s=0 sits at a spike center: outward = +y, length scales', () => {
    const off = spikesOffsetAt(0, baseSpikes);
    // outward dir is (0, 1); axisScale = horzScale (since |nx|=0 < |ny|=1 means ny>nx, picks vertScale=1)
    expect(off.dx).toBeCloseTo(0, 6);
    expect(off.dy).toBeGreaterThan(0);
  });

  it('count derived from total length / period: spikes appear at ~period spacing', () => {
    const period = baseSpikes.spikeWidth + baseSpikes.spacing;
    const N = Math.round(baseSpikes.totalLen / period);
    expect(N).toBeGreaterThanOrEqual(3);
    // Sample one full period; should hit one spike center and one gap.
    const step = baseSpikes.totalLen / N;
    // s=0 → spike center
    const a = spikesOffsetAt(0, baseSpikes);
    // s=step/2 → halfway between two centers; ds = step/2 > halfBase=5 → no contribution
    const b = spikesOffsetAt(step / 2, baseSpikes);
    expect(Math.hypot(a.dx, a.dy)).toBeGreaterThan(Math.hypot(b.dx, b.dy));
  });
});

describe('buildBubbles', () => {
  const attach = { x: 100, y: 100, nx: 1, ny: 0 };

  it('returns `count` bubbles when reach is generous, with falloff applied', () => {
    const bubbles = buildBubbles(attach, 4, 10, 0.7, 0.1, 1000, 0);
    expect(bubbles).toHaveLength(4);
    expect(bubbles[0].r).toBeCloseTo(10, 6);
    expect(bubbles[1].r).toBeCloseTo(7, 6);
    expect(bubbles[2].r).toBeCloseTo(4.9, 6);
    expect(bubbles[3].r).toBeCloseTo(3.43, 6);
  });

  it('centers advance along the outward normal (here: +x)', () => {
    const bubbles = buildBubbles(attach, 3, 10, 0.7, 0, 1000, 0);
    expect(bubbles.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < bubbles.length; i++) {
      expect(bubbles[i].cx).toBeGreaterThan(bubbles[i - 1].cx);
      expect(bubbles[i].cy).toBeCloseTo(100, 6);
    }
  });
});

describe('buildCloudPuffs', () => {
  it('returns `count` puffs at deterministic positions for a given seed', () => {
    const sampler = buildEllipse(120, 80);
    const density = (8 * 100) / sampler.totalLen;
    const puffs1 = buildCloudPuffs({
      density,
      puffSize: 20,
      sizeJitter: 0.3,
      posJitter: 0.3,
      seed: 42,
      totalLen: sampler.totalLen,
      perimeterAt: sampler.perimeterAt,
    });
    const puffs2 = buildCloudPuffs({
      density,
      puffSize: 20,
      sizeJitter: 0.3,
      posJitter: 0.3,
      seed: 42,
      totalLen: sampler.totalLen,
      perimeterAt: sampler.perimeterAt,
    });
    expect(puffs1).toHaveLength(8);
    expect(puffs2).toHaveLength(8);
    for (let i = 0; i < puffs1.length; i++) {
      expect(puffs2[i].cx).toBeCloseTo(puffs1[i].cx, 6);
      expect(puffs2[i].cy).toBeCloseTo(puffs1[i].cy, 6);
      expect(puffs2[i].r).toBeCloseTo(puffs1[i].r, 6);
    }
  });

  it('centers offset inward by r/2 along the inward normal', () => {
    const sampler = flatLineSampler(400);
    const puffs = buildCloudPuffs({
      density: (4 * 100) / sampler.totalLen,
      puffSize: 20,
      sizeJitter: 0, // strict positions, no jitter
      posJitter: 0,
      seed: 1,
      totalLen: sampler.totalLen,
      perimeterAt: sampler.perimeterAt,
    });
    // Flat sampler: y=0, outward normal n=(0,1). Inward = -n = (0,-1).
    // Expected center y = 0 - 1 * (r/2) = -r/2.
    for (const p of puffs) {
      expect(p.r).toBeCloseTo(20, 6);
      expect(p.cy).toBeCloseTo(-p.r / 2, 6);
    }
  });
});

describe('lobesOffsetAt / wobbleOffsetAt / jitterOffsetAt bounds', () => {
  const sampler = flatLineSampler(600);

  it('lobesOffsetAt magnitude ≤ depth', () => {
    const cfg = {
      count: 6,
      depth: 12,
      phase: 0,
      totalLen: sampler.totalLen,
      perimeterAt: sampler.perimeterAt,
    };
    for (let i = 0; i < 200; i++) {
      const s = (i / 200) * sampler.totalLen;
      const o = lobesOffsetAt(s, cfg);
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(cfg.depth + EPS);
    }
  });

  it('wobbleOffsetAt magnitude ≤ amplitude', () => {
    const cfg = {
      frequency: 3,
      amplitude: 7,
      phase: 0.25,
      totalLen: sampler.totalLen,
      perimeterAt: sampler.perimeterAt,
    };
    for (let i = 0; i < 200; i++) {
      const s = (i / 200) * sampler.totalLen;
      const o = wobbleOffsetAt(s, cfg);
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(cfg.amplitude + EPS);
    }
  });

  it('jitterOffsetAt magnitude ≤ amount', () => {
    const cfg = {
      amount: 4,
      density: 50,
      seed: 7,
      totalLen: sampler.totalLen,
      perimeterAt: sampler.perimeterAt,
    };
    for (let i = 0; i < 500; i++) {
      const s = (i / 500) * sampler.totalLen;
      const o = jitterOffsetAt(s, cfg);
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(cfg.amount + EPS);
    }
  });
});
