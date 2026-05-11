import { state, setRenderFn, scheduleRender, applyPreset } from './state.js';
import { createGL, makeFullscreenTriangle, recomputeDerived } from './render/gl.js';
import { buildPrograms } from './render/programs.js';
import { setSharedUniforms } from './render/uniforms.js';
import { wireControls } from './ui/controls.js';
import { wireProjectionToggles } from './ui/projectionToggle.js';
import { drawStripOverlay, drawDomeOverlay } from './render/overlay.js';
import './styles.css';

const MODELS = ['rayleigh', 'preetham', 'nishita', 'hosek', 'ozone', 'cie'];
const cap = s => s[0].toUpperCase() + s.slice(1);

// Build panel registry by querying DOM
const panels = [];
for (const m of MODELS) {
  const stripCanvas = document.getElementById(`c${cap(m)}`);
  const domeCanvas = document.querySelector(`canvas.dome.gl[data-model="${m}"]`);
  if (stripCanvas) {
    const overlay = document.getElementById(`o${cap(m)}`);
    panels.push({ kind: 'strip', model: m, canvas: stripCanvas, overlay });
  }
  if (domeCanvas) {
    const overlay = document.getElementById(`od${m}`);
    panels.push({ kind: 'dome', model: m, canvas: domeCanvas, overlay });
  }
}

// Per-panel GL context + program
for (const p of panels) {
  p.gl = createGL(p.canvas);
  const programs = buildPrograms(p.gl);
  p.program = programs[p.kind][p.model];
  const { vao, attrName } = makeFullscreenTriangle(p.gl);
  p.vao = vao;
  if (p.program) {
    const aPos = p.gl.getAttribLocation(p.program, attrName);
    p.gl.bindVertexArray(vao);
    p.gl.enableVertexAttribArray(aPos);
    p.gl.vertexAttribPointer(aPos, 2, p.gl.FLOAT, false, 0, 0);
    p.gl.bindVertexArray(null);
  }
}

// Visibility tracking
const visible = new Set();
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const p = panels.find(pp => pp.canvas === e.target);
    if (!p) continue;
    if (e.isIntersecting) visible.add(p); else visible.delete(p);
  }
  scheduleRender();
}, { rootMargin: '200px' });
for (const p of panels) io.observe(p.canvas);

// DPR-aware sizing with per-projection caps
function sizeCanvas(p) {
  // Lightbox panel may not have a model bound yet (not opened)
  if (p.isLightbox && !p.model) return;
  if (p.kind === 'dome') {
    const proj = state.projection;
    p.canvas.dataset.projection = proj;
    if (p.overlay) p.overlay.dataset.projection = proj;
    const frame = p.canvas.closest('.dome-frame');
    if (frame) frame.dataset.projection = proj;
  }
  const rect = p.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  let maxW, aspect;
  if (p.kind === 'strip') {
    maxW = 1500;
    aspect = rect.width / rect.height;
  } else {
    const proj = state.projection;
    maxW = p.isLightbox
      ? (proj === 'fisheye' ? 1600 : 2400)
      : (proj === 'fisheye' ? 720 : 1200);
    aspect = proj === 'fisheye' ? 1 : 2;
  }
  const w = Math.max(1, Math.round(Math.min(rect.width * dpr, maxW)));
  const h = Math.max(1, Math.round(w / aspect));
  if (p.canvas.width !== w || p.canvas.height !== h) {
    p.canvas.width = w;
    p.canvas.height = h;
  }
  if (p.overlay && (p.overlay.width !== w || p.overlay.height !== h)) {
    p.overlay.width = w;
    p.overlay.height = h;
  }
}
const ro = new ResizeObserver(() => {
  for (const p of panels) sizeCanvas(p);
  scheduleRender();
});
for (const p of panels) ro.observe(p.canvas);

const PROJ_MAP = { fisheye: 0, equirect: 1, sunfacing: 2 };

