import { partColor, PART_UNIT } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export const PREVIEW_R = 500;                    // radial preview radius
export const WRAP_MARGIN = 0.2;                  // tiling: clone parts within 20% of an edge
export const TILE_VIEW = 1000;                   // tiling preview viewBox is 0..1000 square

// Region of the chamber the current engine actually samples, as an SVG path
// in chamber coordinates — the editor overlays it so you can see which parts
// feed the pattern. null = the whole chamber is sampled.
export function sampledRegion(scene) {
  const { width: w, height: h } = scene.chamber;
  const group = scene.tiling.group;
  if (scene.mode === 'tiling') {
    if (group === 'p4m') {
      const s = Math.min(w, h);
      return `M0,0 L${s},0 L${s},${s} Z`;   // fundamental triangle
    }
    if (group !== 'p6m' && group !== 'p3m1') return null;  // p1/pm/pmm: all of it
  }
  // Wedge modes (radial, p6m, p3m1): mirror of wedgeMotif's placement math —
  // apex at (0, h/2), half-angle π/n, radius R/s in chamber units.
  const radial = scene.mode === 'radial';
  const order = radial
    ? Math.min(32, Math.max(1, Math.trunc(scene.radial.order) || 1))
    : (group === 'p6m' ? 6 : 3);
  const mirror = radial ? scene.radial.mirror : true;
  const n = order * (mirror ? 2 : 1);
  const half = Math.PI / n;
  const R = radial ? PREVIEW_R : w;
  const s = Math.max(R / w, (2 * R * Math.sin(half)) / h);
  const r = R / s;
  const cy = h / 2;
  return `M0,${cy} L${r * Math.cos(-half)},${cy + r * Math.sin(-half)} ` +
    `A${r},${r} 0 0 1 ${r * Math.cos(half)},${cy + r * Math.sin(half)} Z`;
}

// One <g> containing a <use> per chamber part. With {wrap:true}, parts near an
// edge are cloned across the opposite edge (toroidal) so tiles read seamless.
export function chamberGroup(scene, store, { wrap = false } = {}) {
  const { width: w, height: h } = scene.chamber;
  const g = el('g', { 'data-chamber': '' });
  const mx = w * WRAP_MARGIN, my = h * WRAP_MARGIN;
  for (const part of scene.chamber.parts) {
    const offsets = [[0, 0]];
    if (wrap) {
      const dx = part.x < mx ? w : part.x > w - mx ? -w : 0;
      const dy = part.y < my ? h : part.y > h - my ? -h : 0;
      if (dx) offsets.push([dx, 0]);
      if (dy) offsets.push([0, dy]);
      if (dx && dy) offsets.push([dx, dy]);
    }
    for (const [ox, oy] of offsets) {
      g.appendChild(el('use', {
        href: '#' + store.symbolId(part.partRef, partColor(scene, part)),
        x: -PART_UNIT / 2, y: -PART_UNIT / 2, width: PART_UNIT, height: PART_UNIT,
        transform: `translate(${part.x + ox},${part.y + oy}) rotate(${part.rotation}) scale(${part.scale})`,
        'data-part-id': part.id,
      }));
    }
  }
  return g;
}

export function renderPreview(svgEl, scene, store) {
  svgEl.replaceChildren();
  if (scene.mode === 'radial') buildRadial(svgEl, scene, store);
  else buildTiling(svgEl, scene, store);
}

