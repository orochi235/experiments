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
 * Linear-interp the contour's y at a given x. Mirrors the parser used by
 * SpeechBalloon's contour memo so a synthetic seam y matches what the
 * shading actually sees. Clamps outside the anchor range; tolerates
 * unsorted input.
 */
export function interpFlat(flat: readonly number[], x: number): number {
  const cpts = flatToAnchors(flat);
  cpts.sort((a, b) => a.x - b.x);
  if (cpts.length === 0) return 0;
  if (x <= cpts[0]!.x) return cpts[0]!.y;
  if (x >= cpts[cpts.length - 1]!.x) return cpts[cpts.length - 1]!.y;
  let i = 0;
  while (i < cpts.length - 1 && cpts[i + 1]!.x < x) i++;
  const a = cpts[i]!;
  const b = cpts[i + 1]!;
  const u = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * u;
}

/**
 * Reconcile the contour with a partition that moved from `bPrev` to `b`
 * without the contour being updated alongside it (the bevel-width slider
 * does exactly this — it writes only `bevelWidth`).
 *
 * Returns the migrated flat array, or null when the contour already has
 * a seam anchor at `b` and nothing needs to change.
 *
 *   - seam at `b` already        → null
 *   - seam at `bPrev`            → remapAcrossPartition (the seam MOVES,
 *     keeping its y — same proportional remap as a partition drag, so a
 *     slider tick never strands the old seam as a stray anchor)
 *   - no seam on either side     → insert an interpolated anchor at `b`
 *     (first mount of a stored contour that predates the seam invariant)
 */
export function migrateSeam(
  values: readonly number[],
  bPrev: number,
  b: number,
): number[] | null {
  const anchors = flatToAnchors(values);
  if (anchors.some((a) => Math.abs(a.x - b) < SEAM_X_EPS)) return null;
  const prevSeam = anchors.find((a) => Math.abs(a.x - bPrev) < SEAM_X_EPS);
  if (prevSeam) return remapAcrossPartition(values, bPrev, b, prevSeam.y);
  const seamY = interpFlat(values, b);
  const sorted = [...anchors].sort((p, q) => p.x - q.x);
  const out: Anchor[] = [];
  let inserted = false;
  for (const p of sorted) {
    if (!inserted && p.x > b) {
      out.push({ x: b, y: seamY });
      inserted = true;
    }
    out.push(p);
  }
  if (!inserted) out.push({ x: b, y: seamY });
  return anchorsToFlat(out);
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
