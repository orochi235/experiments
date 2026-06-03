import { describe, it, expect } from 'vitest';
import { computeLitArcs, domeSurfaceTilt, subdivideArc, buildSliceWedgePath, type PerimeterSampler } from './SpeechBalloon';

const unitCircleAt = (cx: number, cy: number, r: number): PerimeterSampler => (angle) => ({
  x: cx + Math.cos(angle) * r,
  y: cy + Math.sin(angle) * r,
  nx: Math.cos(angle),
  ny: Math.sin(angle),
});

describe('computeLitArcs', () => {
  it('lights ~half the circle for a horizontal light', () => {
    const arcs = computeLitArcs(unitCircleAt(0, 0, 50), 0, 0, 240);
    const total = arcs.reduce((sum, a) => sum + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI)), 0);
    expect(total).toBeGreaterThan(Math.PI * 0.95);
    expect(total).toBeLessThan(Math.PI * 1.05);
  });

  it('still lights ~half the perimeter at high elevation (60°)', () => {
    // Elevation attenuates the in-plane magnitude but the terminator stays
    // at azimuth ± 90° in this v1 approximation, so the lit arc length
    // doesn't change with elevation — only intensity does.
    const arcs = computeLitArcs(unitCircleAt(0, 0, 50), 0, 60, 240);
    const total = arcs.reduce((sum, a) => sum + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI)), 0);
    expect(total).toBeGreaterThan(Math.PI * 0.95);
    expect(total).toBeLessThan(Math.PI * 1.05);
  });

  it('exactly-overhead light has degenerate (empty) lit arcs in v1', () => {
    // Documented limitation: with the rim's outward normal taken as in-plane,
    // a perfectly overhead light has zero horizontal component and dots to
    // zero with every rim sample. Refined when the lit-arc math grows
    // contour-driven tilt.
    const arcs = computeLitArcs(unitCircleAt(0, 0, 50), 0, 90, 240);
    expect(arcs).toHaveLength(0);
  });

  it('shadow side returns no arcs', () => {
    const sampler: PerimeterSampler = () => ({ x: 0, y: 0, nx: -1, ny: 0 });
    const arcs = computeLitArcs(sampler, 0, 0, 240);
    expect(arcs).toHaveLength(0);
  });
});

describe('domeSurfaceTilt', () => {
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const rad = (d: number) => (d * Math.PI) / 180;

  it('returns rimTilt at the rim regardless of crown/bw', () => {
    expect(deg(domeSurfaceTilt(1, rad(30), 0.5, 0.2))).toBeCloseTo(30, 5);
    expect(deg(domeSurfaceTilt(1, rad(0), 1, 1))).toBeCloseTo(0, 5);
    expect(deg(domeSurfaceTilt(1, rad(45), 0, 0.1))).toBeCloseTo(45, 5);
  });

  it('is uniform at rimTilt when crownHeight is 0', () => {
    expect(deg(domeSurfaceTilt(0.5, rad(20), 0, 0.3))).toBeCloseTo(20, 5);
    expect(deg(domeSurfaceTilt(0, rad(20), 0, 0.3))).toBeCloseTo(20, 5);
  });

  it('reaches 90° at the centroid for full crown + no bevel band', () => {
    // crownHeight=1, bwNorm=1 → pure ramp from rimTilt at r=1 to 90° at r=0.
    expect(deg(domeSurfaceTilt(0, rad(0), 1, 1))).toBeCloseTo(90, 5);
    expect(deg(domeSurfaceTilt(0.5, rad(0), 1, 1))).toBeCloseTo(45, 5);
  });

  it('holds rimTilt across the bevel band', () => {
    // bwNorm=0.1 → rBevel=0.9. r in [0.9, 1] is bevel face at rimTilt.
    expect(deg(domeSurfaceTilt(0.95, rad(0), 1, 0.1))).toBeCloseTo(0, 5);
    expect(deg(domeSurfaceTilt(0.9, rad(0), 1, 0.1))).toBeCloseTo(0, 5);
  });

  it('ramps inside the interior band', () => {
    // rimTilt=0, crown=1, bwNorm=0.1 → crownTilt=90°, rBevel=0.9.
    // Interior: θ = lerp(crownTilt, rimTilt, r/rBevel).
    // r=0.5 → θ = lerp(90°, 0°, 0.5/0.9) = 90° · 4/9 = 40°.
    expect(deg(domeSurfaceTilt(0.5, rad(0), 1, 0.1))).toBeCloseTo(40, 1);
    // r=0 → 90°.
    expect(deg(domeSurfaceTilt(0, rad(0), 1, 0.1))).toBeCloseTo(90, 5);
  });

  it('clamps bwNorm to [0,1]', () => {
    expect(deg(domeSurfaceTilt(0.5, rad(0), 1, 5))).toBeCloseTo(45, 5); // same as bwNorm=1
    // bwNorm=-1 clamps to 0 → rBevel=1, interior ramp: lerp(90°, 20°, 0.5) = 55°
    expect(deg(domeSurfaceTilt(0.5, rad(20), 1, -1))).toBeCloseTo(55, 1);
  });
});

