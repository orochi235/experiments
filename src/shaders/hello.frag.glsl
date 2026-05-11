#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  fragColor = vec4(uv.x, uv.y, 0.5, 1.0);
}
