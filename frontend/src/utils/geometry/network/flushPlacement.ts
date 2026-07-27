import type { Point, WallEnd, WallSide } from '@/types/plan'

import { EPSILON, add, cross, dot, normalize, perpendicular, scale, sub } from '../vec'
import { wallFaceOffsets } from '../wallOutline'
import type { WallReference } from '../wallOutline'
import type { ResolvedWall } from './networkGeometry'

/** A captured surface terminus: where it is, and which way the wall's body lies. */
export interface SurfaceAnchor {
  /** The visible corner where the surface ends. */
  corner: Point
  /** Unit normal from that corner into the wall's own body. */
  inward: Point
}

/**
 * The anchor for one surface of a wall at one of its free ends, or `null` when
 * that end is not free (a ring, or a degenerate wall).
 */
export function surfaceAnchor(
  resolved: ResolvedWall,
  side: WallSide,
  end: WallEnd,
): SurfaceAnchor | null {
  const terminus = resolved.ends[end]
  if (!terminus) return null
  const corner = side === 'left' ? terminus.left : terminus.right
  const opposite = side === 'left' ? terminus.right : terminus.left
  const inward = normalize(sub(opposite, corner))
  if (Math.abs(inward.x) <= EPSILON && Math.abs(inward.y) <= EPSILON) return null
  return { corner: { ...corner }, inward }
}

/** Distance from a wall's spine to its own surface on `side` (always positive or zero). */
export function spineToSurface(
  thicknessIn: number,
  reference: WallReference,
  side: WallSide,
): number {
  const [left, right] = wallFaceOffsets(reference, thicknessIn)
  return Math.abs(side === 'left' ? left : right)
}

/** Which of a wall's surfaces faces `inward` when the wall travels along `direction`. */
export function sharedSide(direction: Point, inward: Point): WallSide {
  return dot(perpendicular(direction), inward) < 0 ? 'left' : 'right'
}

/** A flush placement: where the new wall's spine goes, and which of its surfaces is shared. */
export interface FlushPlacement {
  point: Point
  side: WallSide
}

/**
 * Places a new wall's spine so that one of ITS surfaces continues a captured
 * surface — the join that makes walls of unequal thickness read as one wall
 * (`docs/WALL_NETWORK.md` §6).
 *
 * The offset is perpendicular to the shared surface, so it does not depend on
 * how far the new wall runs — only on which way it runs, which decides which of
 * its two surfaces is the shared one. That is why the caller must supply a
 * direction, and why the placement is settled on the second click rather than
 * guessed at the first.
 *
 * Returns `null` for a direction that is not parallel to the surface: those are
 * a corner or a T, not a continuation.
 */
export function flushSpinePoint(
  anchor: SurfaceAnchor,
  direction: Point,
  thicknessIn: number,
  reference: WallReference,
): FlushPlacement | null {
  const unit = normalize(direction)
  if (Math.abs(unit.x) <= EPSILON && Math.abs(unit.y) <= EPSILON) return null
  // Parallel to the surface means perpendicular to its inward normal.
  if (Math.abs(dot(unit, anchor.inward)) > EPSILON) return null
  if (Math.abs(cross(unit, perpendicular(anchor.inward))) > EPSILON) return null

  const side = sharedSide(unit, anchor.inward)
  const offset = spineToSurface(thicknessIn, reference, side)
  return { point: add(anchor.corner, scale(anchor.inward, offset)), side }
}
