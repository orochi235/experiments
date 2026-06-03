import { bareBaseMaxBevel, type BaseSampler } from './geometry';
import type { BalloonBase, EffectKind, ParamBag } from './types';

export type LabControl =
  | { key: string; label?: string; kind: 'range'; min: number; max: number; step: number; default: number; hideWhen?: (params: ParamBag) => boolean; maxFn?: (ctx: { W: number; H: number; sampler?: BaseSampler }) => number; unit?: string; format?: (v: number) => string }
  | { key: string; label?: string; kind: 'select'; options: string[]; default: string; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'color'; default: string; alpha?: boolean; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'text'; default: string; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'toggle'; default: boolean; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'curve'; min: number; max: number; step: number; defaults: number[]; hideWhen?: (params: ParamBag) => boolean }
  | { kind: 'header'; label: string; hideWhen?: (params: ParamBag) => boolean };

export const BASE_CONTROLS: Record<BalloonBase, LabControl[]> = {
  rectangle: [
    // Fraction of half the shorter edge: 0 = sharp corners, 1 = pill shape.
    { key: 'roundness', label: 'Roundness', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  oval: [],
  polygon: [
    { key: 'sides', label: 'Sides', kind: 'range', min: 3, max: 12, step: 1, default: 6 },
    { key: 'roundness', label: 'Roundness', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  cloud: [
    { key: 'lobes', label: 'Lobes', kind: 'range', min: 4, max: 16, step: 1, default: 8 },
    { key: 'lobeDepth', label: 'Lobe depth', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.4 },
  ],
};

export const EFFECT_CONTROLS: Record<EffectKind, LabControl[]> = {
  fill: [
    { key: 'mode', label: 'Mode', kind: 'select',
      options: ['aqua', 'dome'],
      default: 'dome' },
    { key: 'base', label: 'Base color', kind: 'color', default: '#3b82f6' },

    { kind: 'header', label: 'Aqua', hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'lightAngle', label: 'Light angle', kind: 'range', min: 0, max: 359, step: 1, default: 270, hideWhen: (p) => p.mode !== 'aqua', unit: '°' },
    { key: 'glossStrength', label: 'Gloss strength', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.55, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'rimContrast', label: 'Rim contrast', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.4, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'highlightTint', label: 'Highlight tint', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'shadowTint', label: 'Shadow tint', kind: 'color', default: '#0a1020', hideWhen: (p) => p.mode !== 'aqua' },

    { key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.6, hideWhen: (p) => p.mode !== 'dome' },
    { key: 'shadowColor', label: 'Shadow color', kind: 'color', default: '#000000', hideWhen: (p) => p.mode !== 'dome' },
    { key: 'highlightColor', label: 'Highlight color', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode !== 'dome' },

    { kind: 'header', label: 'Dome', hideWhen: (p) => p.mode !== 'dome' },
    { key: 'bevelWidth', label: 'Bevel width', kind: 'range', min: 0, max: 100, step: 0.5, default: 22, hideWhen: (p) => p.mode !== 'dome', maxFn: ({ W, H, sampler }) => sampler ? Math.max(1, Math.floor(bareBaseMaxBevel(sampler))) : Math.floor(Math.min(W, H) / 3), unit: 'px' },
    { key: 'lightAzimuth', label: 'Azimuth', kind: 'range', min: 0, max: 359, step: 1, default: 270, hideWhen: (p) => p.mode !== 'dome', unit: '°' },
    { key: 'lightElevation', label: 'Elevation', kind: 'range', min: 0, max: 90, step: 1, default: 55, hideWhen: (p) => p.mode !== 'dome', unit: '°' },
    { key: 'rimTilt', label: 'Rim tilt', kind: 'range', min: 0, max: 90, step: 1, default: 0, hideWhen: (p) => p.mode !== 'dome', unit: '°' },
    { key: 'crownHeight', label: 'Crown height', kind: 'range', min: 0, max: 1, step: 0.02, default: 0, hideWhen: (p) => p.mode !== 'dome' },
    { key: 'domeGloss', label: 'Gloss', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.35, hideWhen: (p) => p.mode !== 'dome' },
    { key: 'specStrength', label: 'Specular', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.5, hideWhen: (p) => p.mode !== 'dome' },
    { key: 'specSize', label: 'Specular size', kind: 'range', min: 2, max: 80, step: 0.5, default: 18, hideWhen: (p) => p.mode !== 'dome', unit: 'px' },

    {
      key: 'contour',
      label: 'Contour (rim → center)',
      kind: 'curve',
      min: -1,
      max: 1,
      step: 0.02,
      // Flat at y=1: neutral painterly multiplier. The dome shape comes
      // from physics (rimTilt/crownHeight/bevelWidth); the contour is an
      // optional override on top. Interleaved [x0,y0,x1,y1].
      defaults: [0, 1, 1, 1],
      hideWhen: (p) => p.mode !== 'dome',
    },
  ],

  tail: [
    { key: 'shape', label: 'Shape', kind: 'select', options: ['pointed', 'bubbles', 'lightning', 'wavy'], default: 'pointed' },
    { key: 'angle', label: 'Angle', kind: 'range', min: 0, max: 359, step: 1, default: 115, unit: '°' },
    // Tilt of the tail's outward direction relative to the body's normal
    // at the attach point. 0 = straight out from the body, -90/+90 = lays
    // along the perimeter tangent.
    { key: 'outAngle', label: 'Tip angle', kind: 'range', min: -90, max: 90, step: 1, default: 0, unit: '°' },
    { key: 'arc', label: 'Bend', kind: 'range', min: -1, max: 1, step: 0.02, default: 0 },
    { key: 'size', label: 'Length', kind: 'range', min: 8, max: 220, step: 0.5, default: 60, unit: 'px' },
    // Degrees of arc subtended at body center. baseWidth = 2·bodyRef·sin(deg/2).
    // Used for classic + lightning; bubbles uses its own bubbleDiameter (px).
    { key: 'baseAngle', label: 'Base width', kind: 'range', min: 3, max: 30, step: 0.5, default: 12, hideWhen: (p) => p.shape === 'bubbles', unit: '°' },
    { kind: 'header', label: 'Wavy', hideWhen: (p) => p.shape !== 'wavy' },
    { key: 'waveFreq', label: 'Frequency', kind: 'range', min: 0.5, max: 6, step: 0.1, default: 2, hideWhen: (p) => p.shape !== 'wavy' },
    { key: 'waveAmp', label: 'Amplitude', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.3, hideWhen: (p) => p.shape !== 'wavy' },
    { kind: 'header', label: 'Bubbles', hideWhen: (p) => p.shape !== 'bubbles' },
    { key: 'bubbleDiameter', label: 'Size', kind: 'range', min: 8, max: 120, step: 1, default: 30, hideWhen: (p) => p.shape !== 'bubbles', unit: 'px' },
    { key: 'count', label: 'Count', kind: 'range', min: 3, max: 8, step: 1, default: 3, hideWhen: (p) => p.shape !== 'bubbles' },
    { key: 'gap', label: 'Gap (fraction of size)', kind: 'range', min: -1, max: 1, step: 0.02, default: 0.15, hideWhen: (p) => p.shape !== 'bubbles' },
    { key: 'radial', label: 'Base distance', kind: 'range', min: -60, max: 60, step: 0.5, default: 0, hideWhen: (p) => p.shape !== 'bubbles', unit: 'px' },
    { kind: 'header', label: 'Lightning', hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'lightningStyle', label: 'Style', kind: 'select', options: ['jagged', 'zigzag'], default: 'jagged', hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'segments', label: 'Jags', kind: 'range', min: 2, max: 12, step: 1, default: 5, hideWhen: (p) => p.shape !== 'lightning' || p.lightningStyle === 'zigzag' },
    { key: 'zigs', label: 'Zigs', kind: 'range', min: 1, max: 8, step: 1, default: 2, hideWhen: (p) => p.shape !== 'lightning' || p.lightningStyle !== 'zigzag' },
    { key: 'jaggedness', label: 'Jaggedness', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.45, hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'widthTaper', label: 'Width taper', kind: 'range', min: 0.3, max: 4, step: 0.05, default: 1, hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'tipWidth', label: 'Tip width', kind: 'range', min: 0, max: 0.8, step: 0.02, default: 0, hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'seed', label: 'Seed', kind: 'range', min: 0, max: 99, step: 1, default: 7, hideWhen: (p) => p.shape !== 'lightning' || p.lightningStyle === 'zigzag' },
  ],

  spikes: [
    { key: 'spikeWidth', label: 'Spike width', kind: 'range', min: 1, max: 60, step: 0.5, default: 6, unit: 'px' },
    { key: 'spacing', label: 'Spacing', kind: 'range', min: 0, max: 40, step: 0.5, default: 4, unit: 'px' },
    { key: 'length', label: 'Length', kind: 'range', min: 1, max: 120, step: 0.5, default: 18, unit: 'px' },
    { key: 'taper', label: 'Taper', kind: 'range', min: 0.3, max: 4, step: 0.05, default: 1, unit: '×' },
    { key: 'irregularity', label: 'Irregularity', kind: 'range', min: 0, max: 1, step: 0.02, default: 0 },
    { key: 'phase', label: 'Phase', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'cornerCompensation', label: 'Corner comp.', kind: 'range', min: 0, max: 1, step: 0.02, default: 1 },
  ],

  lobes: [
    { key: 'count', label: 'Count', kind: 'range', min: 4, max: 24, step: 1, default: 10 },
    { key: 'depth', label: 'Depth', kind: 'range', min: 0, max: 40, step: 0.5, default: 12, unit: 'px' },
    { key: 'phase', label: 'Phase', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 },
  ],

  wobble: [
    { key: 'frequency', label: 'Frequency', kind: 'range', min: 1, max: 10, step: 1, default: 3, unit: '×' },
    { key: 'amplitude', label: 'Amplitude', kind: 'range', min: 0, max: 30, step: 0.5, default: 8, unit: 'px' },
    { key: 'phase', label: 'Phase', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 },
  ],

  jitter: [
    { key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 20, step: 0.5, default: 6, unit: 'px' },
    { key: 'density', label: 'Density', kind: 'range', min: 4, max: 32, step: 1, default: 12 },
    { key: 'seed', label: 'Seed', kind: 'range', min: 0, max: 99, step: 1, default: 7 },
  ],

  cloud: [
    { key: 'density', label: 'Density', kind: 'range', min: 0.3, max: 12, step: 0.1, default: 3, unit: '/100px' },
    { key: 'puffSize', label: 'Puff size', kind: 'range', min: 6, max: 80, step: 0.5, default: 18, unit: 'px' },
    { key: 'seed', label: 'Seed', kind: 'range', min: 0, max: 99, step: 1, default: 11 },
    { kind: 'header', label: 'Irregularity' },
    { key: 'sizeJitter', label: 'Puff size', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.5 },
    { key: 'posJitter', label: 'Distribution', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.5 },
  ],

  stroke: [
    { key: 'width', label: 'Width', kind: 'range', min: 0.5, max: 12, step: 0.5, default: 2, unit: 'px' },
    { key: 'color', label: 'Color', kind: 'color', default: '#161921', alpha: true },
  ],

  shadow: [
    { key: 'dx', label: 'Offset X', kind: 'range', min: -20, max: 20, step: 0.5, default: 4, unit: 'px' },
    { key: 'dy', label: 'Offset Y', kind: 'range', min: -20, max: 20, step: 0.5, default: 8, unit: 'px' },
    { key: 'blur', label: 'Blur', kind: 'range', min: 0, max: 30, step: 0.5, default: 10, unit: 'px' },
    { key: 'opacity', label: 'Opacity', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
};

export const EFFECT_KINDS: EffectKind[] = ['fill', 'tail', 'spikes', 'lobes', 'wobble', 'jitter', 'cloud', 'stroke', 'shadow'];
// Fill + decoration stack lives on the left under the body/morph sections.
export const LEFT_PANEL_EFFECTS: EffectKind[] = ['fill', 'stroke', 'shadow'];
// Morph effects mutate the body silhouette itself — either by contributing
// a perimeter offset function (spikes/lobes/wobble/jitter) or by unioning
// extra polygons into the body (cloud puffs).
export const MORPH_EFFECTS: EffectKind[] = ['spikes', 'lobes', 'wobble', 'jitter', 'cloud'];
// Right panel hosts only tails now — each gets the colored minimap-paired card.
export const RIGHT_PANEL_EFFECTS: EffectKind[] = ['tail'];
export const BASE_KINDS: BalloonBase[] = ['rectangle', 'oval', 'polygon', 'cloud'];

export function defaultParams(controls: LabControl[]): ParamBag {
  const out: ParamBag = {};
  for (const c of controls) {
    if (c.kind === 'header') continue;
    if (c.kind === 'curve') {
      out[c.key] = c.defaults.slice();
    } else {
      out[c.key] = c.default;
    }
  }
  return out;
}

// Short collapsed-card summary so a user can see at a glance what an effect is doing.
export function effectSummary(kind: EffectKind, params: ParamBag): string {
  switch (kind) {
    case 'fill': {
      const mode = (params.mode as string) || 'radial';
      const base = (params.base as string) || '#fff';
      return `${mode} · ${base}`;
    }
    case 'tail': {
      const shape = (params.shape as string) || 'pointed';
      const angle = Math.round((params.angle as number) ?? 115);
      return `${shape} · ${angle}°`;
    }
    case 'spikes': {
      const w = (params.spikeWidth as number) ?? 6;
      const len = (params.length as number) ?? 18;
      return `${w}w × ${len}h`;
    }
    case 'stroke': {
      const w = (params.width as number) ?? 2;
      const c = (params.color as string) || '#000';
      return `${w}px · ${c}`;
    }
    case 'shadow': {
      const dx = (params.dx as number) ?? 0;
      const dy = (params.dy as number) ?? 0;
      const b = (params.blur as number) ?? 0;
      return `${dx},${dy} · blur ${b}`;
    }
    case 'lobes': {
      const c = (params.count as number) ?? 10;
      const d = (params.depth as number) ?? 12;
      return `${c} × ${d}px`;
    }
    case 'wobble': {
      const f = (params.frequency as number) ?? 3;
      const a = (params.amplitude as number) ?? 8;
      return `${f}Hz · ${a}px`;
    }
    case 'jitter': {
      const a = (params.amount as number) ?? 6;
      const d = (params.density as number) ?? 12;
      return `${a}px · ${d}`;
    }
    case 'cloud': {
      const c = (params.count as number) ?? 8;
      const p = (params.puffSize as number) ?? 26;
      return `${c} × ${p}px`;
    }
  }
}