function setupHourScrub() {
  const HOUR_START = 3;
  const HOUR_END = 22;
  for (const p of panels.filter(pp => pp.kind === 'strip')) {
    const canvas = p.canvas;
    let down = false;
    function updateFromEvent(ev) {
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const hour = HOUR_START + Math.max(0, Math.min(1, x)) * (HOUR_END - HOUR_START);
      state.hour = hour;
      scheduleRender();
    }
    canvas.addEventListener('pointerdown', e => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      updateFromEvent(e);
    });
    canvas.addEventListener('pointermove', e => {
      if (down) updateFromEvent(e);
    });
    canvas.addEventListener('pointerup', e => {
      down = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    });
    canvas.style.cursor = 'crosshair';
  }
}

function render() {
  recomputeDerived(state, state.hour);

  for (const p of visible) {
    if (!p.program) continue;
    sizeCanvas(p);
    const gl = p.gl;
    gl.viewport(0, 0, p.canvas.width, p.canvas.height);
    gl.useProgram(p.program);
    gl.bindVertexArray(p.vao);
    setSharedUniforms(gl, p.program, state);
    // Per-panel uniforms
    gl.uniform2f(gl.getUniformLocation(p.program, 'uResolution'),
                 p.canvas.width, p.canvas.height);
    if (p.kind === 'strip') {
      gl.uniform1f(gl.getUniformLocation(p.program, 'uViewElDeg'), state.viewEl);
      gl.uniform1f(gl.getUniformLocation(p.program, 'uHourStart'), 3.0);
      gl.uniform1f(gl.getUniformLocation(p.program, 'uHourEnd'), 22.0);
    } else {
      const proj = PROJ_MAP[state.projection] ?? 0;
      gl.uniform1i(gl.getUniformLocation(p.program, 'uProjection'), proj);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (p.overlay) {
      const ctx = p.overlay.getContext('2d');
      if (p.kind === 'strip') drawStripOverlay(ctx, state);
      else drawDomeOverlay(ctx, state, p.model);
    }
  }
}
setRenderFn(render);

// Lightbox: a 13th panel that shows the currently-selected model at near-fullscreen.
// One GL context; swap which model's program is bound each time it opens.
function setupLightbox() {
  const lb = document.getElementById('lightbox');
  const lbCanvas = document.getElementById('lbCanvas');
  const lbOverlay = document.getElementById('lbOverlay');
  const lbClose = document.getElementById('lbClose');
  const lbTitle = document.getElementById('lbTitle');
  if (!lb || !lbCanvas) return;

  const gl = createGL(lbCanvas);
  const programs = buildPrograms(gl);
  const { vao, attrName } = makeFullscreenTriangle(gl);
  // Bind attribute once per program is impractical; do it lazily in render.
  const lbPanel = { kind: 'dome', model: null, canvas: lbCanvas, overlay: lbOverlay,
                    gl, vao, attrName, programs, isLightbox: true };
  panels.push(lbPanel);

  const lbHour = document.getElementById('lbHour');
  const lbHourVal = document.getElementById('lbHourVal');
  const lbElev = document.getElementById('lbElev');
  const lbPresetName = document.getElementById('lbPreset');

  function formatHour(h) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  function updateLightboxReadouts() {
    if (!state.lightboxModel) return;
    if (lbHourVal) lbHourVal.textContent = formatHour(state.hour);
    if (lbHour && parseFloat(lbHour.value) !== state.hour) {
      lbHour.value = state.hour;
    }
    if (lbElev && state._primarySunElev != null) {
      const deg = state._primarySunElev * 180 / Math.PI;
      lbElev.textContent = `${deg.toFixed(1)}°`;
    }
    if (lbPresetName) lbPresetName.textContent = state.preset;
  }
  // Re-fire readouts whenever state changes — piggyback on render via setRenderFn wrapper
  const baseRender = render;
  setRenderFn(() => { baseRender(); updateLightboxReadouts(); });

  if (lbHour) {
    lbHour.addEventListener('input', () => {
      state.hour = parseFloat(lbHour.value);
      scheduleRender();
    });
  }

  function open(model) {
    state.lightboxModel = model;
    lbPanel.model = model;
    lbPanel.program = programs.dome[model];
    if (lbPanel.program) {
      const aPos = gl.getAttribLocation(lbPanel.program, attrName);
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    lb.classList.add('open');
    lb.dataset.projection = state.projection;
    lbTitle.textContent = model[0].toUpperCase() + model.slice(1);
    visible.add(lbPanel);
    scheduleRender();
  }
  function close() {
    state.lightboxModel = null;
    lb.classList.remove('open');
    visible.delete(lbPanel);
  }
  for (const p of panels.filter(pp => pp.kind === 'dome' && !pp.isLightbox)) {
    p.canvas.addEventListener('click', () => open(p.model));
  }
  lbClose.addEventListener('click', close);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  document.addEventListener('keydown', e => {
    if (!state.lightboxModel) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const i = MODELS.indexOf(state.lightboxModel);
      const next = MODELS[(i + dir + MODELS.length) % MODELS.length];
      open(next);
    }
  });
}

// Paint each preset button with a subtle gradient using the preset's ground color
import { PRESETS, approxPresetPalette } from './presets.js';
function paintPresetButtons() {
  const DARK = 0.5;
  const dk = c => `rgb(${(c[0] * DARK) | 0},${(c[1] * DARK) | 0},${(c[2] * DARK) | 0})`;
  document.querySelectorAll('.preset-btn').forEach(btn => {
    const pal = approxPresetPalette(btn.dataset.preset);
    if (!pal) return;
    // Three stacked layers (top-to-bottom in CSS = first listed is on top):
    //   1. dark elliptical wash behind the text area (top-left) for legibility
    //   2. warm near-sun hotspot in the upper-right
    //   3. vertical sky→horizon→ground column (the "preview" reading)
    btn.style.background =
      `radial-gradient(ellipse 70% 55% at 20% 35%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 75%),` +
      `radial-gradient(ellipse 60% 50% at 80% 25%, ${dk(pal.nearSun)} 0%, transparent 70%),` +
      `linear-gradient(180deg,` +
        ` ${dk(pal.farSky)} 0%,` +
        ` ${dk(pal.zenith)} 30%,` +
        ` ${dk(pal.midSky)} 60%,` +
        ` ${dk(pal.horizonHaze)} 78%,` +
        ` ${dk(pal.ground)} 100%)`;
  });
}

// Horizontal scrolling toolbar of planet icons.
//   'visual' scale (default): cube-root-ish of relative radius, clamped
//     to ~[0.55, 1.7] so every planet reads at a similar visual weight.
//   'actual' scale: linear in radius, normalized so the largest preset
//     (Jupiter) fills the maximum orb size and rocky planets shrink to
//     their true relative dot.
const orbOrder = Object.keys(PRESETS);
function computeOrbScale(id, mode) {
  const EARTH_R = 6371e3;
  const p = PRESETS[id];
  if (!p) return 1;
  if (mode === 'actual') {
    const maxR = Math.max(...orbOrder.map(k => PRESETS[k].planetR));
    return (p.planetR / maxR) * 1.7;  // Jupiter ≈ 1.7, Earth ≈ 0.15
  }
  return Math.max(0.55, Math.min(1.7, Math.pow(p.planetR / EARTH_R, 0.4)));
}
function applyOrbScales(mode) {
  document.querySelectorAll('.planet-icon').forEach(btn => {
    const orb = btn.querySelector('.planet-orb');
    if (!orb) return;
    orb.style.setProperty('--scale', computeOrbScale(btn.dataset.preset, mode).toFixed(3));
  });
}

function setupPlanetToolbar() {
  const bar = document.getElementById('planetToolbar');
  if (!bar) return;
  const DARK = 0.7;
  const dk = c => `rgb(${(c[0] * DARK) | 0},${(c[1] * DARK) | 0},${(c[2] * DARK) | 0})`;
  const lt = c => `rgb(${Math.min(255, c[0] * 1.1) | 0},${Math.min(255, c[1] * 1.1) | 0},${Math.min(255, c[2] * 1.1) | 0})`;

  for (const id of orbOrder) {
    const p = PRESETS[id];
    const pal = approxPresetPalette(id);
    if (!pal) continue;
    const btn = document.createElement('button');
    btn.className = 'planet-icon';
    btn.dataset.preset = id;
    btn.type = 'button';
    btn.title = id[0].toUpperCase() + id.slice(1);
    const orb = document.createElement('span');
    orb.className = 'planet-orb';
    const scale = computeOrbScale(id, state.planetScale || 'visual');
    orb.style.setProperty('--scale', scale.toFixed(3));
    // Gas-giant-ish worlds: dominate the orb with the cloud-top color (stored
    // in groundColor) rather than the sky-as-seen-from-surface tint, since
    // that's what we'd actually see from space.
    const isGasGiant = p.atmoDensity >= 1.8 || p.planetR > 30000e3;
    if (isGasGiant) {
      const cloud = pal.ground;
      const cloudLt = lt(cloud);
      const cloudMid = dk(cloud);
      const cloudDk = dk(cloud).replace('rgb', 'rgba').replace(')', ',1)');
      orb.style.background =
        `radial-gradient(circle at 30% 30%,` +
          ` ${lt(pal.nearSun)} 0%,` +
          ` ${cloudLt} 25%,` +
          ` ${cloudMid} 65%,` +
          ` rgb(${(cloud[0] * 0.45) | 0},${(cloud[1] * 0.45) | 0},${(cloud[2] * 0.45) | 0}) 100%)`;
    } else {
      orb.style.background =
        `radial-gradient(circle at 30% 30%,` +
          ` ${lt(pal.nearSun)} 0%,` +
          ` ${dk(pal.zenith)} 35%,` +
          ` ${dk(pal.horizonHaze)} 65%,` +
          ` ${dk(pal.ground)} 100%)`;
    }
    // Caption: bold name on top, source + star metadata in smaller text below
    const label = document.createElement('span');
    label.className = 'planet-label';
    const labelName = document.createElement('span');
    labelName.className = 'planet-label-name';
    labelName.textContent = btn.title;
    label.appendChild(labelName);
    const sourceChip = document.querySelector(`.presets-wrap .preset-btn[data-preset="${id}"]`);
    if (sourceChip) {
      const src  = sourceChip.querySelector('.preset-source');
      const star = sourceChip.querySelector('.preset-star');
      if (src) {
        const s = document.createElement('span');
        s.className = 'planet-label-source';
        s.innerHTML = src.innerHTML;
        label.appendChild(s);
      }
      if (star) {
        const s = document.createElement('span');
        s.className = 'planet-label-star';
        s.innerHTML = star.innerHTML;
        label.appendChild(s);
      }
    }
    btn.appendChild(orb);
    btn.appendChild(label);
    btn.addEventListener('click', () => applyPreset(id));
    bar.appendChild(btn);
  }

  // Update edge-fade classes based on scroll position so the mask only
  // fades the side that's actually clipped.
  function updateFadeClasses() {
    const max = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle('clip-left',  bar.scrollLeft > 1);
    bar.classList.toggle('clip-right', bar.scrollLeft < max - 1);
  }
  // Any horizontal scroll — wheel/trackpad/swipe/drag — switches the active
  // preset as soon as a new orb becomes the closest to center. No debounce:
  // we trigger as soon as the centered orb changes.
  let rafPending = false;
  // Scroll only updates the edge-fade classes; preset selection happens
   // exclusively through clicks and arrow keys.
  bar.addEventListener('scroll', updateFadeClasses, { passive: true });

  // Reserve enough side padding that the first or last orb can sit dead
  // center. Recomputed on resize because it depends on toolbar width.
  function updateSidePadding() {
    const firstIcon = bar.querySelector('.planet-icon');
    if (!firstIcon) return;
    const pad = Math.max(0, bar.clientWidth / 2 - firstIcon.offsetWidth / 2);
    bar.style.paddingLeft = `${pad}px`;
    bar.style.paddingRight = `${pad}px`;
  }
  updateSidePadding();
  window.addEventListener('resize', () => { updateSidePadding(); centerActiveOrb(false); });

  let centeringUntil = 0;
  function centerActiveOrb(smooth = true) {
    const active = bar.querySelector(`.planet-icon[data-preset="${state.preset}"]`);
    if (!active) return;
    const target = active.offsetLeft + active.offsetWidth / 2 - bar.clientWidth / 2;
    // Mark a window during which any incoming scroll events are programmatic
    // (caused by us). The scroll listener won't re-apply during that window.
    centeringUntil = performance.now() + (smooth ? 600 : 100);
    bar.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'instant' });
  }
  bar._isProgrammaticScroll = () => performance.now() < centeringUntil;
  bar._centerActive = centerActiveOrb;
  function syncActive() {
    bar.querySelectorAll('.planet-icon').forEach(b =>
      b.classList.toggle('active', b.dataset.preset === state.preset));
    centerActiveOrb(true);
  }
  window.addEventListener('preset-change', syncActive);
  // Initial center (after layout settles)
  requestAnimationFrame(() => { updateSidePadding(); syncActive(); updateFadeClasses(); });

  // Expose for the drag-end snap logic below
  bar._nearestPresetToCenter = () => {
    const center = bar.scrollLeft + bar.clientWidth / 2;
    let best = null, bestDist = Infinity;
    for (const icon of bar.querySelectorAll('.planet-icon')) {
      const iconCenter = icon.offsetLeft + icon.offsetWidth / 2;
      const d = Math.abs(iconCenter - center);
      if (d < bestDist) { bestDist = d; best = icon; }
    }
    return best?.dataset.preset;
  };

  // Arrow Left / Right to cycle planets (when focus isn't on an input)
  document.addEventListener('keydown', e => {
    if (state.lightboxModel) return;  // up/down already cycle models in lightbox
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const i = orbOrder.indexOf(state.preset);
    const next = orbOrder[(i + dir + orbOrder.length) % orbOrder.length];
    applyPreset(next);
  });
}

