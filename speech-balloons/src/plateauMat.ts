// Clipper-erosion plateau computation.
//
// The Minkowski erosion of a polygon by a disk of radius r is exactly what
// inflatePathsD produces with a negative delta and round joins — this is the
// canonical "uniform-rim inset" / medial-axis-transform-equivalent for
// polygons. Sharp convex corners get rounded off (because the eroding disk
// can't reach into them); concave corners become sharper / can split the
// region into multiple components when the inset radius exceeds the local
// half-thickness.

import { offsetClosedPolygons, type Polygon } from './clipping';

/** MAT-equivalent plateau: polygons eroded by a disk of radius `bevelWidth`. */
export function computeMatPlateau(polys: Polygon[], bevelWidth: number): Polygon[] {
  if (polys.length === 0 || bevelWidth <= 0) return [];
  return offsetClosedPolygons(polys, -bevelWidth, 'round');
}
