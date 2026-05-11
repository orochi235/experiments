import { state, setRenderFn, scheduleRender, applyPreset } from './state.js';
import { createGL, makeFullscreenTriangle, recomputeDerived } from './render/gl.js';
import { buildPrograms } from './render/programs.js';
import { setSharedUniforms } from './render/uniforms.js';
import { wireControls } from './ui/controls.js';
import './styles.css';

const MODELS = ['rayleigh', 'preetham', 'nishita', 'hosek', 'ozone', 'cie'];
const cap = s => s[0].toUpperCase() + s.slice(1);

// Build panel registry by querying DOM
const panels = [];
for (const m of MODELS) {
  const stripCanvas = document.getElementById(`c${cap(m)}`);
  const domeCanvas = document.querySelector(`canvas.dome.gl[data-model="${m}"]`);
  if (stripCanvas) panels.push({ kind: 'strip', model: m, canvas: stripCanvas });
  if (domeCanvas)  panels.push({ kind: 'dome',  model: m, canvas: domeCanvas });
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
  const rect = p.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  let maxW, aspect;
  if (p.kind === 'strip') {
    maxW = 1500;
    aspect = rect.width / rect.height;
  } else {
    const proj = state.dome[p.model].projection;
    maxW = proj === 'fisheye' ? 720 : 1200;
    aspect = proj === 'fisheye' ? 1 : 2;
  }
  const w = Math.max(1, Math.round(Math.min(rect.width * dpr, maxW)));
  const h = Math.max(1, Math.round(w / aspect));
  if (p.canvas.width !== w || p.canvas.height !== h) {
    p.canvas.width = w;
    p.canvas.height = h;
  }
}
const ro = new ResizeObserver(() => {
  for (const p of panels) sizeCanvas(p);
  scheduleRender();
});
for (const p of panels) ro.observe(p.canvas);

const PROJ_MAP = { fisheye: 0, equirect: 1, sunfacing: 2 };

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
      const proj = PROJ_MAP[state.dome[p.model].projection] ?? 0;
      gl.uniform1i(gl.getUniformLocation(p.program, 'uProjection'), proj);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
setRenderFn(render);

wireControls();
applyPreset('earth');  // Initial render trigger (via scheduleRender)
