import { describe, it, expect } from 'vitest';
import { computeStops, hexToLinear, linearToHex } from './litBevelShading';
import type { Region } from './bevelRegions';
import type { LitBevelLight, LitBevelMaterial } from './litBevelShading';

const stripAt = (azimuthDeg: number, x0 = 0, x1 = 0.4): Region => ({
  kind: 'strip',
  outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  azimuthDeg, x0, x1,
  frame: { kind: 'linear', from: { x: 5, y: 0 }, to: { x: 5, y: 10 } },
});

const panelAt = (azimuthDeg: number, x0 = 0.4, x1 = 1): Region =>
  ({ ...stripAt(azimuthDeg, x0, x1), kind: 'panel' });

// default contour [0,0, 0.5,0.8, 1,1] as a ContourFn (piecewise linear)
const rampContour = (x: number) => (x <= 0.5 ? (x / 0.5) * 0.8 : 0.8 + ((x - 0.5) / 0.5) * 0.2);
const flatContour = (_x: number) => 1;

const white = (az: number, el: number, intensity = 1): LitBevelLight =>
  ({ az, el, intensity, color: '#ffffff' });

const mat = (over: Partial<LitBevelMaterial> = {}): LitBevelMaterial => ({
  base: '#ffffff', heightPx: 20, dMaxPx: 50,
  diffuse: 1, specular: 0, shininess: 30,
  specularColor: '#ffffff', ambient: 0,
  ...over,
});

function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('hex/linear round trip', () => {
  it('round-trips primaries', () => {
    for (const h of ['#000000', '#ffffff', '#4a90d9', '#808080']) {
      expect(linearToHex(hexToLinear(h))).toBe(h);
    }
  });
});

describe('computeStops', () => {
  it('flat contour: intensity is exactly sin(elevation), azimuth-independent', () => {
    const lights = [white(270, 30)];
    const a = computeStops(stripAt(0), lights, flatContour, mat());
    const b = computeStops(stripAt(137), lights, flatContour, mat());
    const expected = linearToHex([0.5, 0.5, 0.5]); // sin 30° = 0.5 on white albedo
    for (const stops of [a, b]) {
      for (const s of stops) expect(s.color).toBe(expected);
    }
  });

  it('excluding all lights and specular leaves exactly ambient × albedo', () => {
    const lights = [white(270, 55), white(90, 25, 0.35)];
    const m = mat({ base: '#4a90d9', ambient: 0.25, specular: 0.6 });
    const stops = computeStops(stripAt(0), lights, rampContour, m,
      new Set(['light-0', 'light-1', 'specular']));
    const albedo = hexToLinear('#4a90d9');
    const expected = linearToHex([albedo[0] * 0.25, albedo[1] * 0.25, albedo[2] * 0.25]);
    for (const s of stops) expect(s.color).toBe(expected);
  });

  it('strip↔panel continuity: shared-boundary colors are identical', () => {
    const lights = [white(270, 55), white(90, 25, 0.35)];
    const m = mat({ base: '#4a90d9', ambient: 0.2, specular: 0.6 });
    const strip = computeStops(stripAt(200, 0, 0.4), lights, rampContour, m);
    const panel = computeStops(panelAt(200, 0.4, 1), lights, rampContour, m);
    expect(strip[strip.length - 1]!.color).toBe(panel[0]!.color);
  });

  it('adding a light never darkens any stop', () => {
    const one = computeStops(stripAt(45), [white(270, 55)], rampContour, mat());
    const two = computeStops(stripAt(45), [white(270, 55), white(90, 25, 0.35)], rampContour, mat());
    for (let i = 0; i < one.length; i++) {
      expect(luminance(two[i]!.color)).toBeGreaterThanOrEqual(luminance(one[i]!.color) - 1e-9);
    }
  });

  it('excluding specular never brightens any stop', () => {
    const m = mat({ specular: 1, base: '#4a90d9', ambient: 0.2 });
    const withSpec = computeStops(stripAt(270), [white(270, 55)], rampContour, m);
    const noSpec = computeStops(stripAt(270), [white(270, 55)], rampContour, m, new Set(['specular']));
    for (let i = 0; i < withSpec.length; i++) {
      expect(luminance(noSpec[i]!.color)).toBeLessThanOrEqual(luminance(withSpec[i]!.color) + 1e-9);
    }
  });

  it('solid frame yields two identical stops', () => {
    const flat: Region = {
      kind: 'flat', outline: [], azimuthDeg: 0, x0: 1, x1: 1, frame: { kind: 'solid' },
    };
    const stops = computeStops(flat, [white(270, 55)], rampContour, mat());
    expect(stops).toHaveLength(2);
    expect(stops[0]!.color).toBe(stops[1]!.color);
  });
});
