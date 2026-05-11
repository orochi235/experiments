import { sunElevation } from '../stars.js';

const PI = Math.PI;
const TAU = 2 * PI;

const ARC_COLORS = [
  'rgba(255,255,255,0.15)',
  'rgba(255,180,100,0.18)',
  'rgba(150,200,255,0.18)',
  'rgba(200,180,255,0.18)',
];
const HOUR_START = 3, HOUR_END = 22;

export function drawStripOverlay(ctx, state) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Sun-elevation arcs per star
  for (let si = 0; si < state.stars.length; si++) {
    const star = state.stars[si];
    ctx.strokeStyle = ARC_COLORS[si] || ARC_COLORS[0];
    ctx.lineWidth = 1;
    ctx.setLineDash(si === 0 ? [] : [3, 3]);
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const hour = HOUR_START + (x / w) * (HOUR_END - HOUR_START);
      const sElev = sunElevation(state.lat, state.doy, hour + star.hourOffset);
      const y = h - (sElev / (PI / 2)) * (h * 0.8) - h * 0.1;
      const yc = Math.max(0, Math.min(h, y));
      if (x === 0) ctx.moveTo(x, yc); else ctx.lineTo(x, yc);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Horizon
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.9); ctx.lineTo(w, h * 0.9);
  ctx.stroke();
  ctx.setLineDash([]);

  // Time cursor
  const cursorX = ((state.hour - HOUR_START) / (HOUR_END - HOUR_START)) * w;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(cursorX - 1, 0, 2, h);
}

// Pixel for (azDeg, elDeg) on a dome given projection mode + canvas dims.
// Port of viewAzElToPixel in source HTML line 2419-2444.
// Returns { x, y, visible }
function viewAzElToPixel(projection, az, elDeg, w, h) {
  if (elDeg <= 0) return { x: 0, y: 0, visible: false };
  if (projection === 'fisheye') {
    const r = (1 - elDeg / 90);
    const cx = w / 2, cy = h / 2;
    const azRad = az * PI / 180;
    const x = cx + Math.sin(azRad) * r * cx;
    const y = cy - Math.cos(azRad) * r * cy;
    return { x, y, visible: true };
  }
  if (projection === 'equirect') {
    const x = ((az + 180) / 360) * w;
    const y = (1 - elDeg / 90) * h * 0.9;
    return { x, y, visible: x >= 0 && x <= w };
  }
  // sunfacing: ±90° az
  const x = ((az + 90) / 180) * w;
  const y = (1 - elDeg / 90) * h * 0.9;
  return { x, y, visible: az >= -90 && az <= 90 };
}

export function drawDomeOverlay(ctx, state, modelName) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const projection = state.dome[modelName].projection;
  const SUN_RADIUS_DEG = 1.0;
  const GLOW_RATIO = 4;
  const pxPerDeg = projection === 'fisheye' ? (w / 2) / 90
                 : projection === 'sunfacing' ? w / 180
                 : w / 360;

  for (let si = 0; si < state.stars.length; si++) {
    const star = state.stars[si];
    if (star._elev == null || star._elev <= 0) continue;
    const sunElDeg = star._elev * 180 / PI;
    const { x, y, visible } = viewAzElToPixel(projection, star._azOff || 0, sunElDeg, w, h);
    if (!visible) continue;
    const rDisk = Math.max(2, pxPerDeg * SUN_RADIUS_DEG);
    const rGlow = rDisk * GLOW_RATIO;
    const [sr, sg, sb] = star.color;
    const R = Math.round(sr * 255), G = Math.round(sg * 255), B = Math.round(sb * 255);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rGlow);
    grad.addColorStop(0, `rgba(${R},${G},${B},1)`);
    grad.addColorStop(rDisk / rGlow, `rgba(${R},${G},${B},0.9)`);
    grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rGlow, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