// Ground color picker + reset. The render loop updates the picker swatch
// each frame so it tracks preset changes without needing an event bus.
function wireGroundPicker() {
  const picker = document.getElementById('groundColor');
  const reset = document.getElementById('groundReset');
  const label = document.getElementById('vGround');
  if (!picker || !reset) return;
  const toHex = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  picker._sync = () => {
    if (document.activeElement === picker) return;  // don't fight user
    const src = state.groundOverride || state.groundColor;
    picker.value = '#' + src.map(toHex).join('');
    if (label) label.textContent = state.groundOverride ? 'custom' : 'planet';
  };
  picker.addEventListener('input', () => {
    const hex = picker.value;
    state.groundOverride = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    if (label) label.textContent = 'custom';
    scheduleRender();
  });
  reset.addEventListener('click', () => {
    state.groundOverride = null;
    picker._sync();
    scheduleRender();
  });
  picker._sync();
}

setupHourScrub();
wireControls();
wireProjectionToggles();
setupLightbox();   // wraps renderFn to also run updateLightboxReadouts
wireGroundPicker();
paintPresetButtons();

// Keep the ground picker swatch in sync with the active preset's color.
// applyPreset dispatches `preset-change` after it mutates state.
window.addEventListener('preset-change', () => {
  const picker = document.getElementById('groundColor');
  if (picker && picker._sync) picker._sync();
});