describe('computeLitArcs with rimTilt', () => {
  const rad = (d: number) => (d * Math.PI) / 180;

  it('matches v1 behavior when rimTilt is 0 (backwards compat)', () => {
    const sampler = unitCircleAt(0, 0, 50);
    const v1 = computeLitArcs(sampler, 0, 0, 240);                    // implicit rimTilt=0
    const tilted = computeLitArcs(sampler, 0, 0, 240, 0);              // explicit 0
    expect(tilted).toEqual(v1);
  });

  it('rimTilt = 90° + any positive elevation lights the whole rim', () => {
    const sampler = unitCircleAt(0, 0, 50);
    const arcs = computeLitArcs(sampler, 0, 30, 240, rad(90));
    const total = arcs.reduce(
      (sum, a) => sum + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI),
      0,
    );
    expect(total).toBeCloseTo(2 * Math.PI, 1);
  });

  it('rimTilt = 45° widens the lit arc beyond half for elevated light', () => {
    // Light from +x, elevation 30°. With rimTilt=0 the lit arc is ~π.
    // With rimTilt=45° the upward component of N catches more rim.
    const sampler = unitCircleAt(0, 0, 50);
    const flat = computeLitArcs(sampler, 0, 30, 240, 0);
    const tilted = computeLitArcs(sampler, 0, 30, 240, rad(45));
    const sumOf = (arcs: { start: number; end: number }[]) =>
      arcs.reduce(
        (s, a) => s + ((a.end - a.start + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI),
        0,
      );
    expect(sumOf(tilted)).toBeGreaterThan(sumOf(flat));
  });

  it('rimTilt = 90° + elevation 0 leaves the rim dark', () => {
    // Normal points straight up; light is horizontal → N·L = 0.
    const sampler = unitCircleAt(0, 0, 50);
    const arcs = computeLitArcs(sampler, 0, 0, 240, rad(90));
    expect(arcs).toHaveLength(0);
  });
});

import { sampleLightStops, type ContourFn } from './SpeechBalloon';

