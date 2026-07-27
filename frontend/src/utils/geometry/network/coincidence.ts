import type { Joint, Wall, WallEndRef, WallSide } from '@/types/plan'

import { projectPointOnSegment } from '../lines'
import { EPSILON, cross, distance, dot, sub } from '../vec'
import { wallFaceOffsets } from '../wallOutline'
import { capOf, endFrame, wallGeometry } from './endFrame'
import type { EndFrame, WallGeometry } from './endFrame'
import { cornerJointId, flushJointId, teeJointId } from './jointIdentity'
import { endKey } from './wallGraph'

/** Default coincidence tolerance: an eighth of an inch, the editor's display precision. */
export const COINCIDENCE_TOLERANCE_IN = 0.125

/**
 * Derives the joint graph from wall geometry alone (`docs/WALL_NETWORK.md` §9).
 *
 * Ends sharing a point become a corner; an end landing on another wall's body
 * becomes a tee; parallel ends whose surfaces are collinear and whose bodies
 * abut become flush. Ids are derived from the parties, so re-deriving an
 * unchanged document yields identical joints — the function is idempotent and
 * safe to run as a repair on any plan, not only at migration time.
 *
 * Detection order matters: a corner claims its ends before the tee and flush
 * passes look at them, so a wall ending exactly at another's endpoint is a
 * corner rather than a degenerate tee.
 */
export function deriveJoints(
  walls: readonly Wall[],
  toleranceIn: number = COINCIDENCE_TOLERANCE_IN,
): Joint[] {
  const geometries = new Map<string, WallGeometry>()
  const frames = new Map<string, EndFrame>()
  for (const wall of walls) {
    if (!(wall.thickness_in > 0)) continue
    const geometry = wallGeometry(wall)
    geometries.set(wall.id, geometry)
    for (const end of ['start', 'end'] as const) {
      const frame = endFrame(geometry, end)
      if (frame) frames.set(endKey(wall.id, end), frame)
    }
  }

  const joints: Joint[] = []
  const claimed = new Set<string>()
  collectCorners(frames, toleranceIn, joints, claimed)
  collectTees(frames, geometries, toleranceIn, joints, claimed)
  collectFlush(frames, toleranceIn, joints, claimed)
  return joints
}

/** Groups ends that share a point into one corner joint each. */
function collectCorners(
  frames: ReadonlyMap<string, EndFrame>,
  toleranceIn: number,
  into: Joint[],
  claimed: Set<string>,
): void {
  const groups: EndFrame[][] = []
  for (const frame of frames.values()) {
    // A wall's own two ends never form a corner: coincident ends make it a ring,
    // which `wallSpine` already folds away, so a match here is a degenerate stub.
    const group = groups.find(
      (candidate) =>
        candidate.every((member) => member.wallId !== frame.wallId) &&
        candidate.some((member) => distance(member.spine, frame.spine) <= toleranceIn),
    )
    if (group) group.push(frame)
    else groups.push([frame])
  }

  for (const group of groups) {
    if (group.length < 2) continue
    const ends = group.map(refOf)
    for (const frame of group) claimed.add(endKey(frame.wallId, frame.end))
    into.push({ id: cornerJointId(ends), kind: 'corner', ends, rule: 'miter' })
  }
}

/**
 * Finds unclaimed ends that land on another wall's BODY, interior to one of its
 * segments.
 *
 * The test is against the body band, not the spine: an honestly stored endpoint
 * sits on the host's surface, half a thickness away from its spine, while a
 * legacy endpoint sits on the spine itself. Both are the same T, so both are
 * accepted — which is what lets this function heal an unconverted plan.
 *
 * Landings within `toleranceIn` of either end of the host segment are left
 * alone: that is a corner or a flush continuation, for the passes either side
 * of this one to claim.
 */
