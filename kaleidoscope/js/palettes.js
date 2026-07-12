// Each preset: ordered color list + background. Hexes for the LEGO set are
// the standard LDraw/BrickLink values.
export const PRESETS = {
  'classic-brights': {
    colors: ['#c91a09', '#0055bf', '#f2cd37', '#237841', '#fe8a18', '#f2f3f2'],
    background: '#1a1a2e',
  },
  pastel: {
    colors: ['#fecccf', '#b4d4f7', '#fff5b8', '#c9e4c5', '#e6d3f2', '#ffe0c2'],
    background: '#2a2438',
  },
  'mono-blue': {
    colors: ['#0d2b52', '#1a4a8a', '#2f6fc4', '#6ea3e8', '#b7d2f5'],
    background: '#080f1c',
  },
  'duotone-ember': {
    colors: ['#c91a09', '#fe8a18', '#3d1308', '#7a2e0e'],
    background: '#140803',
  },
};

export function getPreset(name) {
  const p = PRESETS[name] ?? PRESETS['classic-brights'];
  return { name: PRESETS[name] ? name : 'classic-brights', colors: [...p.colors], background: p.background };
}
