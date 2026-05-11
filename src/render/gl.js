// Shared WebGL2 helpers: program compile/link, fullscreen-triangle VAO,
// uniform location caching. All panels reuse the same VAO (the verts are
// generic enough that no per-program attribute binding is needed).

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 not available');
  return gl;
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
