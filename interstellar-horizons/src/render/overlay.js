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
// Returns position even for slightly-below-horizon stars so the horizon clip
// can cut the glow cleanly. `visible` here means "in this projection's lateral
// field-of-view" (not "above horizon").
function viewAzElToPixel(projection, az, elDeg, w, h) {
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

// Cached star field shared across all panels. Each entry is normalized so it
// scales to any canvas size. Generated once, lazily.
let STARS = null;
function getStars() {
  if (STARS) return STARS;
  STARS = [];
  // Lightweight LCG for stable random-looking positions
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  for (let i = 0; i < 140; i++) {
    STARS.push({
      x: rand(),
      y: rand(),               // 0..1 over the sky region
      r: rand() * 0.7 + 0.3,   // pixel radius
      brightness: Math.pow(rand(), 2.5) * 0.85 + 0.15,
    });
  }
  return STARS;
}

function drawStarfield(ctx, state, w, h, projection) {
  if (!state.showStars) return;
  const primaryElev = state._primarySunElev ?? 0;
  // Stars are always present; sky luminance overwhelms them. Approximate that:
  // skyBrightness ∝ max(0, sin(sunElev)). Star visibility ≈ 1 / (1 + k * b^p).
  // Tuned so they're faintly visible deep in twilight, almost gone at noon.
  const skyB = Math.max(0, Math.sin(primaryElev));
  const nightFactor = 1 / (1 + 35 * Math.pow(skyB, 0.45));
  if (nightFactor < 0.02) return;

  const stars = getStars();
  ctx.save();
  for (const s of stars) {
    const a = (s.brightness * nightFactor).toFixed(3);
    ctx.fillStyle = `rgba(255,255,240,${a})`;
    let sx, sy;
    if (projection === 'fisheye') {
      // Map (x,y) ∈ [0,1]² into the inscribed circle, polar-uniform
      const angle = s.x * TAU;
      const radius = Math.sqrt(s.y) * Math.min(w, h) / 2;
      sx = w / 2 + Math.cos(angle) * radius;
      sy = h / 2 + Math.sin(angle) * radius;
    } else {
      sx = s.x * w;
      sy = s.y * h * 0.9;  // sky region only
    }
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// Static deep-space starfield — the planet toolbar's backdrop. Same cached
// field as the previews, but at constant brightness: there's no local sun
// in the toolbar's "space" to wash the stars out.
export function drawBackgroundStarfield(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  for (const s of getStars()) {
    ctx.fillStyle = `rgba(255,255,240,${(s.brightness * 0.9).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, TAU);
    ctx.fill();
  }
}

export function drawDomeOverlay(ctx, state, modelName) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const projection = state.projection;
  const GLOW_RATIO = 4;
  const pxPerDeg = projection === 'fisheye' ? (w / 2) / 90
                 : projection === 'sunfacing' ? w / 180
                 : w / 360;

  // Constrain the glow to the visible-sky region of each projection.
  // Equirect/sunfacing: sky is the top 90% of canvas (in canvas2D coords).
  // Fisheye: sky is the inscribed circle.
  ctx.save();
  ctx.beginPath();
  if (projection === 'fisheye') {
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, TAU);
  } else {
    ctx.rect(0, 0, w, h * 0.9);
  }
  ctx.clip();

  // Stars first so the sun-glow draws over them
  drawStarfield(ctx, state, w, h, projection);

  for (let si = 0; si < state.stars.length; si++) {
    const star = state.stars[si];
    if (star._elev == null) continue;
    const sunElDeg = star._elev * 180 / PI;
    // Stop drawing once the entire glow disc would sit below horizon
    const tempK = star.temp || 5778;
    const relativeR = Math.pow(tempK / 5778, 1.14);
    const SUN_RADIUS_DEG = Math.max(0.05, 0.5 * relativeR / (state.sunDist || 1));
    const glowRadiusDeg = SUN_RADIUS_DEG * GLOW_RATIO;
    if (sunElDeg < -glowRadiusDeg) continue;

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
  ctx.restore();
}
