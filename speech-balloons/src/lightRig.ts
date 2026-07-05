// Scene light rig: defaults, bounds, and the localStorage migration that
// lifts pre-rig fill params (lightAzimuth/lightElevation/lightColor/
// lightAngle) into DesignState.lights. Spec:
// docs/superpowers/specs/2026-07-03-light-rig-design.md
import type { LightInstance } from './types';

export const MIN_LIGHTS = 1;
export const MAX_LIGHTS = 6;

// Matches the old hardcoded pair in SpeechBalloon exactly, so migrated and
// fresh scenes render pixel-identical to the pre-rig renderer.
export function defaultLights(): LightInstance[] {
  return [
    { az: 270, el: 55, intensity: 1.0, color: '#ffffff' },
    { az: 90, el: 25, intensity: 0.35, color: '#ffffff' },
  ];
}

export function newLight(): LightInstance {
  return { az: 90, el: 45, intensity: 0.5, color: '#ffffff' };
}

/**
 * In-place workspace-config migration. Synthesizes `config.lights` from the
 * first fill effect's legacy light params and deletes those params.
 * Returns true when it changed anything (caller persists only when dirty).
 */
export function ensureLights(config: Record<string, unknown>): boolean {
  if (Array.isArray(config.lights)) return false;

  const effects = Array.isArray(config.effects)
    ? (config.effects as Array<{ kind?: string; params?: Record<string, unknown> }>)
    : [];
  const fill = effects.find((e) => e?.kind === 'fill');
  const p = fill?.params ?? {};

  const isAqua = p.mode === 'aqua';
  const azRaw = isAqua ? p.lightAngle : p.lightAzimuth;
  const az = typeof azRaw === 'number' ? azRaw : 270;
  const el = typeof p.lightElevation === 'number' && !isAqua ? p.lightElevation : 55;
  const color = typeof p.lightColor === 'string' ? p.lightColor : '#ffffff';

  config.lights = [
    { az, el, intensity: 1.0, color },
    { az: (az + 180) % 360, el: 25, intensity: 0.35, color: '#ffffff' },
  ] satisfies LightInstance[];

  if (fill?.params) {
    delete fill.params.lightAzimuth;
    delete fill.params.lightElevation;
    delete fill.params.lightColor;
    delete fill.params.lightAngle;
  }
  return true;
}
