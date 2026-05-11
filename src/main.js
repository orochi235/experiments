import vertSrc from './shaders/hello.vert.glsl';
import fragSrc from './shaders/hello.frag.glsl';
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
gl.uniform2f(u(gl, prog, 'uResolution'), canvas.width, canvas.height);
gl.drawArrays(gl.TRIANGLES, 0, 3);
