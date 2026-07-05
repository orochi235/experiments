import { describe, expect, it } from 'vitest';
import { defaultLights, ensureLights, MAX_LIGHTS, MIN_LIGHTS, newLight } from './lightRig';

describe('defaultLights', () => {
  it('reproduces the old hardcoded pair', () => {
    expect(defaultLights()).toEqual([
      { az: 270, el: 55, intensity: 1.0, color: '#ffffff' },
      { az: 90, el: 25, intensity: 0.35, color: '#ffffff' },
    ]);
  });
  it('returns a fresh array each call', () => {
    expect(defaultLights()).not.toBe(defaultLights());
  });
});

describe('constants', () => {
  it('bounds', () => {
    expect(MIN_LIGHTS).toBe(1);
    expect(MAX_LIGHTS).toBe(6);
    expect(newLight()).toEqual({ az: 90, el: 45, intensity: 0.5, color: '#ffffff' });
  });
});

describe('ensureLights (workspace config migration)', () => {
  it('synthesizes the rig from dome/brdf/lit-bevel fill params and strips them', () => {
    const config: Record<string, unknown> = {
      effects: [
        { id: 1, kind: 'fill', params: { mode: 'lit-bevel', lightAzimuth: 300, lightElevation: 40, lightColor: '#ff0000', lightAngle: 15 } },
      ],
    };
    expect(ensureLights(config)).toBe(true);
    expect(config.lights).toEqual([
      { az: 300, el: 40, intensity: 1.0, color: '#ff0000' },
      { az: 120, el: 25, intensity: 0.35, color: '#ffffff' },
    ]);
    const params = (config.effects as Array<{ params: Record<string, unknown> }>)[0]!.params;
    expect(params.lightAzimuth).toBeUndefined();
    expect(params.lightElevation).toBeUndefined();
    expect(params.lightColor).toBeUndefined();
    expect(params.lightAngle).toBeUndefined();
  });

  it('uses lightAngle for aqua fills', () => {
    const config: Record<string, unknown> = {
      effects: [{ id: 1, kind: 'fill', params: { mode: 'aqua', lightAngle: 30, lightAzimuth: 300 } }],
    };
    ensureLights(config);
    expect((config.lights as Array<{ az: number }>)[0]!.az).toBe(30);
  });

  it('falls back to defaults when params are absent or there is no fill', () => {
    const noParams: Record<string, unknown> = { effects: [{ id: 1, kind: 'fill', params: {} }] };
    ensureLights(noParams);
    expect(noParams.lights).toEqual(defaultLights());

    const noFill: Record<string, unknown> = { effects: [{ id: 2, kind: 'tail', params: {} }] };
    ensureLights(noFill);
    expect(noFill.lights).toEqual(defaultLights());
  });

  it('is a no-op when lights already exist (returns false, params untouched)', () => {
    const config: Record<string, unknown> = {
      lights: [{ az: 10, el: 20, intensity: 0.5, color: '#00ff00' }],
      effects: [{ id: 1, kind: 'fill', params: { lightAzimuth: 300 } }],
    };
    expect(ensureLights(config)).toBe(false);
    expect((config.lights as unknown[]).length).toBe(1);
    // Old params survive untouched when we didn't migrate — never half-migrate.
    expect((config.effects as Array<{ params: Record<string, unknown> }>)[0]!.params.lightAzimuth).toBe(300);
  });
});
