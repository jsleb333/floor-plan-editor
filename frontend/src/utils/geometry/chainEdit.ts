import type { Point } from '@/types/plan'

import { EPSILON, add, cross, distance, normalize, scale, sub } from './vec'

/** Unit-vector cross products below this magnitude count as parallel. */
const PARALLEL_TOLERANCE = 1e-6

/** The wall chain a segment-length edit operates on (spec S3b). */
export interface ChainEditInput {
  /** Reference-line vertices; for a closed loop the last segment wraps to the first vertex. */
  vertices: readonly Point[]
  closed: boolean
  /** Indices of locked segments (segment i joins vertices i and i+1, wrapping when closed). */
  lockedSegments: readonly number[]
}

/**
 * Outcome of a segment-length edit:
 * - 'ok': the new vertex array (same length and order as the input).
 * - 'blocked': locked segments prevent the edit on every route (open chains,
 *   or the edited segment itself being locked); `blockingSegments` lists them.
 * - 'misclosure': closed loop where no route can absorb the shift (spec S3c);
 *   `misclosureIn` is the residual |typed - drawn| and `blockingSegments`
 *   lists any locks that closed the routes (empty on pure wrap-around).
 */
export type ChainEditResult =
  | { status: 'ok'; vertices: Point[] }
  | { status: 'blocked'; blockingSegments: number[] }
  | { status: 'misclosure'; misclosureIn: number; blockingSegments: number[] }

interface RouteSuccess {
  ok: true
  movedVertices: number[]
  route: 'forward' | 'backward'
}

type PropagationOutcome = RouteSuccess | { ok: false; blockingSegment: number | null }

/** Number of segments in a chain: n for closed loops, n-1 for open chains. */
export function segmentCountOf(vertexCount: number, closed: boolean): number {
  if (vertexCount < 2) return 0
  return closed ? vertexCount : vertexCount - 1
}

/**
 * Sets segment `segmentIndex` of the chain to exactly `targetLengthIn` inches,
 * measured on the reference line (spec S3b).
 *
 * The edit moves one endpoint of the segment along the segment's direction;
 * the shift then propagates vertex by vertex: each traversed segment
 * translates parallel to itself (direction and length preserved) until a
 * FREE segment parallel to the shift absorbs it by changing length, or an
 * open chain end is reached. Locked segments never move or change length, so
 * they block a route. Both endpoints are tried; when both succeed the route
 * disturbing fewer vertices wins (far side stays stationary), with the
 * end-vertex route breaking ties. When every route fails: open chains reject
 * with the blocking locks, closed loops report the misclosure (spec S3c).
 */
export function setSegmentLength(
  input: ChainEditInput,
  segmentIndex: number,
  targetLengthIn: number,
): ChainEditResult {
  const n = input.vertices.length
  const segmentCount = segmentCountOf(n, input.closed)
  if (segmentIndex < 0 || segmentIndex >= segmentCount || !(targetLengthIn > 0)) {
    return { status: 'blocked', blockingSegments: [] }
  }
  const locked = new Set(input.lockedSegments)
  if (locked.has(segmentIndex)) {
    return { status: 'blocked', blockingSegments: [segmentIndex] }
  }

  const a = input.vertices[segmentIndex]
  const b = input.vertices[(segmentIndex + 1) % n]
  const dir = normalize(sub(b, a))
  const delta = targetLengthIn - distance(a, b)
  if (Math.abs(delta) <= EPSILON) {
    return { status: 'ok', vertices: input.vertices.map((v) => ({ ...v })) }
  }

  const forward = propagate(input, locked, segmentIndex, dir, 'forward')
  const backward = propagate(input, locked, segmentIndex, dir, 'backward')
  const chosen = pickRoute(forward, backward)
  if (chosen !== null) {
    const shift = scale(dir, chosen.route === 'forward' ? delta : -delta)
    const moved = new Set(chosen.movedVertices)
    return {
      status: 'ok',
      vertices: input.vertices.map((v, i) => (moved.has(i) ? add(v, shift) : { ...v })),
    }
  }

  const blockers = [...new Set([forward, backward].flatMap(blockersOf))].sort((x, y) => x - y)
  if (input.closed) {
    return { status: 'misclosure', misclosureIn: Math.abs(delta), blockingSegments: blockers }
  }
  return { status: 'blocked', blockingSegments: blockers }
}

function blockersOf(outcome: PropagationOutcome): number[] {
  return !outcome.ok && outcome.blockingSegment !== null ? [outcome.blockingSegment] : []
}

function pickRoute(forward: PropagationOutcome, backward: PropagationOutcome): RouteSuccess | null {
  if (forward.ok && backward.ok) {
    return backward.movedVertices.length < forward.movedVertices.length ? backward : forward
  }
  if (forward.ok) return forward
  if (backward.ok) return backward
  return null
}

/**
 * Walks the shift away from the edited segment. 'forward' moves the segment's
 * end vertex and walks toward higher segment indices; 'backward' moves the
 * start vertex and walks toward lower indices. Returns the vertices to move
 * or the lock that blocked the route (`blockingSegment: null` marks a closed
 * loop wrapping all the way around without absorption).
 */
function propagate(
  input: ChainEditInput,
  locked: ReadonlySet<number>,
  editedSegment: number,
  editDirection: Point,
  route: 'forward' | 'backward',
): PropagationOutcome {
  const n = input.vertices.length
  const segmentCount = segmentCountOf(n, input.closed)
  const forward = route === 'forward'
  const moved: number[] = [forward ? (editedSegment + 1) % n : editedSegment]
  let k = forward ? editedSegment + 1 : editedSegment - 1

  for (;;) {
    if (!input.closed && (k < 0 || k >= segmentCount)) {
      return { ok: true, movedVertices: moved, route }
    }
    if (input.closed) k = ((k % segmentCount) + segmentCount) % segmentCount
    if (input.closed && k === editedSegment) {
      return { ok: false, blockingSegment: null }
    }
    if (locked.has(k)) {
      return { ok: false, blockingSegment: k }
    }
    const u = normalize(sub(input.vertices[(k + 1) % n], input.vertices[k]))
    if (Math.abs(cross(u, editDirection)) <= PARALLEL_TOLERANCE) {
      return { ok: true, movedVertices: moved, route }
    }
    moved.push(forward ? (k + 1) % n : k)
    k = forward ? k + 1 : k - 1
  }
}
