import type { FlushParty, Joint, Point, Wall, WallEnd } from '@/types/plan'

import { EPSILON, add, cross, distance, dot, normalize, perpendicular, scale, sub } from '../vec'
import { wallFaceOffsets } from '../wallOutline'
import { spineToSurface } from './flushPlacement'
import { isEndRef, wallIdsOf } from './wallGraph'

/** How far a relation may drift before the solver treats it as violated, in inches. */
const SATISFIED_TOLERANCE_IN = 1e-6

/** The outcome of one solve: which walls moved, and what could not be made true. */
export interface ConstraintSolution {
  /** Replacement walls, keyed by id. A wall absent from the map is unchanged. */
  moved: ReadonlyMap<string, Wall>
  /**
   * Relations still violated afterwards — an over-constrained loop, or one
   * blocked by a locked segment. Reported rather than forced, so the editor can
   * say so instead of silently moving something the user locked.
   */
  unsatisfiedJointIds: readonly string[]
}

/**
 * Restores the document's wall relations after an edit (`docs/WALL_NETWORK.md` §5).
 *
 * Pure: walls in, replacement walls out. This is the half of the design that
 * edits the DOCUMENT — the geometry resolver only ever computes surfaces — so
 * the stored spine always stays the truth about where a wall is, and no
 * consumer needs a correction pass to learn it.
 *
 * Propagation is breadth-first from the walls the user just changed, each
 * relation satisfied at most once so a cycle cannot spin. What survives is then
 * re-checked and reported, which catches the over-constrained cases without
 * needing a pass counter.
 *
 * @param seedWallIds The walls the user changed; they are held fixed and their
 *   neighbours move to suit.
 */
export function solveConstraints(
  walls: readonly Wall[],
  joints: readonly Joint[],
  seedWallIds: readonly string[],
): ConstraintSolution {
  const working = new Map(walls.map((wall) => [wall.id, wall]))
  const moved = new Map<string, Wall>()
  const settled = new Set<string>()
  const byWall = jointsByWall(joints, working)

  const queue = seedWallIds.filter((id) => working.has(id))
  const seen = new Set(queue)
  while (queue.length > 0) {
    const fixedId = queue.shift()
    if (fixedId === undefined) break
    for (const joint of byWall.get(fixedId) ?? []) {
      if (settled.has(joint.id)) continue
      const freeId = wallIdsOf(joint).find((id) => id !== fixedId)
      if (freeId === undefined) continue
      settled.add(joint.id)

      const free = working.get(freeId)
      const fixed = working.get(fixedId)
      if (!free || !fixed || free.locked_segments.length > 0) continue
      const corrected = satisfy(joint, fixed, free)
      if (!corrected) continue

      working.set(freeId, corrected)
      moved.set(freeId, corrected)
      if (!seen.has(freeId)) {
        seen.add(freeId)
        queue.push(freeId)
      }
    }
  }

  return {
    moved,
    unsatisfiedJointIds: violations([...working.values()], joints),
  }
}

/**
 * Relations that do not hold for the given walls.
 *
 * Used to report what a solve could not fix, and available on its own as a
 * document check — a relation is either true of the stored geometry or it is
 * not, with nothing in between.
 */
export function violations(walls: readonly Wall[], joints: readonly Joint[]): string[] {
  const byId = new Map(walls.map((wall) => [wall.id, wall]))
  const broken: string[] = []
  for (const joint of joints) {
    if (wallIdsOf(joint).some((id) => !byId.has(id))) continue
    if (!holds(joint, byId)) broken.push(joint.id)
  }
  return broken
}

/** Joints touching each wall, whether by an end or by its body. */
function jointsByWall(
  joints: readonly Joint[],
  walls: ReadonlyMap<string, Wall>,
): Map<string, Joint[]> {
  const byWall = new Map<string, Joint[]>()
  for (const joint of joints) {
    const ids = wallIdsOf(joint)
    if (ids.some((id) => !walls.has(id))) continue
    for (const id of new Set(ids)) {
      const existing = byWall.get(id)
      if (existing) existing.push(joint)
      else byWall.set(id, [joint])
    }
  }
  return byWall
}

