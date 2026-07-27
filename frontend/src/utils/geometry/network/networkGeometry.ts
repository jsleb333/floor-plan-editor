import type { Joint, Point, TeeJoint, Wall, WallSide } from '@/types/plan'

import { lineIntersection } from '../lines'
import { sub } from '../vec'
import { endFrame, wallGeometry } from './endFrame'
import type { EndFrame, WallGeometry } from './endFrame'
import { violations } from './constraintSolver'
import { emptyResolution, hostSpineSegment, resolveJoint } from './joinResolver'
import type { EndResolution, JointGap, Resolution } from './joinResolver'
import { mergeBoundaries } from './mergedBoundary'
import { buildWallGraph, endKey } from './wallGraph'
import type { WallGraph } from './wallGraph'

/** Coordinate quantum used to fold anchors that land on the same point. */
const ANCHOR_MERGE_IN = 1e-6

/** How an anchor relates to the network, most visible first (`docs/WALL_NETWORK.md` §8). */
export type NetworkAnchorKind = 'face-corner' | 'spine-end' | 'joint'

/** A point alignment guides may be projected through. */
export interface NetworkAnchor {
  point: Point
  kind: NetworkAnchorKind
  /** The wall that contributed it; the first contributor when walls share the point. */
  wallId: string | null
}

/** One segment of a resolved surface — a snap target for pointing at a wall's face. */
export interface FaceSegment {
  wallId: string
  side: WallSide
  a: Point
  b: Point
}

/** The resolved terminus of one wall end. */
export interface ResolvedEnd extends EndResolution {
  jointIds: readonly string[]
}

/** One wall's geometry after every joint it participates in has been applied. */
export interface ResolvedWall {
  wallId: string
  /** Surfaces walked in the wall's drawing direction. */
  left: Point[]
  right: Point[]
  /** Closed rings for fill: one for a chain, two for a ring. */
  rings: Point[][]
  /**
   * The parts of the outline to STROKE: the rings minus every edge shared with a
   * joined wall, so connected walls read as one body (`mergedBoundary.ts`).
   */
  strokes: Point[][]
  ends: { start: ResolvedEnd | null; end: ResolvedEnd | null }
}

/**
 * The single derived object every consumer reads: renderer, export, snapping,
 * guides, dimensions and hit-testing (`docs/WALL_NETWORK.md` §2, principle 4).
 */
export interface ResolvedNetwork {
  walls: ReadonlyMap<string, ResolvedWall>
  anchors: readonly NetworkAnchor[]
  faces: readonly FaceSegment[]
  /** Connected wall groups — paint one fill each so no seam shows inside a body. */
  components: readonly (readonly string[])[]
  /** Wedges to patch where a join bevelled across two walls. */
  gaps: readonly JointGap[]
  /**
   * Relations that do not hold for the stored geometry — the constraint solver's
   * work list. One definition of "not satisfied" (`violations`), so the network
   * and the solver can never disagree about what is true of the document.
   */
  unsatisfiedJointIds: readonly string[]
  /** Joints naming a wall the document does not contain. */
  danglingJointIds: readonly string[]
}

/**
 * Resolves a whole wall network: per-wall surfaces with every joint applied,
 * plus the anchors, face segments and connected components derived from them.
 *
 * Pure and total — a wall with no joints resolves to exactly what
 * `wallFacePolylines` gives it today, so this is safe to adopt one consumer at
 * a time. Walls with a non-positive thickness are skipped rather than throwing,
 * since a network is resolved on every document change.
 */
export function resolveWallNetwork(
  walls: readonly Wall[],
  joints: readonly Joint[],
): ResolvedNetwork {
  const graph = buildWallGraph(walls, joints)
  const geometries = collectGeometries(walls)
  const frames = collectFrames(geometries)
  const resolution = emptyResolution()
  const dangling = new Set(graph.danglingJointIds)
  for (const joint of joints) {
    if (!dangling.has(joint.id)) resolveJoint(joint, { geometries, frames }, resolution)
  }

  const resolved = new Map<string, ResolvedWall>()
  for (const geometry of geometries.values()) {
    const wall = assembleWall(geometry, resolution, graph)
    if (wall) resolved.set(wall.wallId, wall)
  }
  const strokes = mergeBoundaries(resolved, graph.components)
  for (const wall of resolved.values()) wall.strokes = strokes.get(wall.wallId) ?? []

  return {
    walls: resolved,
    anchors: collectAnchors(resolved, geometries, frames, joints),
    faces: collectFaces(resolved),
    components: graph.components,
    gaps: resolution.gaps,
    unsatisfiedJointIds: violations(walls, joints),
    danglingJointIds: graph.danglingJointIds,
  }
}

function collectGeometries(walls: readonly Wall[]): Map<string, WallGeometry> {
  const geometries = new Map<string, WallGeometry>()
  for (const wall of walls) {
    if (!(wall.thickness_in > 0)) continue
    geometries.set(wall.id, wallGeometry(wall))
  }
  return geometries
}

function collectFrames(geometries: ReadonlyMap<string, WallGeometry>): Map<string, EndFrame> {
  const frames = new Map<string, EndFrame>()
  for (const geometry of geometries.values()) {
    for (const end of ['start', 'end'] as const) {
      const frame = endFrame(geometry, end)
      if (frame) frames.set(endKey(geometry.wall.id, end), frame)
    }
  }
  return frames
}

