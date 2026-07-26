import type { Device, Dimension, Label, Opening, Point, Stairs, Wall } from '@/types/plan'
import {
  deviceWorldPlacement,
  dimensionHitTest,
  labelBounds,
  openingWorldRect,
  pointInPolygon,
  stairsCorners,
} from '@/utils/geometry'

/**
 * Per-kind canvas hit-tests shared by the select tool (spec E2) and the
 * placement tools' edit-in-tool clicks (spec E8). Lists are scanned
 * topmost-first (last drawn wins), mirroring render order.
 */

/** Topmost opening whose world rectangle contains `point`, else null. */
export function openingAtPoint(
  point: Point,
  openings: readonly Opening[],
  walls: readonly Wall[],
): Opening | null {
  for (let i = openings.length - 1; i >= 0; i--) {
    const wall = walls.find((candidate) => candidate.id === openings[i].wall_id)
    if (!wall) continue
    const rect = openingWorldRect(wall, openings[i])
    if (rect && pointInPolygon(point, rect)) return openings[i]
  }
  return null
}

/** Topmost stair run containing `point`, else null. */
export function stairsAtPoint(point: Point, stairs: readonly Stairs[]): Stairs | null {
  for (let i = stairs.length - 1; i >= 0; i--) {
    if (stairs[i].length_in > 0 && pointInPolygon(point, stairsCorners(stairs[i]))) {
      return stairs[i]
    }
  }
  return null
}

/** Topmost label whose text box contains `point`, else null. */
export function labelAtPoint(point: Point, labels: readonly Label[]): Label | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    const bounds = labelBounds(labels[i])
    if (
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    ) {
      return labels[i]
    }
  }
  return null
}

/** Topmost dimension whose figure is within `toleranceIn` of `point`, else null. */
export function dimensionAtPoint(
  point: Point,
  dimensions: readonly Dimension[],
  toleranceIn: number,
): Dimension | null {
  for (let i = dimensions.length - 1; i >= 0; i--) {
    if (dimensionHitTest(dimensions[i], point, toleranceIn)) return dimensions[i]
  }
  return null
}

/** Topmost device whose pictogram box contains `point`, else null. */
export function deviceAtPoint(
  point: Point,
  devices: readonly Device[],
  walls: readonly Wall[],
): Device | null {
  for (let i = devices.length - 1; i >= 0; i--) {
    const placement = deviceWorldPlacement(devices[i], walls)
    if (placement && pointInPolygon(point, placement.bounds)) return devices[i]
  }
  return null
}