/** The corrected `free` wall that makes `joint` true again, or `null` when it already is. */
function satisfy(joint: Joint, fixed: Wall, free: Wall): Wall | null {
  switch (joint.kind) {
    case 'corner':
      return satisfyCorner(joint, fixed, free)
    case 'tee':
      return satisfyTee(joint, fixed, free)
    case 'flush':
      return satisfyFlush(joint, fixed, free)
  }
}

/** Pulls the free end onto the fixed end: a corner means the spines meet. */
function satisfyCorner(
  joint: Extract<Joint, { kind: 'corner' }>,
  fixed: Wall,
  free: Wall,
): Wall | null {
  const fixedEnd = joint.ends.find((ref) => ref.wall_id === fixed.id)
  const freeEnd = joint.ends.find((ref) => ref.wall_id === free.id)
  if (!fixedEnd || !freeEnd) return null
  const target = vertexAt(fixed, fixedEnd.end)
  if (distance(vertexAt(free, freeEnd.end), target) <= SATISFIED_TOLERANCE_IN) return null
  return withVertex(free, freeEnd.end, target)
}

/**
 * Drops the butting end back onto the host's near surface.
 *
 * The projection is perpendicular to the host, so an endpoint dragged ALONG the
 * host keeps its new position there — the relation follows the edit instead of
 * snapping back to where it was.
 */
function satisfyTee(joint: Extract<Joint, { kind: 'tee' }>, fixed: Wall, free: Wall): Wall | null {
  if (joint.end.wall_id !== free.id || joint.host.wall_id !== fixed.id) return null
  const segment = spineSegment(fixed, joint.host.segment_index)
  if (!segment) return null
  const endpoint = vertexAt(free, joint.end.end)
  const inner = neighbourOf(free, joint.end.end)
  if (!inner) return null

  const direction = normalize(sub(segment.b, segment.a))
  const side = cross(sub(segment.b, segment.a), sub(inner, segment.a)) < 0 ? 'left' : 'right'
  const [left, right] = wallFaceOffsets(fixed.reference, fixed.thickness_in)
  const surface = add(segment.a, scale(perpendicular(direction), side === 'left' ? left : right))
  const target = add(surface, scale(direction, dot(sub(endpoint, surface), direction)))
  if (distance(endpoint, target) <= SATISFIED_TOLERANCE_IN) return null
  return withVertex(free, joint.end.end, target)
}

/**
 * Slides the free wall sideways until its declared surface is back on the
 * fixed wall's.
 *
 * The whole wall translates, not just the joined end: the two surfaces are
 * collinear, so moving one end alone would rotate the wall out of the very
 * relation being restored.
 */
function satisfyFlush(
  joint: Extract<Joint, { kind: 'flush' }>,
  fixed: Wall,
  free: Wall,
): Wall | null {
  const fixedParty = partyFor(joint, fixed.id)
  const freeParty = partyFor(joint, free.id)
  if (!fixedParty || !freeParty || !isEndRef(freeParty.ref)) return null
  const fixedLine = surfaceLine(fixed, fixedParty)
  if (!fixedLine) return null

  const freeEnd = freeParty.ref.end
  const endpoint = vertexAt(free, freeEnd)
  const inner = neighbourOf(free, freeEnd)
  if (!inner) return null
  // Travel direction, not outward: left and right are named relative to travel.
  const direction = normalize(freeEnd === 'start' ? sub(inner, endpoint) : sub(endpoint, inner))
  const offset = spineToSurface(free.thickness_in, free.reference, freeParty.side)
  const normal = perpendicular(direction)
  // Which way `offset` moves the spine: toward the side the shared surface is on.
  const signed = freeParty.side === 'left' ? offset : -offset
  const currentSurface = add(endpoint, scale(normal, signed))
  const gap = cross(fixedLine.direction, sub(currentSurface, fixedLine.point))
  if (Math.abs(gap) <= SATISFIED_TOLERANCE_IN) return null

  const shift = scale(perpendicular(fixedLine.direction), gap)
  return {
    ...free,
    vertices: free.vertices.map((vertex) => add(vertex, shift)),
  }
}

