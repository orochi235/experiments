import { partColor, PART_UNIT } from './scene.js';
import { sampledRegion } from './engines.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

let selectedId = null;
let wheelTimer = 0;  // module scope: settle timers must survive renderChamber rebuilds
export const getSelected = (scene) =>
  scene.chamber.parts.find(p => p.id === selectedId) ?? null;
export const clearSelection = () => { selectedId = null; };

// Renders the chamber at editing scale and wires pointer interactions.
// onChange(kind, part?) is called after any mutation: 'drag' | 'tweak' | 'select'.
export function renderChamber(svgEl, scene, store, onChange) {
  const { width: w, height: h } = scene.chamber;
  svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.replaceChildren();
  svgEl.appendChild(el('rect', { width: w, height: h, fill: scene.palette.background }));
  svgEl.appendChild(el('rect', {
    width: w, height: h, fill: 'none', stroke: '#7ac8ff44', 'stroke-dasharray': '6 4',
  }));

  // Highlight the region the current engine samples (wedge / triangle);
  // parts outside it don't appear in the pattern. Clipped to the chamber.
  const region = sampledRegion(scene);
  if (region) {
    const defs = el('defs');
    const clip = el('clipPath', { id: 'chamber-bounds' });
    clip.appendChild(el('rect', { width: w, height: h }));
    defs.appendChild(clip);
    svgEl.appendChild(defs);
    const p = el('path', { d: region, class: 'sampled-region', 'clip-path': 'url(#chamber-bounds)' });
    svgEl.appendChild(p);
  }

  for (const part of scene.chamber.parts) {
    const g = el('g', {
      transform: `translate(${part.x},${part.y}) rotate(${part.rotation}) scale(${part.scale})`,
      'data-id': part.id, class: 'part',
    });
    g.appendChild(el('use', {
      href: '#' + store.symbolId(part.partRef, partColor(scene, part)),
      x: -PART_UNIT / 2, y: -PART_UNIT / 2, width: PART_UNIT, height: PART_UNIT,
    }));
    if (part.id === selectedId) {
      g.appendChild(el('rect', {
        x: -PART_UNIT / 2, y: -PART_UNIT / 2, width: PART_UNIT, height: PART_UNIT,
        fill: 'none', stroke: '#7ac8ff', 'stroke-width': 2 / part.scale, 'vector-effect': 'non-scaling-stroke',
      }));
    }
    svgEl.appendChild(g);
  }

  wirePointerHandlers(svgEl, scene, onChange);
}

function svgPoint(svgEl, clientX, clientY) {
  const pt = new DOMPoint(clientX, clientY);
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

function wirePointerHandlers(svgEl, scene, onChange) {
  svgEl.onpointerdown = (ev) => {
    if (svgEl.onpointermove) return;  // a second pointer must not clobber an active drag
    let g = ev.target.closest('g[data-id]');
    if (!g) { selectedId = null; onChange('select'); return; }
    selectedId = Number(g.dataset.id);
    const part = scene.chamber.parts.find(p => p.id === selectedId);
    const start = svgPoint(svgEl, ev.clientX, ev.clientY);
    const orig = { x: part.x, y: part.y };
    svgEl.setPointerCapture(ev.pointerId);
    onChange('select');  // rebuilds the pane to draw the highlight...
    g = svgEl.querySelector(`g[data-id="${part.id}"]`);  // ...so re-bind to the fresh node

    svgEl.onpointermove = (mv) => {
      const p = svgPoint(svgEl, mv.clientX, mv.clientY);
      part.x = Math.min(scene.chamber.width, Math.max(0, orig.x + p.x - start.x));
      part.y = Math.min(scene.chamber.height, Math.max(0, orig.y + p.y - start.y));
      // 60fps path: move this <g> in place and let main.js mutate the preview's
      // matching <use>; a full renderPreview costs 70-180ms at density 30.
      g.setAttribute('transform',
        `translate(${part.x},${part.y}) rotate(${part.rotation}) scale(${part.scale})`);
      onChange('drag', part);
    };
    const end = () => {
      svgEl.onpointermove = svgEl.onpointerup = svgEl.onpointercancel = null;
      onChange('tweak');   // full re-render + autosave on release/cancel
    };
    svgEl.onpointerup = svgEl.onpointercancel = end;
  };

  svgEl.onwheel = (ev) => {
    const part = scene.chamber.parts.find(p => p.id === selectedId);
    if (!part) return;
    ev.preventDefault();
    // macOS converts shift+vertical-wheel into deltaX; fall back so
    // shift+scroll (scale) actually receives a delta.
    const d = Math.sign(ev.deltaY || ev.deltaX);
    if (ev.shiftKey) part.scale = Math.min(3, Math.max(0.2, part.scale * (1 - d * 0.06)));
    else part.rotation = (part.rotation + d * 5) % 360;
    // Wheel ticks arrive in bursts: cheap 'drag' path per tick, one full
    // 'tweak' render after the burst settles (full renderPreview costs
    // 70-180ms at density 30).
    svgEl.querySelector(`g[data-id="${part.id}"]`)?.setAttribute('transform',
      `translate(${part.x},${part.y}) rotate(${part.rotation}) scale(${part.scale})`);
    onChange('drag', part);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => onChange('tweak'), 150);
  };

  svgEl.tabIndex = 0;  // focusable for keyboard events
  svgEl.onkeydown = (ev) => {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedId !== null) {
      scene.chamber.parts = scene.chamber.parts.filter(p => p.id !== selectedId);
      selectedId = null;
      onChange('tweak');
      return;
    }
    // Stacking: paint order is array order. ] forward, [ backward,
    // shift ({ / }) all the way to back/front.
    if (selectedId !== null && ['[', ']', '{', '}'].includes(ev.key)) {
      const parts = scene.chamber.parts;
      const i = parts.findIndex(p => p.id === selectedId);
      const j = ev.key === ']' ? Math.min(parts.length - 1, i + 1)
              : ev.key === '[' ? Math.max(0, i - 1)
              : ev.key === '}' ? parts.length - 1
              : 0;
      if (i !== j) {
        const [p] = parts.splice(i, 1);
        parts.splice(j, 0, p);
        onChange('tweak');
      }
    }
  };
}
