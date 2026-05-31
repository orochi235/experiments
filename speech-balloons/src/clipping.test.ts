import { describe, it, expect } from 'vitest';
import {
  unionPolygons,
  differencePolygons,
  offsetClosedPolygons,
  polygonsToSvgPath,
  type Polygon,
} from './clipping';

const EPS = 1e-3;

function polygonArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function totalArea(polys: Polygon[]): number {
  return polys.reduce((acc, p) => acc + polygonArea(p), 0);
}

function square(x: number, y: number, w: number, h: number, cw = false): Polygon {
  const pts: Polygon = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return cw ? pts : pts.slice().reverse();
}

describe('unionPolygons', () => {
  it('union of two overlapping CCW squares = single polygon with combined-minus-overlap area', () => {
    const a = square(0, 0, 10, 10);
    const b = square(5, 5, 10, 10);
    const result = unionPolygons([a, b]);
    expect(result).toHaveLength(1);
    const overlap = 5 * 5;
    const expected = 10 * 10 + 10 * 10 - overlap;
    expect(totalArea(result)).toBeCloseTo(expected, 2);
  });

  it('normalizes mixed windings so result is the geometric union (not XOR)', () => {
    const a = square(0, 0, 10, 10, false); // CCW
    const b = square(5, 5, 10, 10, true);  // CW
    const result = unionPolygons([a, b]);
    expect(result).toHaveLength(1);
    const overlap = 5 * 5;
    const expected = 10 * 10 + 10 * 10 - overlap;
    expect(totalArea(result)).toBeCloseTo(expected, 2);
  });
});

describe('differencePolygons', () => {
  it('subtracts a clip square from a subject square', () => {
    const subject = square(0, 0, 10, 10);
    const clip = square(5, 5, 10, 10);
    const result = differencePolygons([subject], [clip]);
    // subject is 100; overlap is 25; so result area = 75.
    expect(totalArea(result)).toBeCloseTo(75, 2);
  });
});

describe('offsetClosedPolygons', () => {
  it('positive offset grows area; round join smooths corners', () => {
    const poly = square(0, 0, 10, 10);
    const result = offsetClosedPolygons([poly], 2, 'round');
    expect(result.length).toBeGreaterThan(0);
    expect(totalArea(result)).toBeGreaterThan(100);
  });

  it('negative offset shrinks area', () => {
    const poly = square(0, 0, 10, 10);
    const result = offsetClosedPolygons([poly], -2, 'round');
    expect(result.length).toBeGreaterThan(0);
    // 6x6 inner square minus rounded — area roughly 36, but allow slack.
    expect(totalArea(result)).toBeLessThan(100);
    expect(totalArea(result)).toBeGreaterThan(0);
  });
});

describe('polygonsToSvgPath', () => {
  it('produces a valid "M ... Z" string per polygon', () => {
    const a = square(0, 0, 10, 10);
    const path = polygonsToSvgPath([a]);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    // 4 vertices → 1 M + 3 L + 1 Z
    expect((path.match(/L /g) || []).length).toBe(3);
  });

  it('chains multiple polygons in one compound string, each ending with Z', () => {
    const a = square(0, 0, 5, 5);
    const b = square(20, 20, 5, 5);
    const path = polygonsToSvgPath([a, b]);
    expect((path.match(/M /g) || []).length).toBe(2);
    expect((path.match(/Z/g) || []).length).toBe(2);
  });

  it('returns "" for an empty input', () => {
    expect(polygonsToSvgPath([])).toBe('');
  });
});

// Sanity helper unused — silence unused warnings in strict TS configs.
void EPS;
