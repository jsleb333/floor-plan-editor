import type { CornerJoint, FlushJoint, Joint, Point, TeeJoint, WallSide } from '@/types/plan'

import { lineIntersection } from '../lines'
import {
  EPSILON,
  add,
  angleOf,
  cross,
  distance,
  dot,
  normalize,
  perpendicular,
  scale,
  sub,
} from '../vec'
import { wallFaceOffsets } from '../wallOutline'
import { capOf } from './endFrame'
import type { EndFrame, WallGeometry } from './endFrame'
import { endKey, isEndRef } from './wallGraph'

/**
 * Mitre points farther than this many face offsets from the joint fall back to
 * a bevel — the same limit `offsetPolyline` applies inside a single chain, so a
 * corner spread across two walls degrades identically to one drawn as a chain.
 */
const MITRE_LIMIT_FACTOR = 4

/** How far two declared-flush surfaces may sit apart and still count as one surface. */
const FLUSH_TOLERANCE_IN = 1e-6

/** The resolved terminus of one wall end: what replaces its square butt cap. */
export interface EndResolution {
  left: Point
  right: Point
  /** Spine terminus. Equal to the stored one in a constraint-satisfied document. */
  spine: Point
}

/**
 * A wedge no mitre could close (acute bevel, parallel faces). Filling this
 * triangle keeps a body seamless where two separate walls bevel — inside one
 * chain `offsetPolyline` already emits both corners, so no patch is needed.
 */
export interface JointGap {
  jointId: string
  /** The two face corners and the joint node between them. */
  points: [Point, Point, Point]
}

/** What the resolvers accumulate across all joints before the faces are assembled. */
export interface Resolution {
  /** Keyed by `endKey`; an end collects one face per adjacent pair. */
  ends: Map<string, Partial<EndResolution>>
  gaps: JointGap[]
  /** Flush joints whose surfaces are not actually collinear — the constraint solver's work list. */
  unsatisfiedJointIds: string[]
}

/** Everything the resolvers may read: derived geometry and end frames by wall/end. */
export interface ResolverContext {
  geometries: ReadonlyMap<string, WallGeometry>
  frames: ReadonlyMap<string, EndFrame>
}

export function emptyResolution(): Resolution {
  return { ends: new Map(), gaps: [], unsatisfiedJointIds: [] }
}

/** Applies one joint to the accumulator. Unresolvable joints leave the caps untouched. */
export function resolveJoint(joint: Joint, context: ResolverContext, into: Resolution): void {
  switch (joint.kind) {
    case 'corner':
      resolveCorner(joint, context, into)
      return
    case 'tee':
      resolveTee(joint, context, into)
      return
    case 'flush':
      resolveFlush(joint, context, into)
      return
  }
}

/**
 * Mitres the faces of wall ends meeting at one point.
 *
 * The ends are sorted by outward direction and each cyclically adjacent pair is
 * treated as a chain passing through the node — one end arriving, the next
 * departing. The two surfaces continuous across that chain are the pair to
 * intersect: for an arriving end that is its left face when the joint is at its
 * 'end' (walked forward) and its right face otherwise; mirrored for the
 * departing end. Every end therefore appears once as arriving and once as
 * departing, so both its faces get exactly one mitre — and a two-wall L
 * reproduces `offsetPolyline`'s mitre for the same corner drawn as one chain.
 */
function resolveCorner(joint: CornerJoint, context: ResolverContext, into: Resolution): void {
  const frames = joint.ends
    .map((ref) => context.frames.get(endKey(ref.wall_id, ref.end)))
    .filter((frame): frame is EndFrame => frame !== undefined)
  if (frames.length < 2) return

  const node = centroid(frames.map((frame) => frame.spine))
  for (const frame of frames) setSpine(into, frame, node)
  if (joint.rule === 'square') return

  const sorted = [...frames].sort((a, b) => angleOf(a.outward) - angleOf(b.outward))
  for (let i = 0; i < sorted.length; i++) {
    const arriving = sorted[i]
    const departing = sorted[(i + 1) % sorted.length]
    const arrivingSide: WallSide = arriving.end === 'end' ? 'left' : 'right'
    const departingSide: WallSide = departing.end === 'start' ? 'left' : 'right'
    const arrivingCap = capOf(arriving, arrivingSide)
    const departingCap = capOf(departing, departingSide)

    const mitre = lineIntersection(arrivingCap, arriving.travel, departingCap, departing.travel)
    const limit =
      MITRE_LIMIT_FACTOR *
      Math.max(distance(arrivingCap, arriving.spine), distance(departingCap, departing.spine))
    if (mitre && distance(mitre, node) <= limit + EPSILON) {
      setFace(into, arriving, arrivingSide, mitre)
      setFace(into, departing, departingSide, mitre)
    } else {
      into.gaps.push({ jointId: joint.id, points: [arrivingCap, node, departingCap] })
    }
  }
}

/**
 * Clips a wall end to the near face LINE of its host — a straight cut parallel
 * to the host's surface, so the butt is exact at any approach angle. The host
 * itself is untouched.
 */