setupPlanetToolbar();

// Auto-set buttons: location → latitude, device orientation → view elev,
// today → day of year. Updates DOM slider + triggers its 'input' event so
// the existing wireControls handler does the rest.
function fireInput(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }

document.getElementById('geoBtn')?.addEventListener('click', e => {
  e.preventDefault();
  if (!navigator.geolocation) return;
  const btn = e.currentTarget;
  const orig = btn.innerHTML;
  btn.textContent = '…';
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = Math.max(-70, Math.min(70, Math.round(pos.coords.latitude)));
    const slider = document.getElementById('latitude');
    slider.value = lat;
    fireInput(slider);
    btn.innerHTML = orig;
  }, () => { btn.innerHTML = orig; }, { timeout: 5000, maximumAge: 30000 });
});

document.getElementById('doyBtn')?.addEventListener('click', e => {
  e.preventDefault();
  // Compute today's day-of-year on a 365-day (non-leap) calendar so the
  // result is stable across leap years and matches the slider's convention.
  const now = new Date();
  const md = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let doy = now.getDate();
  for (let i = 0; i < now.getMonth(); i++) doy += md[i];
  // Invert state.doy = ((slider - 1 + 354) % 365) + 1
  const v = ((doy - 1 - 354) % 365 + 365) % 365 + 1;
  const slider = document.getElementById('dayOfYear');
  slider.value = v;
  fireInput(slider);
});

