import { mulberry32, randRange, randInt, randPick } from './rng.js';
import { getPreset } from './palettes.js';

export const CHAMBER_W = 400, CHAMBER_H = 400, PART_UNIT = 100;
const STORAGE_KEY = 'kaleidoscope-scene-v1';

export function defaultScene() {
  return {
    seed: 1,
    mode: 'radial',
    chamber: { width: CHAMBER_W, height: CHAMBER_H, parts: [] },
    radial: { order: 6, mirror: true },
    tiling: { group: 'p6m', tileSize: 300 },
    palette: getPreset('classic-brights'),
    partSet: [],            // filled from manifest at startup (all enabled)
    density: 14,
    sizeRange: [0.5, 1.4],
    rotationJitter: 180,
  };
}

// Reroll chamber.parts from seed + knobs. Discards tweaks by design.
export function scatter(scene, store) {
  const enabled = scene.partSet.length
    ? scene.partSet.filter(id => store.list.some(p => p.id === id))
    : store.list.map(p => p.id);
  const rand = mulberry32(scene.seed);
  scene.chamber.parts = Array.from({ length: scene.density }, (_, i) => ({
    id: i,
    partRef: randPick(rand, enabled),
    x: randRange(rand, 0, scene.chamber.width),
    y: randRange(rand, 0, scene.chamber.height),
    rotation: randRange(rand, -scene.rotationJitter, scene.rotationJitter),
    scale: randRange(rand, scene.sizeRange[0], scene.sizeRange[1]),
    colorIndex: randInt(rand, scene.palette.colors.length),
  }));
}

export const partColor = (scene, part) =>
  part.colorOverride ?? scene.palette.colors[part.colorIndex % scene.palette.colors.length];

export const serialize = (scene) => JSON.stringify(scene);
export function deserialize(json) {
  const s = { ...defaultScene(), ...JSON.parse(json) };
  s.chamber = { ...defaultScene().chamber, ...s.chamber };
  return s;
}

// URL hash carries seed + knobs only (no tweaks): cheap sharing of rerollable state.
export function encodeHash(scene) {
  const { seed, mode, radial, tiling, density, sizeRange, rotationJitter, partSet } = scene;
  const payload = { seed, mode, radial, tiling, density, sizeRange, rotationJitter,
    partSet, paletteName: scene.palette.name };
  return '#s=' + btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeHash(hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash ?? '');
  if (!m) return null;
  try {
    let b64 = m[1].replaceAll('-', '+').replaceAll('_', '/');
    while (b64.length % 4) b64 += '=';
    const p = JSON.parse(atob(b64));
    if (typeof p.seed !== 'number') return null;
    return p;
  } catch { return null; }
}

export const saveLocal = (scene) => localStorage.setItem(STORAGE_KEY, serialize(scene));
export function loadLocal() {
  const json = localStorage.getItem(STORAGE_KEY);
  try { return json ? deserialize(json) : null; } catch { return null; }
}