function resolveTee(joint: TeeJoint, context: ResolverContext, into: Resolution): void {
  const frame = context.frames.get(endKey(joint.end.wall_id, joint.end.end))
  const host = context.geometries.get(joint.host.wall_id)
  if (!frame || !host) return

  const segment = hostSpineSegment(host, joint.host.segment_index)
  if (!segment) return
  const hostDir = normalize(sub(segment.b, segment.a))
  if (hostDir.x === 0 && hostDir.y === 0) return

  // Which surface the butting wall approaches from — its body lies on the side
  // its inner vertex is on. `cross < 0` is the host's left (see `vec.ts`).
  const side = cross(sub(segment.b, segment.a), sub(frame.inner, segment.a))
  if (Math.abs(side) <= EPSILON) return
  const [leftOffset, rightOffset] = wallFaceOffsets(host.wall.reference, host.wall.thickness_in)
  const facePoint = add(
    segment.a,
    scale(perpendicular(hostDir), side < 0 ? leftOffset : rightOffset),
  )

  clipToLine(frame, facePoint, hostDir, into)
}

/**
 * Resolves a declared shared surface.
 *
 * Geometry only has to be adjusted where two wall ENDS abut: their spines are
 * parallel and offset, so each is cut at the plane between them. A body party
 * means the end is also tee'd, and that clip already made the cut. Either way
 * the collinearity of the declared surfaces is checked and reported, which is
 * the signal the constraint solver acts on.
 */
function resolveFlush(joint: FlushJoint, context: ResolverContext, into: Resolution): void {
  const frameA = isEndRef(joint.a.ref)
    ? context.frames.get(endKey(joint.a.ref.wall_id, joint.a.ref.end))
    : undefined
  const frameB = isEndRef(joint.b.ref)
    ? context.frames.get(endKey(joint.b.ref.wall_id, joint.b.ref.end))
    : undefined
  if (!frameA || !frameB) {
    if (!isFlushWithBody(joint, context)) into.unsatisfiedJointIds.push(joint.id)
    return
  }

  const capA = capOf(frameA, joint.a.side)
  const capB = capOf(frameB, joint.b.side)
  const parallel = Math.abs(cross(frameA.travel, frameB.travel)) <= EPSILON
  const collinear =
    parallel && Math.abs(cross(frameA.travel, sub(capB, capA))) <= FLUSH_TOLERANCE_IN
  if (!collinear) {
    into.unsatisfiedJointIds.push(joint.id)
    return
  }

  // Cut both ends on the plane midway between their spine termini, measured
  // along the shared direction: where the two bodies abut.
  const axis = frameA.travel
  const cutAt = (dot(frameA.spine, axis) + dot(frameB.spine, axis)) / 2
  const planePoint = scale(axis, cutAt)
  const planeDir = perpendicular(axis)
  clipToLine(frameA, planePoint, planeDir, into)
  clipToLine(frameB, planePoint, planeDir, into)
}

/** A flush relation against a wall body holds when the end's surface lies on the host's. */
function isFlushWithBody(joint: FlushJoint, context: ResolverContext): boolean {
  const endParty = isEndRef(joint.a.ref) ? joint.a : joint.b
  const bodyParty = isEndRef(joint.a.ref) ? joint.b : joint.a
  const endRef = endParty.ref
  const bodyRef = bodyParty.ref
  if (!isEndRef(endRef) || isEndRef(bodyRef)) return false

  const frame = context.frames.get(endKey(endRef.wall_id, endRef.end))
  const host = context.geometries.get(bodyRef.wall_id)
  if (!frame || !host) return false
  const segment = hostSpineSegment(host, bodyRef.segment_index)
  if (!segment) return false

  const hostDir = normalize(sub(segment.b, segment.a))
  const [leftOffset, rightOffset] = wallFaceOffsets(host.wall.reference, host.wall.thickness_in)
  const offset = bodyParty.side === 'left' ? leftOffset : rightOffset
  const hostFacePoint = add(segment.a, scale(perpendicular(hostDir), offset))
  const cap = capOf(frame, endParty.side)
  return (
    Math.abs(cross(hostDir, frame.travel)) <= EPSILON &&
    Math.abs(cross(hostDir, sub(cap, hostFacePoint))) <= FLUSH_TOLERANCE_IN
  )
}

/** Cuts an end's two faces and its spine on the line through `point` along `dir`. */
function clipToLine(frame: EndFrame, point: Point, dir: Point, into: Resolution): void {
  const left = lineIntersection(frame.leftCap, frame.travel, point, dir)
  const right = lineIntersection(frame.rightCap, frame.travel, point, dir)
  const spine = lineIntersection(frame.spine, frame.travel, point, dir)
  if (!left || !right || !spine) return
  setFace(into, frame, 'left', left)
  setFace(into, frame, 'right', right)
  setSpine(into, frame, spine)
}

/** The host's spine segment `segment_index`, or `null` when the index is out of range. */
export function hostSpineSegment(host: WallGeometry, index: number): { a: Point; b: Point } | null {
  const { points, closed } = host.spine
  const count = closed ? points.length : points.length - 1
  if (index < 0 || index >= count) return null
  return { a: points[index], b: points[(index + 1) % points.length] }
}

function entryFor(into: Resolution, frame: EndFrame): Partial<EndResolution> {
  const key = endKey(frame.wallId, frame.end)
  const existing = into.ends.get(key)
  if (existing) return existing
  const created: Partial<EndResolution> = {}
  into.ends.set(key, created)
  return created
}

function setFace(into: Resolution, frame: EndFrame, side: WallSide, point: Point): void {
  entryFor(into, frame)[side] = point
}

function setSpine(into: Resolution, frame: EndFrame, point: Point): void {
  entryFor(into, frame).spine = point
}

/** Mean of the given points — the joint node, which coincide in a solved document. */
function centroid(points: readonly Point[]): Point {
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: x / points.length, y: y / points.length }
}
