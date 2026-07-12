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
    proportional: false,   // scale parts by their real-world relative size
  };
}

// Reroll chamber.parts from seed + knobs. Discards tweaks by design.
export function scatter(scene, store) {
  const all = store.list.map(p => p.id);
  const filtered = scene.partSet.length
    ? scene.partSet.filter(id => store.list.some(p => p.id === id))
    : all;
  const enabled = filtered.length ? filtered : all;  // stale/emptied partSet: fall back
  // Persisted or hash-supplied state bypasses the slider's [3,60] — clamp so a
  // garbage density can't crash Array.from or hang the tab.
  const density = Math.min(200, Math.max(0, Math.trunc(scene.density) || 0));
  const rand = mulberry32(scene.seed);
  scene.chamber.parts = Array.from({ length: density }, (_, i) => ({
    id: i,
    partRef: randPick(rand, enabled),
    x: randRange(rand, 0, scene.chamber.width),
    y: randRange(rand, 0, scene.chamber.height),
    rotation: randRange(rand, -scene.rotationJitter, scene.rotationJitter),
    scale: randRange(rand, Math.min(...scene.sizeRange), Math.max(...scene.sizeRange)),
    colorIndex: randInt(rand, scene.palette.colors.length),
  }));
}

// Single source of truth for a part instance's transform. `rel` is the
// part's real-world relative size (from the manifest); applied only when
// scene.proportional is on, so tweaked scales keep their meaning either way.
export const partTransform = (scene, part, rel = 1) =>
  `translate(${part.x},${part.y}) rotate(${part.rotation}) scale(${part.scale * (scene.proportional ? rel : 1)})`;

export const partColor = (scene, part) =>
  part.colorOverride ?? scene.palette.colors[part.colorIndex % scene.palette.colors.length];

export const serialize = (scene) => JSON.stringify(scene);
export function deserialize(json) {
  const d = defaultScene();
  const s = { ...d, ...JSON.parse(json) };
  // Deep-merge nested keys so older saves survive schema growth.
  for (const k of ['chamber', 'radial', 'tiling', 'palette']) s[k] = { ...d[k], ...s[k] };
  if (!Array.isArray(s.palette.colors) || !s.palette.colors.length) s.palette = getPreset(s.palette.name);
  if (!Array.isArray(s.sizeRange) || s.sizeRange.length !== 2) s.sizeRange = d.sizeRange;
  return s;
}

// URL hash carries seed + knobs only (no tweaks): cheap sharing of rerollable state.
export function encodeHash(scene) {
  const { seed, mode, radial, tiling, density, sizeRange, rotationJitter, partSet, proportional } = scene;
  const payload = { seed, mode, radial, tiling, density, sizeRange, rotationJitter,
    partSet, proportional, paletteName: scene.palette.name };
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