describe('sampleLightStops', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const unitContour: ContourFn = () => 1;     // no painterly modulation

  it('peaks at lit rim for a horizontal light, flat surface', () => {
    const stops = sampleLightStops({
      azimuthDeg: 0,
      elevationDeg: 0,
      rimTiltRad: 0,
      crownHeight: 0,
      rLit: 100,
      rFar: 100,
      bevelWidthPx: 0,
      contour: unitContour,
      samples: 16,
    });
    const max = stops.reduce((m, s) => (s.opacity > m.opacity ? s : m));
    expect(max.offset).toBeCloseTo(0, 5);
    expect(stops[stops.length - 1]!.opacity).toBeCloseTo(0, 5);
  });

  it('shifts the bright spot toward centroid for an overhead light + dome crown', () => {
    const stops = sampleLightStops({
      azimuthDeg: 0,
      elevationDeg: 90,
      rimTiltRad: 0,
      crownHeight: 1,
      rLit: 100,
      rFar: 100,
      bevelWidthPx: 100,                       // full ramp, no bevel face
      contour: unitContour,
      samples: 16,
    });
    const max = stops.reduce((m, s) => (s.opacity > m.opacity ? s : m));
    expect(max.offset).toBeGreaterThan(0.4);
    expect(max.offset).toBeLessThan(0.6);
  });

  it('emits SAMPLES+1 stops with strictly increasing offsets', () => {
    const stops = sampleLightStops({
      azimuthDeg: 45,
      elevationDeg: 30,
      rimTiltRad: rad(20),
      crownHeight: 0.4,
      rLit: 100,
      rFar: 100,
      bevelWidthPx: 20,
      contour: unitContour,
      samples: 16,
    });
    expect(stops).toHaveLength(17);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.offset).toBeGreaterThan(stops[i - 1]!.offset);
    }
  });

  it('shifts the centroid offset for asymmetric rLit/rFar', () => {
    // Wide-on-lit-side body: rLit much larger than rFar. The centroid
    // (peak brightness for an overhead light + full dome) should sit at
    // s ≈ rLit / (rLit + rFar) = 200 / 300 ≈ 0.67.
    const stops = sampleLightStops({
      azimuthDeg: 0,
      elevationDeg: 90,
      rimTiltRad: 0,
      crownHeight: 1,
      rLit: 200,
      rFar: 100,
      bevelWidthPx: 300,
      contour: unitContour,
      samples: 32,
    });
    const max = stops.reduce((m, s) => (s.opacity > m.opacity ? s : m));
    expect(max.offset).toBeGreaterThan(0.55);
    expect(max.offset).toBeLessThan(0.78);
  });
});

describe('subdivideArc', () => {
  // Circle of radius 50 centered at origin; angleSampler returns the rim
  // point in the centroid-radial direction `a`.
  const circle: PerimeterSampler = (a) => ({
    x: 50 * Math.cos(a),
    y: 50 * Math.sin(a),
    nx: Math.cos(a),
    ny: Math.sin(a),
  });

  it('returns N+1 angles spanning [a0, a1] with N >= min', () => {
    const out = subdivideArc(circle, 0, Math.PI / 4, [0, 0], 8, 4, 32);
    // Arc length on a circle of r=50 over a π/4 span:
    // s = 50 * (π/4) ≈ 39.27 → N = ceil(39.27 / 8) = 5; clamp to >=4 → 5.
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[out.length - 1]).toBeCloseTo(Math.PI / 4, 9);
    for (let i = 1; i < out.length; i++) {
      expect(out[i] - out[i - 1]).toBeCloseTo((Math.PI / 4) / 5, 9);
    }
  });

  it('clamps to min when the arc is very short', () => {
    const out = subdivideArc(circle, 0, 0.01, [0, 0], 8, 4, 32);
    expect(out.length).toBe(5); // N = 4 → 5 angles
  });

  it('clamps to max when the arc is very long', () => {
    const out = subdivideArc(circle, 0, 2 * Math.PI, [0, 0], 1, 4, 32);
    expect(out.length).toBe(33);
  });
});

describe('buildSliceWedgePath', () => {
  const circle: PerimeterSampler = (a) => ({
    x: 100 + 50 * Math.cos(a),
    y: 100 + 50 * Math.sin(a),
    nx: Math.cos(a),
    ny: Math.sin(a),
  });

  it('starts at centroid, samples along the arc, closes the path', () => {
    const d = buildSliceWedgePath(circle, 0, Math.PI / 6, [100, 100], Math.PI / 60);
    expect(d.startsWith('M 100 100')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // π/6 / (π/60) = 10 → at least 10 L segments to perimeter.
    const lCount = (d.match(/ L /g) ?? []).length;
    expect(lCount).toBeGreaterThanOrEqual(10);
  });

  it('first perimeter sample is at angle a0', () => {
    const d = buildSliceWedgePath(circle, 0, Math.PI / 6, [100, 100], Math.PI / 60);
    // After "M 100 100", the next "L x y" should be the rim point at a=0:
    // (100 + 50, 100 + 0) = (150, 100).
    expect(d).toMatch(/M 100 100 L 150 100/);
  });
});
