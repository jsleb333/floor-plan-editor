import type { Point } from '@/types/plan'

import { projectPointOnSegment } from '../lines'
import { boundsIntersect, boundsOfRings, pointInRings } from '../polygons'
import type { Bounds } from '../polygons'
import { distance, dot, lerp, normalize, sub } from '../vec'
import type { ResolvedWall } from './networkGeometry'

/** Two boundary edges within this distance of each other, in inches, are the same edge. */
const COINCIDENT_TOLERANCE_IN = 1e-6

/** Bounding boxes are grown by this much before pairing walls, so touching bodies still pair. */
const PAIR_MARGIN_IN = 1e-3

interface Segment {
  a: Point
  b: Point
}

interface WallBoundary {
  wallId: string
  component: number
  bounds: Bounds
  rings: readonly Point[][]
  segments: Segment[]
}

/**
 * Splits every wall's outline into the parts that are actually visible once
 * connected walls read as one body.
 *
 * A boundary edge is dropped when it COINCIDES with a joined wall's boundary
 * edge — that is the line between two merged bodies, and dropping it on both
 * sides is what makes a corner, a T or a flush continuation look like one wall
 * instead of two shapes sharing a seam. An edge lying strictly INSIDE another
 * wall's body is dropped too, whether or not the walls are joined, since a
 * hairline drawn inside a filled body is never anything but an artifact.
 *
 * Exact line arithmetic, no polygon booleans: the fill stays one path per wall
 * (the bodies do not overlap once resolved, and they share a colour), and only
 * the stroke is trimmed.
 *
 * @returns Stroke polylines per wall id, stitched so a mitre draws as one path.
 */
export function mergeBoundaries(
  walls: ReadonlyMap<string, ResolvedWall>,
  components: readonly (readonly string[])[],
): Map<string, Point[][]> {
  const boundaries = collectBoundaries(walls, components)
  const strokes = new Map<string, Point[][]>()

  for (const boundary of boundaries) {
    const pieces: Segment[] = []
    for (const segment of boundary.segments) {
      for (const piece of visibleParts(segment, boundary, boundaries)) pieces.push(piece)
    }
    strokes.set(boundary.wallId, stitch(pieces))
  }
  return strokes
}

function collectBoundaries(
  walls: ReadonlyMap<string, ResolvedWall>,
  components: readonly (readonly string[])[],
): WallBoundary[] {
  const componentOf = new Map<string, number>()
  components.forEach((group, index) => {
    for (const wallId of group) componentOf.set(wallId, index)
  })

  const boundaries: WallBoundary[] = []
  for (const wall of walls.values()) {
    const bounds = boundsOfRings(wall.rings)
    if (!bounds) continue
    boundaries.push({
      wallId: wall.wallId,
      component: componentOf.get(wall.wallId) ?? -1,
      bounds: grow(bounds, PAIR_MARGIN_IN),
      rings: wall.rings,
      segments: ringSegments(wall.rings),
    })
  }
  return boundaries
}

/** Every edge of every ring, including the wrap-around — for a chain that includes both end caps. */
function ringSegments(rings: readonly Point[][]): Segment[] {
  const segments: Segment[] = []
  for (const ring of rings) {
    if (ring.length < 2) continue
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (distance(a, b) > COINCIDENT_TOLERANCE_IN) segments.push({ a, b })
    }
  }
  return segments
}

/** The parts of `segment` that survive both the coincidence and containment tests. */
function visibleParts(
  segment: Segment,
  owner: WallBoundary,
  boundaries: readonly WallBoundary[],
): Segment[] {
  const length = distance(segment.a, segment.b)
  const covered: [number, number][] = []
  const others = boundaries.filter(
    (other) => other.wallId !== owner.wallId && boundsIntersect(owner.bounds, other.bounds),
  )

  for (const other of others) {
    if (other.component !== owner.component || owner.component < 0) continue
    for (const candidate of other.segments) {
      const overlap = collinearOverlap(segment, candidate, length)
      if (overlap) covered.push(overlap)
    }
  }

  return subtract(covered)
    .map(([from, to]) => ({
      a: lerp(segment.a, segment.b, from),
      b: lerp(segment.a, segment.b, to),
    }))
    .filter((piece) => {
      const middle = lerp(piece.a, piece.b, 0.5)
      return !others.some((other) => isStrictlyInside(middle, other))
    })
}

