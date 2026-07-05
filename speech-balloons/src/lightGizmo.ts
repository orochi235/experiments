// Forward/inverse projection for the draggable light gizmos. Forward mirrors
// the debug-overlay lollipop (SpeechBalloon debugOverlay memo): ground point
// at dist·cos(el) along az, disc lifted by 0.6·dist·sin(el) in screen −y.
// Inverse: with u = (px−cx)/dist, v = (py−cy)/dist,
//   u = cos(el)·cos(az)
//   v = cos(el)·sin(az) − 0.6·sin(el)
// Eliminating az: f(el) = u² + (v + 0.6·sin el)² − cos²el = 0.
//
// f is unimodal on [0°, 90°]: its derivative is 2·cos(el)·(0.6·v + 1.36·sin(el))
// (1.36 = 1 + 0.6²), which has a single interior zero at
// sin(el) = −0.6·v / 1.36 (clamped to [0, 1]). Left of that point f is
// decreasing, right of it f is increasing — so the global minimum on the
// domain sits there. When v < 0 (pointer above center) f(0) can be positive
// even though the true solution lies past the dip, so the minimum — not
// f(0) — is what determines reachability. Given a non-positive minimum,
// exactly one root lies between it and 90° (f rises monotonically to
// f(90°) = u² + (v+0.6)²), and bisection there is safe. A second, mirror
// root can exist below the minimum when f(0) > 0; it maps to the same
// on-screen point and is intentionally not returned.
const LIFT = 0.6;

export function discPosition(
  azDeg: number, elDeg: number,
  cx: number, cy: number, dist: number,
): { x: number; y: number } {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const ce = Math.cos(el);
  return {
    x: cx + dist * ce * Math.cos(az),
    y: cy + dist * ce * Math.sin(az) - dist * LIFT * Math.sin(el),
  };
}

export function pointerToAzEl(
  px: number, py: number,
  cx: number, cy: number, dist: number,
): { az: number; el: number } {
  const u = (px - cx) / dist;
  const v = (py - cy) / dist;
  const f = (elRad: number) => {
    const s = Math.sin(elRad);
    const c = Math.cos(elRad);
    return u * u + (v + LIFT * s) * (v + LIFT * s) - c * c;
  };
  const sCrit = Math.min(1, Math.max(0, (-LIFT * v) / (1 + LIFT * LIFT)));
  const elCrit = Math.asin(sCrit);
  const hi0 = Math.PI / 2;
  let el: number;
  if (f(elCrit) > 0) {
    el = 0;           // whole curve stays outside — clamp to the ground ring
  } else if (f(hi0) <= 0) {
    el = hi0;         // exactly the lifted-apex point
  } else {
    let lo = elCrit, hi = hi0;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    el = (lo + hi) / 2;
  }
  const az = Math.atan2(v + LIFT * Math.sin(el), u);
  return {
    az: ((az * 180) / Math.PI + 360) % 360,
    el: Math.min(90, Math.max(0, (el * 180) / Math.PI)),
  };
}
