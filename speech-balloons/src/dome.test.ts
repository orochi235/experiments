import { describe, it, expect } from 'vitest';
import { computeLitArcs, type PerimeterSampler } from './SpeechBalloon';

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
