import vertSrc from './shaders/vert.glsl';
import fragSrc from './shaders/strip_preetham.glsl';
import { createGL, linkProgram, makeFullscreenTriangle, u } from './render/gl.js';

const canvas = document.getElementById('hello');
const gl = createGL(canvas);
const prog = linkProgram(gl, vertSrc, fragSrc);
const { vao, attrName } = makeFullscreenTriangle(gl);

gl.bindVertexArray(vao);
const aPos = gl.getAttribLocation(prog, attrName);
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

gl.useProgram(prog);
gl.viewport(0, 0, canvas.width, canvas.height);

// Set uniforms
gl.uniform2f(u(gl, prog, 'uResolution'), canvas.width, canvas.height);
gl.uniform1f(u(gl, prog, 'uT'), 3.0);
gl.uniform1f(u(gl, prog, 'uAlbedo'), 0.3);
gl.uniform1f(u(gl, prog, 'uOzone'), 1.0);
gl.uniform1f(u(gl, prog, 'uAlt'), 0.0);
gl.uniform1f(u(gl, prog, 'uViewElDeg'), 90.0);
gl.uniform1f(u(gl, prog, 'uHourStart'), 3.0);
gl.uniform1f(u(gl, prog, 'uHourEnd'), 22.0);
gl.uniform1f(u(gl, prog, 'uLat'), 40.0);
gl.uniform1f(u(gl, prog, 'uDoy'), 183.0);
gl.uniform1i(u(gl, prog, 'uNStars'), 1);
gl.uniform1fv(u(gl, prog, 'uStarElev'), new Float32Array(4));
gl.uniform1fv(u(gl, prog, 'uStarAzOff'), new Float32Array(4));
gl.uniform3fv(u(gl, prog, 'uStarColor'), new Float32Array([1,1,1, 0,0,0, 0,0,0, 0,0,0]));
gl.uniform1fv(u(gl, prog, 'uStarIntensity'), new Float32Array([1,0,0,0]));
gl.uniform1fv(u(gl, prog, 'uStarHourOffset'), new Float32Array(4));
gl.uniform1f(u(gl, prog, 'uScatterHueShift'), 0.0);
gl.uniform1f(u(gl, prog, 'uScatterSatBoost'), 1.0);
gl.uniform1f(u(gl, prog, 'uHueShift'), 0.0);
gl.uniform1f(u(gl, prog, 'uSaturation'), 1.0);
gl.uniform1f(u(gl, prog, 'uVibrance'), 0.0);
gl.uniform1f(u(gl, prog, 'uExposure'), 0.0);
gl.uniform1f(u(gl, prog, 'uContrast'), 1.0);
gl.uniform1f(u(gl, prog, 'uWarmth'), 0.0);
gl.uniform1f(u(gl, prog, 'uTwilightGlow'), 0.0);
gl.uniform1f(u(gl, prog, 'uNightTint'), 0.0);

gl.drawArrays(gl.TRIANGLES, 0, 3);
