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

function buildRadial(svgEl, scene, store) {
  const R = PREVIEW_R;
  svgEl.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svgEl.appendChild(el('rect', {
    x: -R, y: -R, width: 2 * R, height: 2 * R, fill: scene.palette.background,
  }));

  const defs = el('defs');
  // Hash-supplied state bypasses the slider's [3,16] — clamp so a garbage
  // order can't hang the tab building wedges.
  const order = Math.min(32, Math.max(1, Math.trunc(scene.radial.order) || 1));
  const n = order * (scene.radial.mirror ? 2 : 1);
  const wedge = 360 / n;
  const half = (wedge / 2) * (Math.PI / 180);
  // Chamber placed radially: x → [0, R] outward from apex, y centered on the
  // axis. Scale must cover the whole sector: wedges wider than 60° need
  // |y| up to R·sin(half), taller than the h·(R/w) band; the arc clip trims
  // the radial overshoot.
  const { width: w, height: h } = scene.chamber;
  const s = Math.max(R / w, (2 * R * Math.sin(half)) / h);
  const placed = el('g', { id: 'radial-chamber' });
  const inner = el('g', { transform: `translate(0,${(-h * s) / 2}) scale(${s})` });
  inner.appendChild(chamberGroup(scene, store, {}));
  placed.appendChild(inner);
  defs.appendChild(placed);

  const sector = `M0,0 L${R * Math.cos(-half)},${R * Math.sin(-half)} ` +
    `A${R},${R} 0 0 1 ${R * Math.cos(half)},${R * Math.sin(half)} Z`;
  const clip = el('clipPath', { id: 'radial-sector' });
  clip.appendChild(el('path', { d: sector }));
  defs.appendChild(clip);
  svgEl.appendChild(defs);

  for (let k = 0; k < n; k++) {
    const mirrored = scene.radial.mirror && k % 2 === 1;
    const gk = el('g', {
      'data-wedge': k,
      transform: `rotate(${k * wedge})${mirrored ? ' scale(1,-1)' : ''}`,
      'clip-path': 'url(#radial-sector)',
    });
    gk.appendChild(el('use', { href: '#radial-chamber' }));
    svgEl.appendChild(gk);
  }
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
  const src = el('g', { id: 'tiling-chamber' });
  src.appendChild(chamberGroup(scene, store, { wrap: true }));
  defs.appendChild(src);

  const clipRect = el('clipPath', { id: 'tile-cell' });
  clipRect.appendChild(el('rect', { width: w, height: h }));
  defs.appendChild(clipRect);

  const pattern = el('pattern', { id: 'tile', patternUnits: 'userSpaceOnUse' });
  const use = (transform) => {
    const g = el('g', transform ? { transform } : {});
    const u = el('use', { href: '#tiling-chamber', 'clip-path': 'url(#tile-cell)' });
    g.appendChild(u);
    return g;
  };

  const group = scene.tiling.group;
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
    buildHexTiling(svgEl, defs, pattern, scene, store, k);  // Task 10 (p6m, p3m1)
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

function buildHexTiling() {
  throw new Error('hex tiling: implemented in Task 10');
}
