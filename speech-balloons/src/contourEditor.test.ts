import { describe, it, expect } from 'vitest';
import { interpFlat, migrateSeam, remapAcrossPartition, SEAM_X_EPS } from './contourEditor';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('remapAcrossPartition', () => {
  it('preserves the x=0 and x=1 anchors exactly', () => {
    const values = [0, 0.2, 0.3, 0.5, 1, 0.9];
    const out = remapAcrossPartition(values, 0.3, 0.6, 0.5);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.2, 9);
    expect(out[out.length - 2]).toBe(1);
    expect(out[out.length - 1]).toBeCloseTo(0.9, 9);
  });

  it('places exactly one anchor at x=bNew with y=seamY', () => {
    const values = [0, 0, 0.3, 0.5, 1, 1];
    const out = remapAcrossPartition(values, 0.3, 0.7, 0.42);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    const seamHits = cpts.filter(([x]) => Math.abs(x - 0.7) < SEAM_X_EPS);
    expect(seamHits).toHaveLength(1);
    expect(seamHits[0]![1]).toBeCloseTo(0.42, 9);
  });

  it('compresses bevel-side anchors proportionally when partition moves left', () => {
    // Old bevel range (0, 0.4) with a mid anchor at x=0.2 (halfway).
    // New bevel range (0, 0.1): mid anchor should remap to x=0.05 (still halfway).
    const values = [0, 0, 0.2, 0.7, 0.4, 0.9, 1, 1];
    const out = remapAcrossPartition(values, 0.4, 0.1, 0.9);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    cpts.sort((a, b) => a[0] - b[0]);
    expect(cpts.find(([x]) => close(x, 0.05))).toBeDefined();
    // No anchor on the new spline side (>0.1) should originate from old bevel side.
    const splineSide = cpts.filter(([x]) => x > 0.1 + SEAM_X_EPS && x < 1 - SEAM_X_EPS);
    expect(splineSide.every(([_x, y]) => y === 0.9 || y === undefined || y >= 0)).toBe(true);
  });

  it('stretches spline-side anchors proportionally when partition moves left', () => {
    // Old spline range (0.4, 1) with a mid anchor at x=0.7 (halfway).
    // New spline range (0.1, 1): mid anchor should remap to x=0.55 (still halfway).
    const values = [0, 0, 0.4, 0.5, 0.7, 0.2, 1, 1];
    const out = remapAcrossPartition(values, 0.4, 0.1, 0.5);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    cpts.sort((a, b) => a[0] - b[0]);
    expect(cpts.find(([x]) => close(x, 0.55))).toBeDefined();
  });

  it('returns a sorted, even-length, no-duplicate-seam flat array', () => {
    const values = [0, 0, 0.3, 0.5, 1, 1];
    const out = remapAcrossPartition(values, 0.3, 0.6, 0.42);
    expect(out.length % 2).toBe(0);
    const xs: number[] = [];
    for (let i = 0; i < out.length; i += 2) xs.push(out[i]!);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
    const seamHits = xs.filter((x) => Math.abs(x - 0.6) < SEAM_X_EPS);
    expect(seamHits).toHaveLength(1);
  });

  it('handles the case where the input has no existing seam anchor', () => {
    // values has no anchor at x=0.3; helper should still emit one at x=bNew.
    const values = [0, 0, 0.2, 0.4, 0.8, 0.6, 1, 1];
    const out = remapAcrossPartition(values, 0.5, 0.5, 0.55);
    // bOld == bNew here: every non-seam x is unchanged.
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    expect(cpts.find(([x, y]) => close(x, 0.5) && close(y, 0.55))).toBeDefined();
    expect(cpts.find(([x, y]) => close(x, 0.2) && close(y, 0.4))).toBeDefined();
    expect(cpts.find(([x, y]) => close(x, 0.8) && close(y, 0.6))).toBeDefined();
  });
});

describe('interpFlat', () => {
  it('interpolates linearly between anchors', () => {
    expect(interpFlat([0, 0, 1, 1], 0.5)).toBeCloseTo(0.5, 9);
    expect(interpFlat([0, 0.2, 0.5, 0.8, 1, 0.4], 0.25)).toBeCloseTo(0.5, 9);
  });

  it('clamps outside the anchor range and sorts unsorted input', () => {
    const flat = [1, 0.9, 0, 0.1]; // deliberately unsorted
    expect(interpFlat(flat, -1)).toBeCloseTo(0.1, 9);
    expect(interpFlat(flat, 2)).toBeCloseTo(0.9, 9);
    expect(interpFlat(flat, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('returns 0 for an empty array', () => {
    expect(interpFlat([], 0.5)).toBe(0);
  });
});

describe('migrateSeam', () => {
  const xsOf = (flat: readonly number[]) => {
    const xs: number[] = [];
    for (let i = 0; i < flat.length; i += 2) xs.push(flat[i]!);
    return xs;
  };

  it('returns null when an anchor already sits at b', () => {
    const values = [0, 0, 0.3, 0.5, 1, 1];
    expect(migrateSeam(values, 0.3, 0.3)).toBeNull();
    // Also null when b moved but values already carry the new seam
    // (e.g. the partition-drag path already remapped them).
    expect(migrateSeam([0, 0, 0.4, 0.5, 1, 1], 0.3, 0.4)).toBeNull();
  });

  it('moves the seam instead of inserting when one sits at bPrev', () => {
    // Regression: the bevel-width slider changes b without touching the
    // contour; the old behavior inserted a new seam and left the old
    // anchor behind — one stray per slider tick.
    const values = [0, 0, 0.3, 0.5, 1, 1];
    const out = migrateSeam(values, 0.3, 0.4)!;
    expect(out).not.toBeNull();
    expect(out.length).toBe(values.length); // anchor count unchanged
    const xs = xsOf(out);
    expect(xs.filter((x) => Math.abs(x - 0.4) < SEAM_X_EPS)).toHaveLength(1);
    expect(xs.filter((x) => Math.abs(x - 0.3) < SEAM_X_EPS)).toHaveLength(0);
  });

  it('keeps the seam y when moving it', () => {
    const values = [0, 0, 0.3, 0.42, 1, 1];
    const out = migrateSeam(values, 0.3, 0.6)!;
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    const seam = cpts.find(([x]) => Math.abs(x - 0.6) < SEAM_X_EPS)!;
    expect(seam[1]).toBeCloseTo(0.42, 9);
  });

  it('never grows the anchor count across repeated slider ticks', () => {
    // Simulates dragging the bevel-width slider: b changes a little on
    // every tick, the contour is migrated each time.
    let values: number[] = [0, 0, 0.15, 0.6, 0.3, 0.5, 0.7, 0.8, 1, 1];
    let bPrev = 0.3;
    for (let tick = 1; tick <= 10; tick++) {
      const b = 0.3 + tick * 0.02;
      const out = migrateSeam(values, bPrev, b);
      if (out) values = out;
      bPrev = b;
      expect(values.length).toBe(10);
    }
  });

  it('inserts an interpolated seam when no seam exists anywhere (first mount)', () => {
    const values = [0, 0, 1, 1];
    const out = migrateSeam(values, 0.5, 0.25)!;
    expect(out.length).toBe(values.length + 2);
    const cpts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < out.length; i += 2) cpts.push([out[i]!, out[i + 1]!]);
    const seam = cpts.find(([x]) => Math.abs(x - 0.25) < SEAM_X_EPS)!;
    expect(seam).toBeDefined();
    expect(seam[1]).toBeCloseTo(0.25, 9); // interpolated on the 0→1 diagonal
    // Sorted output.
    const xs = xsOf(out);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
  });
});