document.getElementById('hourBtn')?.addEventListener('click', e => {
  e.preventDefault();
  const now = new Date();
  const h = Math.max(3, Math.min(22,
    now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600));
  const slider = document.getElementById('hour');
  slider.value = h.toFixed(2);
  fireInput(slider);
});

document.getElementById('turbBtn')?.addEventListener('click', async e => {
  e.preventDefault();
  if (!navigator.geolocation) return;
  const btn = e.currentTarget;
  const orig = btn.innerHTML;
  btn.textContent = '…';
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 300000 }));
    const { latitude, longitude } = pos.coords;
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
      `&current=aerosol_optical_depth`;
    const r = await fetch(url);
    const j = await r.json();
    const aod = j?.current?.aerosol_optical_depth;
    if (aod == null) throw new Error('no AOD in response');
    // Rough AOD → turbidity mapping (T = 1 + 8 * AOD), clamped to slider range
    const T = Math.max(1, Math.min(10, 1 + 8 * aod));
    const slider = document.getElementById('turbidity');
    slider.value = T.toFixed(1);
    fireInput(slider);
    btn.innerHTML = orig;
    btn.title = `Live AOD ${aod.toFixed(2)} → T ${T.toFixed(1)} (Open-Meteo)`;
  } catch (err) {
    btn.innerHTML = orig;
    btn.style.color = '#e36a6a';
    setTimeout(() => { btn.style.color = ''; }, 1500);
  }
});