/** Whether a relation currently holds for the stored geometry. */
function holds(joint: Joint, byId: ReadonlyMap<string, Wall>): boolean {
  if (joint.kind === 'corner') {
    const points = joint.ends
      .map((ref) => byId.get(ref.wall_id))
      .map((wall, index) => (wall ? vertexAt(wall, joint.ends[index].end) : null))
    const first = points[0]
    if (!first) return true
    return points.every((point) => point && distance(point, first) <= SATISFIED_TOLERANCE_IN)
  }

  if (joint.kind === 'tee') {
    const free = byId.get(joint.end.wall_id)
    const host = byId.get(joint.host.wall_id)
    if (!free || !host) return true
    const segment = spineSegment(host, joint.host.segment_index)
    const inner = neighbourOf(free, joint.end.end)
    if (!segment || !inner) return true
    const endpoint = vertexAt(free, joint.end.end)
    const side = cross(sub(segment.b, segment.a), sub(inner, segment.a)) < 0 ? 'left' : 'right'
    const [left, right] = wallFaceOffsets(host.reference, host.thickness_in)
    const direction = normalize(sub(segment.b, segment.a))
    const surface = add(segment.a, scale(perpendicular(direction), side === 'left' ? left : right))
    return Math.abs(cross(direction, sub(endpoint, surface))) <= SATISFIED_TOLERANCE_IN
  }

  const a = partySurface(joint.a, byId)
  const b = partySurface(joint.b, byId)
  if (!a || !b) return true
  if (Math.abs(cross(a.direction, b.direction)) > SATISFIED_TOLERANCE_IN) return false
  return Math.abs(cross(a.direction, sub(b.point, a.point))) <= SATISFIED_TOLERANCE_IN
}

/** A line along one party's declared surface. */
interface SurfaceLine {
  point: Point
  direction: Point
}

function partySurface(party: FlushParty, byId: ReadonlyMap<string, Wall>): SurfaceLine | null {
  const wall = byId.get(party.ref.wall_id)
  return wall ? surfaceLine(wall, party) : null
}

/**
 * The line of `wall`'s surface on the party's side, taken at the party's end (or
 * its named segment for a body party).
 */
function surfaceLine(wall: Wall, party: FlushParty): SurfaceLine | null {
  const ref = party.ref
  const segment = isEndRef(ref) ? endSegment(wall, ref.end) : spineSegment(wall, ref.segment_index)
  if (!segment) return null
  const direction = normalize(sub(segment.b, segment.a))
  if (Math.abs(direction.x) <= EPSILON && Math.abs(direction.y) <= EPSILON) return null
  const [left, right] = wallFaceOffsets(wall.reference, wall.thickness_in)
  const offset = party.side === 'left' ? left : right
  return { point: add(segment.a, scale(perpendicular(direction), offset)), direction }
}

/** The party of a flush joint belonging to `wallId`. */
function partyFor(joint: Extract<Joint, { kind: 'flush' }>, wallId: string): FlushParty | null {
  if (joint.a.ref.wall_id === wallId) return joint.a
  if (joint.b.ref.wall_id === wallId) return joint.b
  return null
}

function vertexAt(wall: Wall, end: WallEnd): Point {
  return end === 'start' ? wall.vertices[0] : wall.vertices[wall.vertices.length - 1]
}

/** The spine vertex next to one end — the direction the body lies in. */
function neighbourOf(wall: Wall, end: WallEnd): Point | null {
  if (wall.vertices.length < 2) return null
  return end === 'start' ? wall.vertices[1] : wall.vertices[wall.vertices.length - 2]
}

function withVertex(wall: Wall, end: WallEnd, point: Point): Wall {
  const vertices = wall.vertices.map((vertex) => ({ ...vertex }))
  vertices[end === 'start' ? 0 : vertices.length - 1] = { ...point }
  return { ...wall, vertices }
}

/**
 * The end segment of a chain, oriented along the wall's DRAWING direction.
 *
 * Orientation is not cosmetic: `wallFaceOffsets` names left and right relative
 * to travel, so reversing the segment would swap which surface is which.
 */
function endSegment(wall: Wall, end: WallEnd): { a: Point; b: Point } | null {
  if (wall.vertices.length < 2) return null
  return end === 'start'
    ? { a: wall.vertices[0], b: wall.vertices[1] }
    : { a: wall.vertices[wall.vertices.length - 2], b: wall.vertices[wall.vertices.length - 1] }
}

function spineSegment(wall: Wall, index: number): { a: Point; b: Point } | null {
  const points = wall.vertices
  const count = wall.closed ? points.length : points.length - 1
  if (index < 0 || index >= count) return null
  return { a: points[index], b: points[(index + 1) % points.length] }
}