/**
 * Whether `point` is inside another wall's body and not merely touching its
 * boundary.
 *
 * The boundary check matters because two walls may abut without being joined —
 * their shared edge belongs to both outlines and must stay drawn, whereas
 * `pointInRings` is explicitly undefined for a point sitting on an edge.
 */
function isStrictlyInside(point: Point, other: WallBoundary): boolean {
  if (!pointInRings(point, other.rings)) return false
  return !other.segments.some(
    (segment) =>
      projectPointOnSegment(point, segment.a, segment.b).distance <= COINCIDENT_TOLERANCE_IN,
  )
}

/**
 * The sub-interval of `segment` (as parameters in [0, 1]) that `candidate`
 * covers while lying on the same line, or `null` when they are not collinear or
 * do not overlap.
 */
function collinearOverlap(
  segment: Segment,
  candidate: Segment,
  length: number,
): [number, number] | null {
  if (length <= COINCIDENT_TOLERANCE_IN) return null
  const direction = normalize(sub(segment.b, segment.a))
  if (perpendicularDistance(candidate.a, segment.a, direction) > COINCIDENT_TOLERANCE_IN)
    return null
  if (perpendicularDistance(candidate.b, segment.a, direction) > COINCIDENT_TOLERANCE_IN)
    return null

  const from = dot(sub(candidate.a, segment.a), direction) / length
  const to = dot(sub(candidate.b, segment.a), direction) / length
  const low = Math.max(0, Math.min(from, to))
  const high = Math.min(1, Math.max(from, to))
  if (high - low <= COINCIDENT_TOLERANCE_IN / length) return null
  return [low, high]
}

function perpendicularDistance(point: Point, origin: Point, direction: Point): number {
  const offset = sub(point, origin)
  const along = dot(offset, direction)
  return distance(offset, { x: direction.x * along, y: direction.y * along })
}

/** The complement of `covered` within [0, 1], merged and in order. */
function subtract(covered: readonly [number, number][]): [number, number][] {
  if (covered.length === 0) return [[0, 1]]
  const sorted = [...covered].sort((a, b) => a[0] - b[0])
  const gaps: [number, number][] = []
  let cursor = 0
  for (const [from, to] of sorted) {
    if (from > cursor) gaps.push([cursor, from])
    cursor = Math.max(cursor, to)
  }
  if (cursor < 1) gaps.push([cursor, 1])
  return gaps.filter(([from, to]) => to - from > 0)
}

/** Joins pieces that share an endpoint into runs, so a mitre strokes as one path. */
function stitch(pieces: readonly Segment[]): Point[][] {
  const remaining = [...pieces]
  const runs: Point[][] = []

  while (remaining.length > 0) {
    const seed = remaining.shift()
    if (!seed) break
    const run = [seed.a, seed.b]
    let extended = true
    while (extended) {
      extended = false
      for (let i = 0; i < remaining.length; i++) {
        const piece = remaining[i]
        const head = run[0]
        const tail = run[run.length - 1]
        if (distance(tail, piece.a) <= COINCIDENT_TOLERANCE_IN) run.push(piece.b)
        else if (distance(tail, piece.b) <= COINCIDENT_TOLERANCE_IN) run.push(piece.a)
        else if (distance(head, piece.b) <= COINCIDENT_TOLERANCE_IN) run.unshift(piece.a)
        else if (distance(head, piece.a) <= COINCIDENT_TOLERANCE_IN) run.unshift(piece.b)
        else continue
        remaining.splice(i, 1)
        extended = true
        break
      }
    }
    runs.push(run)
  }
  return runs
}

function grow(bounds: Bounds, margin: number): Bounds {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  }
}