// Shared: builds a mirrored/rotated wedge motif of the chamber, radius R,
// appending its defs into `defs` and returning the motif <g>.
function wedgeMotif(defs, scene, store, { order, mirror, R, idPrefix, dataWedge = false }) {
  order = Math.min(32, Math.max(1, Math.trunc(order) || 1));  // hash-supplied state bypasses the slider
  const n = order * (mirror ? 2 : 1);
  const wedge = 360 / n;
  const half = (wedge / 2) * (Math.PI / 180);
  const { width: w, height: h } = scene.chamber;
  // Cover the whole sector: wedges wider than 60° need |y| up to R·sin(half).
  const s = Math.max(R / w, (2 * R * Math.sin(half)) / h);
  const placed = el('g', { id: `${idPrefix}-chamber` });
  const inner = el('g', { transform: `translate(0,${(-h * s) / 2}) scale(${s})` });
  inner.appendChild(chamberGroup(scene, store, {}));
  placed.appendChild(inner);
  defs.appendChild(placed);

  const clip = el('clipPath', { id: `${idPrefix}-sector` });
  clip.appendChild(el('path', {
    d: `M0,0 L${R * Math.cos(-half)},${R * Math.sin(-half)} ` +
       `A${R},${R} 0 0 1 ${R * Math.cos(half)},${R * Math.sin(half)} Z`,
  }));
  defs.appendChild(clip);

  const motif = el('g');
  for (let k = 0; k < n; k++) {
    const mirrored = mirror && k % 2 === 1;
    const gk = el('g', {
      ...(dataWedge ? { 'data-wedge': k } : {}),
      transform: `rotate(${k * wedge})${mirrored ? ' scale(1,-1)' : ''}`,
      'clip-path': `url(#${idPrefix}-sector)`,
    });
    gk.appendChild(el('use', { href: `#${idPrefix}-chamber` }));
    motif.appendChild(gk);
  }
  return motif;
}

function buildRadial(svgEl, scene, store) {
  const R = PREVIEW_R;
  svgEl.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svgEl.appendChild(el('rect', {
    x: -R, y: -R, width: 2 * R, height: 2 * R, fill: scene.palette.background,
  }));
  const defs = el('defs');
  svgEl.appendChild(defs);
  svgEl.appendChild(wedgeMotif(defs, scene, store, {
    order: scene.radial.order, mirror: scene.radial.mirror,
    R, idPrefix: 'radial', dataWedge: true,
  }));
}

