import { describe, expect, it } from 'vitest';
import { discPosition, pointerToAzEl } from './lightGizmo';

const cx = 100, cy = 80, dist = 150;

describe('light gizmo projection', () => {
  it('discPosition matches the overlay lollipop math', () => {
    // az 0, el 0: disc sits on the +x ground ring, no lift.
    expect(discPosition(0, 0, cx, cy, dist)).toEqual({ x: cx + dist, y: cy });
    // el 90: ground collapses to center, disc lifted by 0.6·dist.
    const top = discPosition(123, 90, cx, cy, dist);
    expect(top.x).toBeCloseTo(cx, 6);
    expect(top.y).toBeCloseTo(cy - 0.6 * dist, 6);
  });

  it.each([
    [0, 0], [0, 45], [0, 90],
    [90, 30], [180, 45], [270, 55], [315, 80], [45, 10],
  ])('round-trips az=%i el=%i', (az, el) => {
    const p = discPosition(az, el, cx, cy, dist);
    const back = pointerToAzEl(p.x, p.y, cx, cy, dist);
    expect(back.el).toBeCloseTo(el, 1);
    // az is undefined at el=90 (disc sits on the vertical axis) — skip there.
    if (el < 89) {
      const azDiff = Math.abs(((back.az - az + 540) % 360) - 180);
      expect(azDiff).toBeCloseTo(0, 1);
    }
  });

  it('clamps pointers outside the reachable annulus', () => {
    // Way outside the ground ring → el clamps to 0, az follows the pointer.
    const far = pointerToAzEl(cx + 10 * dist, cy, cx, cy, dist);
    expect(far.el).toBe(0);
    expect(far.az).toBeCloseTo(0, 1);
    // The canvas center is genuinely reachable: at az 90° the lift term
    // cancels the ground offset when tan(el) = 1/0.6 → el ≈ 59.04°.
    const center = pointerToAzEl(cx, cy, cx, cy, dist);
    expect(center.az).toBeCloseTo(90, 1);
    expect(center.el).toBeCloseTo(59.04, 1);
  });
});
