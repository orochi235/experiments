/**
 * Anchors closer than this in x are treated as the same point (seam
 * dedup, endpoint dedup). Kept tight so legitimate sub-pixel placement
 * still works.
 */
export const SEAM_X_EPS = 1e-4;

type Anchor = { x: number; y: number };

function flatToAnchors(flat: readonly number[]): Anchor[] {
  const out: Anchor[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

function anchorsToFlat(anchors: readonly Anchor[]): number[] {
  const out: number[] = [];
  for (const a of anchors) out.push(a.x, a.y);
  return out;
}

/**
 * Piecewise-affine remap of contour anchors when the partition at x=b
 * moves from `bOld` to `bNew`, with the seam y forced to `seamY`.
 *
 * Mapping rules:
 *   x = 0         → 0
 *   x ∈ (0, bOld) → x * (bNew / bOld)
 *   x = bOld      → bNew    (this anchor becomes the seam at y=seamY)
 *   x ∈ (bOld, 1) → bNew + (x − bOld) * (1 − bNew) / (1 − bOld)
 *   x = 1         → 1
 *
 * Postconditions:
 *   - exactly one anchor at x within SEAM_X_EPS of bNew (with y = seamY)
 *   - anchors sorted by x ascending
 *   - endpoints at x=0 and x=1 preserved
 *
 * Assumes 0 < bOld < 1 and 0 < bNew < 1 (the partition is UI-clamped to
 * [0.05, 0.95], so the divisors are never near zero in practice).
 */
export function remapAcrossPartition(
  values: readonly number[],
  bOld: number,
  bNew: number,
  seamY: number,
): number[] {
  const anchors = flatToAnchors(values);
  const bevelScale = bNew / bOld;
  const splineScale = (1 - bNew) / (1 - bOld);

  const remapped: Anchor[] = [];
  for (const a of anchors) {
    // Skip the old seam — we always emit a fresh one below.
    if (Math.abs(a.x - bOld) < SEAM_X_EPS) continue;
    // Endpoints pass through with x clamped to 0/1.
    if (a.x <= 0) { remapped.push({ x: 0, y: a.y }); continue; }
    if (a.x >= 1) { remapped.push({ x: 1, y: a.y }); continue; }
    // Interior: remap by side.
    if (a.x < bOld) remapped.push({ x: a.x * bevelScale, y: a.y });
    else            remapped.push({ x: bNew + (a.x - bOld) * splineScale, y: a.y });
  }
  // Emit the fresh seam anchor.
  remapped.push({ x: bNew, y: seamY });
  // Sort by x; in case of near-duplicate (numerical) seam vs interior,
  // sort is stable enough — the SEAM_X_EPS dedup below trims any neighbor
  // that landed within epsilon of the seam.
  remapped.sort((a, b) => a.x - b.x);
  // Dedup near-duplicates by x, preferring the seam-y at x=bNew.
  const deduped: Anchor[] = [];
  for (const a of remapped) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.x - a.x) < SEAM_X_EPS) {
      // Keep whichever is the seam (x near bNew).
      if (Math.abs(a.x - bNew) < SEAM_X_EPS) deduped[deduped.length - 1] = a;
      // else: drop a; keep prev.
      continue;
    }
    deduped.push(a);
  }
  return anchorsToFlat(deduped);
}