document.getElementById('oriBtn')?.addEventListener('click', e => {
  e.preventDefault();
  const btn = e.currentTarget;
  if (btn._tracking) {
    window.removeEventListener('deviceorientation', btn._handler);
    btn._tracking = false;
    btn.style.color = '';
    return;
  }
  const start = () => {
    btn.style.color = '#6ee6a0';
    btn._tracking = true;
    btn._handler = ev => {
      if (ev.beta == null) return;
      const elev = Math.max(5, Math.min(90, Math.round(ev.beta)));
      const slider = document.getElementById('viewElev');
      if (parseFloat(slider.value) === elev) return;
      slider.value = elev;
      fireInput(slider);
    };
    window.addEventListener('deviceorientation', btn._handler);
  };
  // iOS 13+ permission gate
  const PERM = window.DeviceOrientationEvent?.requestPermission;
  if (typeof PERM === 'function') {
    PERM.call(window.DeviceOrientationEvent).then(r => { if (r === 'granted') start(); });
  } else {
    start();
  }
});

// While dragging a physical-parameter slider, strikethrough the titles of
// any models that are unaffected by that parameter. Mapping is conservative:
// "affects" means the model's shader actually reads the corresponding uniform.
{
  const ALL = MODELS;
  const AFFECTS = {
    turbidity:     ['preetham', 'hosek', 'cie'],
    latitude:      ALL,
    viewElev:      ALL,
    dayOfYear:     ALL,
    albedo:        ['hosek'],
    ozoneStrength: ['ozone'],
    atmoDensity:   ['rayleigh', 'nishita', 'hosek', 'ozone'],
    sunDistance:   ['rayleigh', 'nishita', 'hosek', 'ozone'],
    stellarTemp:   ALL,
    hour:          ALL,
  };
  const titles = {};
  const containers = {};
  for (const m of ALL) {
    const caret = document.querySelector(`.expand-caret[data-model="${m}"]`);
    const title = caret?.parentElement?.querySelector('.strip-title');
    if (title) titles[m] = title;
    containers[m] = caret?.closest('.strip-container');
  }
  function dimUnaffected(sliderId) {
    const affected = new Set(AFFECTS[sliderId] || ALL);
    for (const m of ALL) {
      const off = !affected.has(m);
      titles[m]?.classList.toggle('dim-during-drag', off);
      containers[m]?.classList.toggle('dim-during-drag', off);
    }
  }
  function clearDim() {
    for (const m of ALL) {
      titles[m]?.classList.remove('dim-during-drag');
      containers[m]?.classList.remove('dim-during-drag');
    }
  }
  for (const id of Object.keys(AFFECTS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('pointerdown', () => dimUnaffected(id));
    el.addEventListener('pointerup', clearDim);
    el.addEventListener('pointercancel', clearDim);
    el.addEventListener('blur', clearDim);
  }
}

// Move the "Notes" legend into the Planet Physics row's empty space.
{
  const notes = document.querySelector('.legend');
  const planet = document.getElementById('planetControls');
  if (notes && planet) planet.appendChild(notes);
}

// "Reset all" buttons next to each section label.
// Style → reset every style slider to its HTML default value.
// Planet Physics → re-apply the active preset (which restores the planet
// sliders to their preset values).
document.getElementById('resetStyle')?.addEventListener('click', () => {
  document.querySelectorAll('.controls.style input[type=range]').forEach(el => {
    el.value = el.getAttribute('value');
    fireInput(el);
  });
});
document.getElementById('resetPlanet')?.addEventListener('click', () => {
  applyPreset(state.preset);
  // Reset time-of-day separately (it isn't preset-derived)
  const hour = document.getElementById('hour');
  if (hour) { hour.value = hour.getAttribute('value'); fireInput(hour); }
});

// Mouse/touch drag-to-scroll on the planet toolbar. Distinguishes between
// drags (>5px) and clicks so icons remain clickable.
{
  const bar = document.getElementById('planetToolbar');
  if (bar) {
    let down = false, startX = 0, startScroll = 0, moved = 0;
    bar.addEventListener('pointerdown', e => {
      down = true;
      window._planetBarDragging = true;
      startX = e.clientX;
      startScroll = bar.scrollLeft;
      moved = 0;
      bar.style.cursor = 'grabbing';
    });
    window.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      bar.scrollLeft = startScroll - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      window._planetBarDragging = false;
      bar.style.cursor = '';
      if (moved > 5) {
        // Suppress the upcoming click so a drag doesn't also select a planet
        bar.addEventListener('click', ev => {
          ev.stopPropagation(); ev.preventDefault();
        }, { capture: true, once: true });
      }
    });
  }
}