/**
 * Applies the accumulated end resolutions to a wall's face polylines.
 *
 * Only the terminal point of each surface can move — interior mitres were
 * already solved by `offsetPolyline` — so the replacement is index 0 for the
 * start and the last index for the end.
 */
function assembleWall(
  geometry: WallGeometry,
  resolution: Resolution,
  graph: WallGraph,
): ResolvedWall | null {
  const { left, right, closed } = geometry.faces
  if (left.length === 0 || right.length === 0) return null

  const faces = { left: left.map(copy), right: right.map(copy) }
  const ends = { start: null as ResolvedEnd | null, end: null as ResolvedEnd | null }

  if (!closed) {
    for (const end of ['start', 'end'] as const) {
      const key = endKey(geometry.wall.id, end)
      const partial = resolution.ends.get(key)
      const index = end === 'start' ? 0 : -1
      const spineIndex = end === 'start' ? 0 : geometry.spine.points.length - 1
      if (partial?.left) put(faces.left, index, partial.left)
      if (partial?.right) put(faces.right, index, partial.right)
      ends[end] = {
        left: at(faces.left, index),
        right: at(faces.right, index),
        spine: partial?.spine ?? geometry.spine.points[spineIndex],
        jointIds: (graph.endJoints.get(key) ?? []).map((joint) => joint.id),
      }
    }
  }

  const rings = closed
    ? [faces.left.map(copy), faces.right.map(copy)]
    : [[...faces.left.map(copy), ...faces.right.map(copy).reverse()]]

  return {
    wallId: geometry.wall.id,
    left: faces.left,
    right: faces.right,
    rings,
    strokes: [],
    ends,
  }
}

/**
 * Every point a guide may be projected through: resolved surface corners first
 * (what the user can see), then spine vertices, then joint nodes. Coincident
 * points collapse onto the most visible kind, so a shared mitre is one anchor.
 *
 * The joint kind exists for T attachments only. Once a butting wall's endpoint
 * is stored honestly it sits on the host's SURFACE, so the T's centre — on the
 * host's spine — is no longer any wall's vertex and has to come from the graph.
 * That point is what today's guides offer as a junction anchor, so collecting it
 * here is what keeps S1e from regressing (`docs/WALL_NETWORK.md` §8).
 */
function collectAnchors(
  resolved: ReadonlyMap<string, ResolvedWall>,
  geometries: ReadonlyMap<string, WallGeometry>,
  frames: ReadonlyMap<string, EndFrame>,
  joints: readonly Joint[],
): NetworkAnchor[] {
  const byPoint = new Map<string, NetworkAnchor>()
  const add = (point: Point, kind: NetworkAnchorKind, wallId: string | null): void => {
    const key = `${quantize(point.x)}:${quantize(point.y)}`
    const existing = byPoint.get(key)
    if (existing === undefined || rank(kind) < rank(existing.kind)) {
      byPoint.set(key, { point: copy(point), kind, wallId })
    }
  }

  for (const wall of resolved.values()) {
    for (const point of wall.left) add(point, 'face-corner', wall.wallId)
    for (const point of wall.right) add(point, 'face-corner', wall.wallId)
  }
  for (const geometry of geometries.values()) {
    for (const point of geometry.spine.points) add(point, 'spine-end', geometry.wall.id)
  }
  for (const joint of joints) {
    if (joint.kind !== 'tee') continue
    const centre = teeCentre(joint, geometries, frames)
    if (centre) add(centre, 'joint', joint.host.wall_id)
  }
  return [...byPoint.values()]
}

/** Where a T meets its host's spine: the butting wall's spine line crossed with the host segment's. */
function teeCentre(
  joint: TeeJoint,
  geometries: ReadonlyMap<string, WallGeometry>,
  frames: ReadonlyMap<string, EndFrame>,
): Point | null {
  const frame = frames.get(endKey(joint.end.wall_id, joint.end.end))
  const host = geometries.get(joint.host.wall_id)
  if (!frame || !host) return null
  const segment = hostSpineSegment(host, joint.host.segment_index)
  if (!segment) return null
  return lineIntersection(frame.spine, frame.travel, segment.a, sub(segment.b, segment.a))
}

function collectFaces(resolved: ReadonlyMap<string, ResolvedWall>): FaceSegment[] {
  const segments: FaceSegment[] = []
  for (const wall of resolved.values()) {
    for (const side of ['left', 'right'] as const) {
      const points = wall[side]
      for (let i = 0; i < points.length - 1; i++) {
        segments.push({ wallId: wall.wallId, side, a: points[i], b: points[i + 1] })
      }
    }
  }
  return segments
}

function rank(kind: NetworkAnchorKind): number {
  return kind === 'face-corner' ? 0 : kind === 'spine-end' ? 1 : 2
}

function quantize(value: number): number {
  return Math.round(value / ANCHOR_MERGE_IN)
}

function copy(point: Point): Point {
  return { x: point.x, y: point.y }
}

function at(points: readonly Point[], index: number): Point {
  return index < 0 ? points[points.length + index] : points[index]
}

function put(points: Point[], index: number, point: Point): void {
  points[index < 0 ? points.length + index : index] = point
}
