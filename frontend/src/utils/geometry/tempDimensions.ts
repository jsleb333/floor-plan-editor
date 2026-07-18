import type { Point, Wall } from '@/types/plan'

import { add, distance, dot, normalize, perpendicular, scale, sub } from './vec'
import { wallFaceOffsets } from './wallOutline'
import type { WallReference } from './wallOutline'

/** Unit-vector cross products below this magnitude count as parallel. */
const PARALLEL_TOLERANCE = 1e-6
/** Minimum shared span (inches) along the subject segment for a face to count as opposite. */
const MIN_OVERLAP_IN = 0.5
/** Gaps smaller than this are the subject's own body or a touching face — not a dimension. */
const MIN_GAP_IN = 1e-6

/** One live distance chip (spec S2a): face-to-face gap on one side of the dragged segment. */
export interface FaceGap {
  /** Side of the dragged segment's travel direction the neighbour face lies on. */
  side: 'left' | 'right'
  /** Face-to-face distance in inches. */
  distanceIn: number
  /** Chip anchor on the dragged wall's near face. */
  from: Point
  /** Chip anchor on the neighbour's facing face. */
  to: Point
}

/** Nearest parallel face gap per side; `null` when no parallel face exists on that side. */
export interface ParallelFaceGaps {
  left: FaceGap | null
  right: FaceGap | null
}

/** The dragged segment plus the wall properties that place its faces (spec S2a). */
export interface GapSubject {
  a: Point
  b: Point
  thicknessIn: number
  reference: WallReference
}

/**
 * Finds the nearest PARALLEL wall face on each side of a dragged segment,
 * measured face to face — from the dragged wall's near face to the
 * neighbour's facing face — like a tape measure between walls (spec S2a).
 * Other segments of the same wall count (the opposite side of a closed room
 * loop is the common case); the dragged segment and its adjacent segments do
 * not.
 *
 * @param subject The dragged segment and its wall's thickness/reference.
 * @param walls All walls to measure against (the subject's wall included).
 * @param exclude The dragged segment's wall id and segment index.
 */
export function parallelFaceGaps(
  subject: GapSubject,
  walls: readonly Wall[],
  exclude: { wallId: string; segmentIndex: number },
): ParallelFaceGaps {
  const u = normalize(sub(subject.b, subject.a))
  const p = perpendicular(u)
  const lengthIn = distance(subject.a, subject.b)
  const [ownLeft, ownRight] = wallFaceOffsets(subject.reference, subject.thicknessIn)

  let left: FaceGap | null = null
  let right: FaceGap | null = null

  for (const wall of walls) {
    const segmentCount = wall.closed ? wall.vertices.length : wall.vertices.length - 1
    const [faceLeft, faceRight] = wallFaceOffsets(wall.reference, wall.thickness_in)
    for (let j = 0; j < segmentCount; j++) {
      if (
        wall.id === exclude.wallId &&
        isAdjacentOrSelf(j, exclude.segmentIndex, segmentCount, wall.closed)
      ) {
        continue
      }
      const va = wall.vertices[j]
      const vb = wall.vertices[(j + 1) % wall.vertices.length]
      const uc = normalize(sub(vb, va))
      if (Math.abs(u.x * uc.y - u.y * uc.x) > PARALLEL_TOLERANCE) continue

      for (const offset of [faceLeft, faceRight]) {
        const fa = add(va, scale(perpendicular(uc), offset))
        const fb = add(vb, scale(perpendicular(uc), offset))
        const c = dot(sub(fa, subject.a), p)

        const t0 = dot(sub(fa, subject.a), u)
        const t1 = dot(sub(fb, subject.a), u)
        const lo = Math.max(Math.min(t0, t1), 0)
        const hi = Math.min(Math.max(t0, t1), lengthIn)
        if (hi - lo < MIN_OVERLAP_IN) continue
        const mid = (lo + hi) / 2

        if (c > ownLeft + MIN_GAP_IN) {
          const gap = c - ownLeft
          if (!left || gap < left.distanceIn) {
            left = chip('left', gap, subject.a, u, p, mid, ownLeft, c)
          }
        } else if (c < ownRight - MIN_GAP_IN) {
          const gap = ownRight - c
          if (!right || gap < right.distanceIn) {
            right = chip('right', gap, subject.a, u, p, mid, ownRight, c)
          }
        }
      }
    }
  }
  return { left, right }
}

function isAdjacentOrSelf(
  index: number,
  excluded: number,
  segmentCount: number,
  closed: boolean,
): boolean {
  if (Math.abs(index - excluded) <= 1) return true
  if (!closed) return false
  const wrap = Math.abs(index - excluded)
  return wrap === segmentCount - 1
}

function chip(
  side: 'left' | 'right',
  distanceIn: number,
  origin: Point,
  u: Point,
  p: Point,
  mid: number,
  ownOffset: number,
  neighbourOffset: number,
): FaceGap {
  const base = add(origin, scale(u, mid))
  return {
    side,
    distanceIn,
    from: add(base, scale(p, ownOffset)),
    to: add(base, scale(p, neighbourOffset)),
  }
}