// Layout toggle (Detail / Wall)
document.querySelectorAll('#layoutToggle .proj-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#layoutToggle .proj-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    document.body.dataset.layout = btn.dataset.layout;
    for (const p of panels) sizeCanvas(p);
    scheduleRender();
  });
});

// Stars toggle (On / Off)
document.querySelectorAll('#starsToggle .proj-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#starsToggle .proj-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    state.showStars = btn.dataset.stars === 'on';
    scheduleRender();
  });
});

// Planet-scale toggle (Visual / Actual)
document.querySelectorAll('#scaleToggle .proj-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#scaleToggle .proj-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    state.planetScale = btn.dataset.scale;
    applyOrbScales(state.planetScale);
  });
});

// White-balance toggle (Physical / Adapted)
document.querySelectorAll('#wbToggle .proj-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#wbToggle .proj-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    state.whiteBalance = btn.dataset.wb;
    scheduleRender();
  });
});

// ============================================================
// URL <-> state synchronization
// ============================================================
// Each param: parse(raw) → value | null; apply(value); read() → string | null
const URL_PARAMS = [
  {
    name: 'planet',
    parse: s => PRESETS[s] ? s : null,
    apply: v => applyPreset(v),
    read:  () => state.preset,
  },
  {
    name: 'hour',
    parse: s => { const v = parseFloat(s); return Number.isFinite(v) && v >= 3 && v <= 22 ? v : null; },
    apply: v => {
      state.hour = v;
      const el = document.getElementById('hour');
      if (el) { el.value = v.toFixed(2); fireInput(el); }
    },
    read:  () => state.hour.toFixed(2),
  },
  {
    name: 'lat',
    parse: s => { const v = parseFloat(s); return Number.isFinite(v) && v >= -70 && v <= 70 ? v : null; },
    apply: v => {
      const el = document.getElementById('latitude');
      if (el) { el.value = v; fireInput(el); }
    },
    read:  () => String(state.lat),
  },
  {
    name: 'doy',
    parse: s => { const v = parseInt(s, 10); return Number.isFinite(v) && v >= 1 && v <= 365 ? v : null; },
    apply: v => {
      // Param is the calendar (state.doy 1..365). Invert the slider's
      // winter-solstice offset to set the underlying slider value.
      const sliderVal = ((v - 1 - 354) % 365 + 365) % 365 + 1;
      const el = document.getElementById('dayOfYear');
      if (el) { el.value = sliderVal; fireInput(el); }
    },
    read:  () => String(state.doy),
  },
  {
    name: 't',
    parse: s => { const v = parseFloat(s); return Number.isFinite(v) && v >= 1 && v <= 10 ? v : null; },
    apply: v => {
      const el = document.getElementById('turbidity');
      if (el) { el.value = v; fireInput(el); }
    },
    read:  () => state.T.toFixed(1),
  },
  {
    name: 'proj',
    parse: s => ['sunfacing', 'equirect', 'fisheye'].includes(s) ? s : null,
    apply: v => {
      const btn = document.querySelector(`.proj-selector.global > .proj-btn[data-proj="${v}"]`);
      if (btn) btn.click();
    },
    read:  () => state.projection,
  },
  {
    name: 'layout',
    parse: s => ['standard', 'detail'].includes(s) ? s : null,
    apply: v => {
      const btn = document.querySelector(`#layoutToggle .proj-btn[data-layout="${v}"]`);
      if (btn) btn.click();
    },
    read:  () => document.body.dataset.layout || 'standard',
  },
  {
    name: 'scale',
    parse: s => ['visual', 'actual'].includes(s) ? s : null,
    apply: v => {
      const btn = document.querySelector(`#scaleToggle .proj-btn[data-scale="${v}"]`);
      if (btn) btn.click();
    },
    read:  () => state.planetScale,
  },
  {
    name: 'wb',
    parse: s => ['physical', 'adapted'].includes(s) ? s : null,
    apply: v => {
      const btn = document.querySelector(`#wbToggle .proj-btn[data-wb="${v}"]`);
      if (btn) btn.click();
    },
    read:  () => state.whiteBalance,
  },
];

