import type { BalloonBase, EffectKind, ParamBag } from './types';

export type LabControl =
  | { key: string; label?: string; kind: 'range'; min: number; max: number; step: number; default: number; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'select'; options: string[]; default: string; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'color'; default: string; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'text'; default: string; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'toggle'; default: boolean; hideWhen?: (params: ParamBag) => boolean }
  | { key: string; label?: string; kind: 'curve'; length: number; labels: string[]; min: number; max: number; step: number; defaults: number[]; hideWhen?: (params: ParamBag) => boolean }
  | { kind: 'header'; label: string; hideWhen?: (params: ParamBag) => boolean };

export const BASE_CONTROLS: Record<BalloonBase, LabControl[]> = {
  rectangle: [
    // Fraction of half the shorter edge: 0 = sharp corners, 1 = pill shape.
    { key: 'roundness', label: 'Roundness', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  oval: [],
};

export const EFFECT_CONTROLS: Record<EffectKind, LabControl[]> = {
  fill: [
    { key: 'mode', label: 'Mode', kind: 'select',
      options: ['aqua', 'bevel-rings', 'bevel-blur', 'bevel-dt'],
      default: 'aqua' },
    { key: 'base', label: 'Base color', kind: 'color', default: '#3b82f6' },

    { kind: 'header', label: 'Aqua', hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'lightAngle', label: 'Light angle (°)', kind: 'range', min: 0, max: 359, step: 1, default: 270, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'glossStrength', label: 'Gloss strength', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.55, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'rimContrast', label: 'Rim contrast', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.4, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'highlightTint', label: 'Highlight tint', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'shadowTint', label: 'Shadow tint', kind: 'color', default: '#0a1020', hideWhen: (p) => p.mode !== 'aqua' },

    { kind: 'header', label: 'Contour (rim → center)', hideWhen: (p) => p.mode === 'aqua' },
    {
      key: 'contour',
      kind: 'curve',
      length: 5,
      labels: ['Rim', 'Outer', 'Mid', 'Inner', 'Center'],
      min: -1,
      max: 1,
      step: 0.02,
      // X=0 = rim (alpha 0 in heightmap), X=1 = center (alpha 1, deepest interior).
      // Default = smooth outset dome: flat at the rim, climbing to a peak at center.
      defaults: [0, -0.05, 0.25, 0.4, 0.5, 0.78, 0.75, 0.95, 1, 1],
      hideWhen: (p) => p.mode === 'aqua',
    },

    { kind: 'header', label: 'Light', hideWhen: (p) => p.mode === 'aqua' },
    { key: 'lightAzimuth', label: 'Azimuth (°)', kind: 'range', min: 0, max: 359, step: 1, default: 135, hideWhen: (p) => p.mode === 'aqua' },
    { key: 'lightElevation', label: 'Elevation (°)', kind: 'range', min: 0, max: 90, step: 1, default: 55, hideWhen: (p) => p.mode === 'aqua' },
    { key: 'lightColor', label: 'Light color', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode === 'aqua' },

    { kind: 'header', label: 'Material', hideWhen: (p) => p.mode === 'aqua' },
    { key: 'surfaceScale', label: 'Surface scale', kind: 'range', min: 0, max: 30, step: 0.5, default: 8, hideWhen: (p) => p.mode === 'aqua' },
    { key: 'diffuse', label: 'Diffuse', kind: 'range', min: 0, max: 2, step: 0.02, default: 1.0, hideWhen: (p) => p.mode === 'aqua' },
    { key: 'specular', label: 'Specular', kind: 'range', min: 0, max: 2, step: 0.02, default: 0.6, hideWhen: (p) => p.mode === 'aqua' },
    { key: 'shininess', label: 'Shininess', kind: 'range', min: 1, max: 128, step: 1, default: 30, hideWhen: (p) => p.mode === 'aqua' },
    { key: 'specularColor', label: 'Specular color', kind: 'color', default: '#ffffff', hideWhen: (p) => p.mode === 'aqua' },

    { kind: 'header', label: 'Rings (bevel-rings)', hideWhen: (p) => p.mode !== 'bevel-rings' },
    { key: 'rings', label: 'Ring count', kind: 'range', min: 4, max: 48, step: 1, default: 20, hideWhen: (p) => p.mode !== 'bevel-rings' },
    { key: 'smoothing', label: 'Smoothing (px)', kind: 'range', min: 0, max: 4, step: 0.1, default: 1.2, hideWhen: (p) => p.mode !== 'bevel-rings' },

    { kind: 'header', label: 'Blur (bevel-blur)', hideWhen: (p) => p.mode !== 'bevel-blur' },
    { key: 'blur', label: 'Blur (σ)', kind: 'range', min: 1, max: 60, step: 0.5, default: 14, hideWhen: (p) => p.mode !== 'bevel-blur' },

    { kind: 'header', label: 'Distance transform (bevel-dt)', hideWhen: (p) => p.mode !== 'bevel-dt' },
    { key: 'dtResolution', label: 'Resolution (px)', kind: 'range', min: 64, max: 512, step: 16, default: 256, hideWhen: (p) => p.mode !== 'bevel-dt' },
  ],

  tail: [
    { key: 'shape', label: 'Shape', kind: 'select', options: ['classic', 'bubbles', 'lightning'], default: 'classic' },
    { kind: 'header', label: 'Attachment' },
    { key: 'angle', label: 'Angle', kind: 'range', min: 0, max: 359, step: 1, default: 115 },
    { key: 'projection', label: 'Projection', kind: 'select', options: ['radial', 'side'], default: 'radial' },
    { key: 'side', label: 'Side', kind: 'select', options: ['bottom', 'top', 'left', 'right'], default: 'bottom', hideWhen: (p) => p.projection !== 'side' },
    { key: 'position', label: 'Position along side', kind: 'range', min: 0.05, max: 0.95, step: 0.01, default: 0.3, hideWhen: (p) => p.projection !== 'side' },
    { key: 'offset', label: 'Offset along perimeter', kind: 'range', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'radial', label: 'Radial offset (in/out)', kind: 'range', min: -40, max: 60, step: 0.5, default: 0 },
    { kind: 'header', label: 'Shape' },
    // Single magnitude. Each shape applies its own natural width factor (classic
    // 0.8, bubbles 0.23, lightning 0.06) so size+weight=1 looks sensible across all.
    { key: 'size', label: 'Size', kind: 'range', min: 8, max: 220, step: 0.5, default: 60 },
    // Width multiplier on the shape's natural width factor. 1 = natural, <1 thinner, >1 fatter.
    { key: 'weight', label: 'Weight', kind: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'taper', label: 'Taper', kind: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
    { key: 'arc', label: 'Arc (lateral bend)', kind: 'range', min: -1, max: 1, step: 0.02, default: 0 },
    { kind: 'header', label: 'Bubbles', hideWhen: (p) => p.shape !== 'bubbles' },
    { key: 'count', label: 'Count', kind: 'range', min: 1, max: 8, step: 1, default: 3, hideWhen: (p) => p.shape !== 'bubbles' },
    { key: 'gap', label: 'Gap (fraction of size)', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.15, hideWhen: (p) => p.shape !== 'bubbles' },
    { kind: 'header', label: 'Lightning', hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'segments', label: 'Segments', kind: 'range', min: 2, max: 12, step: 1, default: 5, hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'jaggedness', label: 'Jaggedness', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.45, hideWhen: (p) => p.shape !== 'lightning' },
    { key: 'seed', label: 'Seed', kind: 'range', min: 0, max: 99, step: 1, default: 7, hideWhen: (p) => p.shape !== 'lightning' },
  ],

  stroke: [
    { key: 'width', label: 'Width', kind: 'range', min: 0.5, max: 12, step: 0.5, default: 2 },
    { key: 'color', label: 'Color', kind: 'color', default: '#161921' },
  ],

  shadow: [
    { key: 'dx', label: 'Offset X', kind: 'range', min: -20, max: 20, step: 0.5, default: 4 },
    { key: 'dy', label: 'Offset Y', kind: 'range', min: -20, max: 20, step: 0.5, default: 8 },
    { key: 'blur', label: 'Blur', kind: 'range', min: 0, max: 30, step: 0.5, default: 10 },
    { key: 'opacity', label: 'Opacity', kind: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
};

export const EFFECT_KINDS: EffectKind[] = ['fill', 'tail', 'stroke', 'shadow'];
export const LEFT_PANEL_EFFECTS: EffectKind[] = ['fill'];
export const RIGHT_PANEL_EFFECTS: EffectKind[] = ['tail', 'stroke', 'shadow'];
export const BASE_KINDS: BalloonBase[] = ['rectangle', 'oval'];

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
      const shape = (params.shape as string) || 'classic';
      const angle = Math.round((params.angle as number) ?? 115);
      return `${shape} · ${angle}°`;
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
  }
}