function buildTiling(svgEl, scene, store) {
  svgEl.setAttribute('viewBox', `0 0 ${TILE_VIEW} ${TILE_VIEW}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  const defs = el('defs');
  const { width: w, height: h } = scene.chamber;
  // Hash-supplied state bypasses the slider's [100,600] — clamp so a garbage
  // tileSize can't yield a NaN/degenerate pattern.
  const tileSize = Math.min(600, Math.max(50, Number(scene.tiling.tileSize) || 300));
  const k = tileSize / w;                       // chamber units → preview units
  const group = scene.tiling.group;
  const hex = group === 'p6m' || group === 'p3m1';
  if (!hex) {                                   // hex mode never references these defs
    const src = el('g', { id: 'tiling-chamber' });
    src.appendChild(chamberGroup(scene, store, { wrap: true }));
    defs.appendChild(src);

    const clipRect = el('clipPath', { id: 'tile-cell' });
    clipRect.appendChild(el('rect', { width: w, height: h }));
    defs.appendChild(clipRect);
  }

  const pattern = el('pattern', { id: 'tile', patternUnits: 'userSpaceOnUse' });
  const use = (transform) => {
    const g = el('g', transform ? { transform } : {});
    const u = el('use', { href: '#tiling-chamber', 'clip-path': 'url(#tile-cell)' });
    g.appendChild(u);
    return g;
  };

  if (group === 'p1') {
    pattern.setAttribute('width', w * k); pattern.setAttribute('height', h * k);
    pattern.appendChild(el('g', { transform: `scale(${k})` })).appendChild(use());
  } else if (group === 'pm') {
    pattern.setAttribute('width', 2 * w * k); pattern.setAttribute('height', h * k);
    const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
    g.appendChild(use());
    g.appendChild(use(`translate(${2 * w},0) scale(-1,1)`));
  } else if (group === 'pmm') {
    pattern.setAttribute('width', 2 * w * k); pattern.setAttribute('height', 2 * h * k);
    const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
    g.appendChild(use());
    g.appendChild(use(`translate(${2 * w},0) scale(-1,1)`));
    g.appendChild(use(`translate(0,${2 * h}) scale(1,-1)`));
    g.appendChild(use(`translate(${2 * w},${2 * h}) scale(-1,-1)`));
  } else if (group === 'p4m') {
    // Square cell: chamber clipped to the below-diagonal triangle + its
    // diagonal reflection, then that cell reflected pmm-style into 2×2.
    const s = Math.min(w, h);
    const tri = el('clipPath', { id: 'tile-tri' });
    tri.appendChild(el('path', { d: `M0,0 L${s},0 L${s},${s} Z` }));
    defs.appendChild(tri);
    const cell = el('g', { id: 'p4m-cell' });
    const t1 = el('g', { 'clip-path': 'url(#tile-tri)' });
    t1.appendChild(el('use', { href: '#tiling-chamber' }));
    const t2 = el('g', { 'clip-path': 'url(#tile-tri)', transform: 'matrix(0,1,1,0,0,0)' });
    t2.appendChild(el('use', { href: '#tiling-chamber' }));
    cell.appendChild(t1); cell.appendChild(t2);
    defs.appendChild(cell);
    pattern.setAttribute('width', 2 * s * k); pattern.setAttribute('height', 2 * s * k);
    const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
    for (const t of ['', `translate(${2 * s},0) scale(-1,1)`,
                     `translate(0,${2 * s}) scale(1,-1)`, `translate(${2 * s},${2 * s}) scale(-1,-1)`]) {
      const gg = el('g', t ? { transform: t } : {});
      gg.appendChild(el('use', { href: '#p4m-cell' }));
      g.appendChild(gg);
    }
  } else {
    buildHexTiling(defs, pattern, scene, store, k);  // Task 10 (p6m, p3m1)
  }

  defs.appendChild(pattern);
  svgEl.appendChild(defs);
  svgEl.appendChild(el('rect', {
    width: TILE_VIEW, height: TILE_VIEW, fill: scene.palette.background,
  }));
  svgEl.appendChild(el('rect', {
    width: TILE_VIEW, height: TILE_VIEW, fill: 'url(#tile)',
  }));
}

function buildHexTiling(defs, pattern, scene, store, k) {
  const group = scene.tiling.group;                 // 'p6m' | 'p3m1'
  const r = scene.chamber.width;                    // motif radius in chamber units
  const motif = wedgeMotif(defs, scene, store, {
    order: group === 'p6m' ? 6 : 3, mirror: true, R: r, idPrefix: 'hex',
  });
  motif.id = 'hex-motif';
  // p6m: rotate the motif a half-wedge so its mirror axes (15° + 30°k) land
  // on the hex lattice's mirrors (30°k) — unrotated, the pattern is chiral p6.
  // p3m1 must stay unrotated or its mirrors move onto translation axes (p31m).
  if (group === 'p6m') motif.setAttribute('transform', 'rotate(15)');
  defs.appendChild(motif);

  // Hex lattice: vectors (√3r, 0) and (√3r/2, 1.5r). Rect tile W=√3r, H=3r
  // holds one full column plus the half-offset row. The offset row also needs
  // horizontal neighbors: its discs overflow the vertical tile edges by
  // r(1−√3/2) and SVG patterns clip to the tile, so stamp both sides.
  const W = Math.sqrt(3) * r, H = 3 * r;
  pattern.setAttribute('width', W * k); pattern.setAttribute('height', H * k);
  const g = pattern.appendChild(el('g', { transform: `scale(${k})` }));
  for (const [cx, cy] of [[0, 0], [W, 0],
                          [-W / 2, H / 2], [W / 2, H / 2], [3 * W / 2, H / 2],
                          [0, H], [W, H]]) {
    g.appendChild(el('use', { href: '#hex-motif', transform: `translate(${cx},${cy})` }));
  }
}