function applyParamsFromURL() {
  const params = new URLSearchParams(window.location.search);
  for (const def of URL_PARAMS) {
    const raw = params.get(def.name);
    if (raw == null) continue;
    const v = def.parse(raw);
    if (v != null) def.apply(v);
  }
}
function writeParamsToURL() {
  const url = new URL(window.location);
  for (const def of URL_PARAMS) {
    const v = def.read?.();
    if (v == null) url.searchParams.delete(def.name);
    else url.searchParams.set(def.name, v);
  }
  history.replaceState(null, '', url);
}

// Initial state: local time as the default for `hour` (URL param overrides
// later), then Earth as the default preset (URL param overrides later).
{
  const now = new Date();
  const localH = now.getHours() + now.getMinutes() / 60;
  state.hour = Math.max(3, Math.min(22, localH));
  const hourSlider = document.getElementById('hour');
  if (hourSlider) {
    hourSlider.value = state.hour.toFixed(2);
    fireInput(hourSlider);
  }
  applyPreset('earth');
  // URL params win over defaults.
  applyParamsFromURL();
}

// Keep the URL in sync with state changes. Debounce a bit so rapid slider
// drags don't spam replaceState.
let urlWriteTimer = null;
function scheduleURLWrite() {
  clearTimeout(urlWriteTimer);
  urlWriteTimer = setTimeout(writeParamsToURL, 150);
}
window.addEventListener('preset-change', scheduleURLWrite);
for (const id of ['hour', 'latitude', 'dayOfYear', 'turbidity']) {
  document.getElementById(id)?.addEventListener('input', scheduleURLWrite);
}
// Toggle buttons (projection, layout, scale, wb)
for (const sel of ['.proj-selector.global > .proj-btn', '#layoutToggle .proj-btn', '#scaleToggle .proj-btn', '#wbToggle .proj-btn']) {
  document.querySelectorAll(sel).forEach(b => b.addEventListener('click', scheduleURLWrite));
}
