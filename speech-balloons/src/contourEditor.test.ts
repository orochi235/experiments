import { describe, it, expect } from 'vitest';
import { remapAcrossPartition, SEAM_X_EPS } from './contourEditor';

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
