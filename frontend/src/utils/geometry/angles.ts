import type { Point } from '@/types/plan'

import { dot, normalize } from './vec'

const DIAGONAL = Math.SQRT1_2
const SNAP_STEP_DEG = 45

/**
 * The eight drawing directions allowed under angle snapping (spec S1):
 * 0°, 45°, 90°, ... relative to the GLOBAL axes, as exact unit vectors in
 * y-down screen space (index k is the direction at k × 45°).
 */
export const ALLOWED_DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: DIAGONAL, y: DIAGONAL },
  { x: 0, y: 1 },
  { x: -DIAGONAL, y: DIAGONAL },
  { x: -1, y: 0 },
  { x: -DIAGONAL, y: -DIAGONAL },
  { x: 0, y: -1 },
  { x: DIAGONAL, y: -DIAGONAL },
]

/**
 * Snaps a raw pointer direction to the nearest of the eight global-axis
 * directions (spec S1).
 *
 * Args mirror the drawing tool: `enabled` is false while the user holds the
 * free-angle modifier, in which case the normalized raw direction is returned
 * unchanged. A (near) zero `rawDir` snaps to +x when enabled, and returns the
 * zero vector when disabled.
 */
export function snapDirection(rawDir: Point, enabled: boolean): Point {
  const unit = normalize(rawDir)
  if (!enabled) return unit
  let best = ALLOWED_DIRECTIONS[0]
  let bestAlignment = -Infinity
  for (const direction of ALLOWED_DIRECTIONS) {
    const alignment = dot(unit, direction)
    if (alignment > bestAlignment) {
      bestAlignment = alignment
      best = direction
    }
  }
  return best
}

/** Rounds an angle in degrees to the nearest multiple of 45° (sign preserved, no normalization). */
export function snapAngleDeg(angleDeg: number): number {
  return Math.round(angleDeg / SNAP_STEP_DEG) * SNAP_STEP_DEG
}
