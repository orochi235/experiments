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
    { key: 'radius', label: 'Corner radius', kind: 'range', min: 0, max: 80, step: 1, default: 28 },
  ],
  oval: [
    { key: 'eccentricity', label: 'Eccentricity', kind: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1.4 },
  ],
};

export const EFFECT_CONTROLS: Record<EffectKind, LabControl[]> = {
  fill: [
    { key: 'mode', label: 'Mode', kind: 'select', options: ['solid', 'radial', 'puffy', 'raised', 'sculpted', 'aqua', 'beveled'], default: 'radial' },
    { key: 'base', label: 'Base color', kind: 'color', default: '#ffffff' },
    { kind: 'header', label: 'Contour (highlight → rim)', hideWhen: (p) => p.mode === 'solid' || p.mode === 'puffy' || p.mode === 'aqua' },
    {
      key: 'contour',
      kind: 'curve',
      length: 5,
      labels: ['Highlight', 'Inner', 'Mid', 'Outer', 'Rim'],
      min: -1,
      max: 1,
      step: 0.02,
      // Interleaved [x, y, x, y, …] — 5 points at evenly-spaced X with default Y deltas.
      defaults: [0, 0.55, 0.25, 0.32, 0.5, 0, 0.75, -0.12, 1, -0.32],
      hideWhen: (p) => p.mode === 'solid' || p.mode === 'puffy' || p.mode === 'aqua',
    },
    { kind: 'header', label: 'Beveled', hideWhen: (p) => p.mode !== 'beveled' },
    { key: 'borderColor', label: 'Border color', kind: 'color', default: '#161921', hideWhen: (p) => p.mode !== 'beveled' },
    { key: 'borderWidth', label: 'Border width', kind: 'range', min: 0, max: 20, step: 0.5, default: 2, hideWhen: (p) => p.mode !== 'beveled' },
    { key: 'bevelWidth', label: 'Bevel width', kind: 'range', min: 1, max: 50, step: 0.5, default: 14, hideWhen: (p) => p.mode !== 'beveled' },
    { key: 'bevelSoftness', label: 'Bevel softness', kind: 'range', min: 0.1, max: 1, step: 0.02, default: 0.4, hideWhen: (p) => p.mode !== 'beveled' },
    { kind: 'header', label: 'Aqua', hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'splitY', label: 'Gloss height', kind: 'range', min: 0.05, max: 0.95, step: 0.01, default: 0.5, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'glossStrength', label: 'Gloss strength', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.7, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'glossFade', label: 'Gloss fade', kind: 'range', min: 0, max: 0.4, step: 0.005, default: 0.02, hideWhen: (p) => p.mode !== 'aqua' },
    { key: 'bottomGlow', label: 'Bottom glow', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.25, hideWhen: (p) => p.mode !== 'aqua' },
    { kind: 'header', label: 'Tints' },
    { key: 'highlightTint', label: 'Highlight tint', kind: 'color', default: '#ffffff' },
    { key: 'shadowTint', label: 'Shadow tint', kind: 'color', default: '#000000' },
    { kind: 'header', label: 'Gradient', hideWhen: (p) => p.mode !== 'radial' && p.mode !== 'raised' },
    { key: 'hx', label: 'Highlight X', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3, hideWhen: (p) => p.mode !== 'radial' && p.mode !== 'raised' },
    { key: 'hy', label: 'Highlight Y', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.22, hideWhen: (p) => p.mode !== 'radial' && p.mode !== 'raised' },
    { key: 'spread', label: 'Spread', kind: 'range', min: 0.2, max: 1.8, step: 0.02, default: 0.95, hideWhen: (p) => p.mode !== 'radial' && p.mode !== 'raised' },
    { kind: 'header', label: 'Light', hideWhen: (p) => p.mode !== 'puffy' && p.mode !== 'sculpted' },
    // Angle: where the highlight LANDS on the body, 0 = right, 90 = bottom (SVG y-down, CW).
    { key: 'angle', label: 'Light angle (°)', kind: 'range', min: 0, max: 359, step: 1, default: 230, hideWhen: (p) => p.mode !== 'puffy' && p.mode !== 'sculpted' },
    { key: 'distance', label: 'Light distance', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.5, hideWhen: (p) => p.mode !== 'puffy' && p.mode !== 'sculpted' },
    { kind: 'header', label: 'Depth', hideWhen: (p) => p.mode !== 'puffy' && p.mode !== 'sculpted' },
    { key: 'depth', label: 'Spread', kind: 'range', min: 0.05, max: 1, step: 0.02, default: 0.45, hideWhen: (p) => p.mode !== 'puffy' && p.mode !== 'sculpted' },
    { key: 'highlight', label: 'Highlight (diffuse)', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.55, hideWhen: (p) => p.mode !== 'puffy' },
    { key: 'specular', label: 'Specular catch', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.5, hideWhen: (p) => p.mode !== 'puffy' },
    { key: 'shadow', label: 'Shadow', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.45, hideWhen: (p) => p.mode !== 'puffy' },
    { kind: 'header', label: 'Volume' },
    { key: 'innerShadow', label: 'Inner shadow', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.5 },
    { key: 'innerHighlight', label: 'Top highlight', kind: 'range', min: 0, max: 1, step: 0.02, default: 0.4 },
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
    { key: 'length', label: 'Length', kind: 'range', min: 6, max: 200, step: 0.5, default: 50 },
    { key: 'baseWidth', label: 'Base width', kind: 'range', min: 2, max: 160, step: 0.5, default: 40 },
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