function collectTees(
  frames: ReadonlyMap<string, EndFrame>,
  geometries: ReadonlyMap<string, WallGeometry>,
  toleranceIn: number,
  into: Joint[],
  claimed: Set<string>,
): void {
  for (const frame of frames.values()) {
    const key = endKey(frame.wallId, frame.end)
    if (claimed.has(key)) continue

    let best: { wallId: string; segmentIndex: number; distance: number } | null = null
    for (const geometry of geometries.values()) {
      if (geometry.wall.id === frame.wallId) continue
      const { points, closed } = geometry.spine
      const [leftOffset, rightOffset] = wallFaceOffsets(
        geometry.wall.reference,
        geometry.wall.thickness_in,
      )
      const count = closed ? points.length : points.length - 1
      for (let i = 0; i < count; i++) {
        const a = points[i]
        const b = points[(i + 1) % points.length]
        const projection = projectPointOnSegment(frame.spine, a, b)
        if (projection.tRaw < 0 || projection.tRaw > 1) continue
        const segmentLength = distance(a, b)
        if (projection.tRaw * segmentLength <= toleranceIn) continue
        if ((1 - projection.tRaw) * segmentLength <= toleranceIn) continue

        const side = cross(sub(b, a), sub(frame.spine, a))
        const reach = Math.abs(side < 0 ? leftOffset : rightOffset) + toleranceIn
        if (projection.distance > reach) continue
        if (best === null || projection.distance < best.distance) {
          best = { wallId: geometry.wall.id, segmentIndex: i, distance: projection.distance }
        }
      }
    }
    if (!best) continue

    claimed.add(key)
    const end = refOf(frame)
    const host = { wall_id: best.wallId, segment_index: best.segmentIndex }
    into.push({ id: teeJointId(end, host), kind: 'tee', end, host })
  }
}

/**
 * Pairs unclaimed ends whose bodies abut with a shared surface: directions
 * parallel, one surface of each collinear with the other's, and the caps
 * touching along the shared direction. This is the unequal-thickness
 * continuation that must read as one wall.
 */
function collectFlush(
  frames: ReadonlyMap<string, EndFrame>,
  toleranceIn: number,
  into: Joint[],
  claimed: Set<string>,
): void {
  const open = [...frames.values()].filter((frame) => !claimed.has(endKey(frame.wallId, frame.end)))
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]
      const b = open[j]
      if (a.wallId === b.wallId) continue
      if (claimed.has(endKey(a.wallId, a.end)) || claimed.has(endKey(b.wallId, b.end))) continue
      if (Math.abs(cross(a.travel, b.travel)) > EPSILON) continue
      // The bodies must face each other (anti-parallel outward directions) and
      // abut: no separation along the shared direction, only the offset across it.
      if (dot(a.outward, b.outward) >= 0) continue
      if (Math.abs(dot(a.outward, sub(b.spine, a.spine))) > toleranceIn) continue

      const shared = sharedSides(a, b, toleranceIn)
      if (!shared) continue
      claimed.add(endKey(a.wallId, a.end))
      claimed.add(endKey(b.wallId, b.end))
      into.push({
        id: flushJointId(refOf(a), refOf(b)),
        kind: 'flush',
        a: { ref: refOf(a), side: shared.a },
        b: { ref: refOf(b), side: shared.b },
      })
    }
  }
}

/** The first pair of surfaces (one from each end) that are collinear within tolerance. */
function sharedSides(
  a: EndFrame,
  b: EndFrame,
  toleranceIn: number,
): { a: WallSide; b: WallSide } | null {
  for (const sideA of ['left', 'right'] as const) {
    for (const sideB of ['left', 'right'] as const) {
      const offset = sub(capOf(b, sideB), capOf(a, sideA))
      if (Math.abs(cross(a.travel, offset)) <= toleranceIn) return { a: sideA, b: sideB }
    }
  }
  return null
}

function refOf(frame: EndFrame): WallEndRef {
  return { wall_id: frame.wallId, end: frame.end }
}
