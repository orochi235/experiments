import vertSrc from './shaders/hello.vert.glsl';
import fragSrc from './shaders/hello.frag.glsl';

const canvas = document.getElementById('hello');
const gl = canvas.getContext('webgl2');
if (!gl) { document.body.textContent = 'WebGL2 not available'; throw new Error('no webgl2'); }

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertSrc));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(prog));
}

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'aPos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

gl.useProgram(prog);
gl.viewport(0, 0, canvas.width, canvas.height);
gl.uniform2f(gl.getUniformLocation(prog, 'uResolution'), canvas.width, canvas.height);
gl.drawArrays(gl.TRIANGLES, 0, 3);
