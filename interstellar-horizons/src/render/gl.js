// Shared WebGL2 helpers: program compile/link, fullscreen-triangle VAO,
// uniform location caching. All panels reuse the same VAO (the verts are
// generic enough that no per-program attribute binding is needed).

// Every live context, so a color-space toggle can retag all drawing buffers.
const CONTEXTS = [];
let currentColorSpace = 'srgb';

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 not available');
  CONTEXTS.push(gl);
  if (currentColorSpace !== 'srgb' && 'drawingBufferColorSpace' in gl) {
    gl.drawingBufferColorSpace = currentColorSpace;
  }
  return gl;
}

// 'srgb' | 'display-p3'. Tags every drawing buffer so the browser composites
// our (already gamut-converted) pixel values without remapping them.
export function setDrawingBufferColorSpace(cs) {
  currentColorSpace = cs;
  for (const gl of CONTEXTS) {
    if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = cs;
  }
}

// Runtime probe: can the drawing buffer actually be tagged with this color
// space in this browser? Per WebIDL, assigning an unsupported enum value to
// drawingBufferColorSpace is silently ignored (or throws), so attempt the
// assignment on a real context and check whether it stuck.
let scratchGL = null;
export function colorSpaceSupported(cs) {
  if (cs === 'srgb') return true;
  if (typeof WebGL2RenderingContext === 'undefined' ||
      !('drawingBufferColorSpace' in WebGL2RenderingContext.prototype)) return false;
  const gl = CONTEXTS[0] ||
    (scratchGL ??= document.createElement('canvas').getContext('webgl2'));
  if (!gl) return false;
  const prev = gl.drawingBufferColorSpace;
  let ok = false;
  try {
    gl.drawingBufferColorSpace = cs;
    ok = gl.drawingBufferColorSpace === cs;
  } catch { ok = false; }
  try { gl.drawingBufferColorSpace = prev; } catch { /* leave as-is */ }
  return ok;
}

export function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    throw new Error(`shader compile failed:\n${log}\n\n--- source ---\n${src}`);
  }
  return s;
}

export function linkProgram(gl, vertSrc, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

export function makeFullscreenTriangle(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, attrName: 'aPos' };
}

// Cache uniform locations on the program object itself.
export function u(gl, prog, name) {
  if (!prog._u) prog._u = {};
  if (prog._u[name] === undefined) prog._u[name] = gl.getUniformLocation(prog, name);
  return prog._u[name];
}

import { sunPos, angleDiffRad } from '../stars.js';

// Fill state.stars[i]._elev and _azOff for the current hour/lat/doy.
// Primary star sits at azOff = 0; secondaries are offset by their sky azimuth
// relative to the primary's.
export function recomputeDerived(state, selectedHour) {
  const lat = state.lat, doy = state.doy;
  const primary = sunPos(lat, doy, selectedHour + state.stars[0].hourOffset);
  for (const s of state.stars) {
    const p = sunPos(lat, doy, selectedHour + s.hourOffset);
    s._elev = p[0];
    s._azOff = angleDiffRad(p[1], primary[1]) * 180 / Math.PI;
  }
  state._primarySunElev = primary[0];
}
