// 2-pass Euclidean Distance Transform (Felzenszwalb–Huttenlocher 2012)
// applied to the alpha channel of a rasterized silhouette.
//
// Usage:
//   const heightmap = buildDistanceFieldImage(bodyPath, bbox, 256);
//   <feImage href={heightmap.dataUrl} x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} />

const INF = 1e20;

// 1-D squared-distance transform of `f` along an axis of length `n`.
// Writes results into `out`. `v` and `z` are scratch buffers (length n and n+1).
function dt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

// Squared-distance transform of a 2-D binary image (1 inside, 0 outside).
// Output values are squared distance from each interior pixel to the nearest
// outside pixel. Pixels marked outside get distance 0.
function distanceTransform2D(inside: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const f = new Float64Array(Math.max(w, h));
  const tmp = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  // Initialize: outside = 0, inside = +INF (distance from outside is infinite
  // until we propagate).
  for (let i = 0; i < w * h; i++) out[i] = inside[i] ? INF : 0;

  // Columns first.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    dt1d(f, h, tmp, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = tmp[y];
  }
  // Rows.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    dt1d(f, w, tmp, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = tmp[x];
  }
  return out;
}

export interface DistanceFieldImage {
  dataUrl: string;
  width: number;
  height: number;
}

// Rasterize an SVG path to a canvas, run a 2-D Euclidean DT on the alpha
// channel, and return a PNG data URL where pixel alpha = normalized distance
// to the nearest exterior pixel (max distance → 255). Used as a heightmap
// input for the lit-bevel fill filter.
export function buildDistanceFieldImage(
  bodyPath: string,
  bbox: { x: number; y: number; w: number; h: number },
  resolution: number,
): DistanceFieldImage | null {
  if (typeof document === 'undefined' || bbox.w <= 0 || bbox.h <= 0) return null;

  // Scale so the longer axis = `resolution`, preserving aspect ratio.
  const scale = resolution / Math.max(bbox.w, bbox.h);
  const w = Math.max(2, Math.round(bbox.w * scale));
  const h = Math.max(2, Math.round(bbox.h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Translate the path into the canvas coordinate space and draw filled white.
  ctx.fillStyle = '#fff';
  ctx.translate(-bbox.x * scale, -bbox.y * scale);
  ctx.scale(scale, scale);
  const p = new Path2D(bodyPath);
  ctx.fill(p);

  // Read alpha → binary inside mask.
  const img = ctx.getImageData(0, 0, w, h);
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;

  // Compute squared distance transform → Euclidean distance.
  const sq = distanceTransform2D(inside, w, h);
  let maxDist = 0;
  for (let i = 0; i < w * h; i++) {
    const d = Math.sqrt(sq[i]);
    if (d > maxDist) maxDist = d;
    img.data[i * 4 + 0] = 0;
    img.data[i * 4 + 1] = 0;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = d; // temporarily store distance in alpha; rescaled below
  }

  // Normalize alpha so the deepest interior pixel = 255.
  const norm = maxDist > 0 ? 255 / maxDist : 0;
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4 + 3] = Math.min(255, Math.round(img.data[i * 4 + 3] * norm));
  }

  ctx.putImageData(img, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}
