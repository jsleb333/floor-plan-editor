import type { Guide, Point, PointGuide, SurfaceGuide, Wall, WallEnd } from '@/types/plan'

import { lineIntersection } from '../lines'
import { wallSegmentSpan } from '../openings'
import { EPSILON, add, dirFromAngle, normalize, perpendicular, scale, sub } from '../vec'
import { wallFaceOffsets } from '../wallOutline'
import type { ResolvedNetwork } from './networkGeometry'

/** Guides store their angle in degrees, the geometry module works in radians. */
const DEG_TO_RAD = Math.PI / 180

/** A guide resolved to world space: the INFINITE line through `point` along `dir`. */
export interface GuideLine {
  guideId: string
  /** One point on the line — for an anchored guide, the anchor it was derived from. */
  point: Point
  /** Unit direction. The line runs both ways, so `dir` and its negation mean the same line. */
  dir: Point
}

/** Where two guide lines cross — a point snap target (spec S9). */
export interface GuideCrossing {
  point: Point
  /** Id of the earlier guide of the pair, in the order the lines were given. */
  a: string
  /** Id of the later guide of the pair. */
  b: string
}

/**
 * Resolves one guide to its world line (spec S9), or `null` when the wall it is
 * anchored to (or that wall's named segment) is gone.
 *
 * The one place a guide becomes coordinates. Anchored guides are stored as
 * RELATIONS, so a surface guide is re-derived from the host wall's current
 * spine, reference side and thickness — which is what makes it keep its offset
 * when the wall moves or thickens instead of being left behind
 * (`docs/WALL_NETWORK.md`).
 *
 * @param guide The stored guide.
 * @param walls The document's walls, either as the array or already keyed by id.
 * @param network Optional resolved network. A point guide then follows the
 *   RESOLVED spine terminus — the corner as the network draws it — falling back
 *   to the wall's stored vertex, which is what a bare `walls` call uses.
 */
export function resolveGuideLine(
  guide: Guide,
  walls: ReadonlyMap<string, Wall> | readonly Wall[],
  network?: ResolvedNetwork,
): GuideLine | null {
  switch (guide.kind) {
    case 'free':
      return {
        guideId: guide.id,
        point: { ...guide.origin },
        dir: dirFromAngle(guide.angle_deg * DEG_TO_RAD),
      }
    case 'point':
      return pointGuideLine(guide, wallsById(walls), network)
    case 'surface':
      return surfaceGuideLine(guide, wallsById(walls))
  }
}

/**
 * Every guide that still resolves, in document order. Guides whose anchor is
 * gone are dropped rather than reported: a deleted wall takes its guides'
 * geometry with it, and the document is the place that decides their fate.
 */
export function resolveGuideLines(
  guides: readonly Guide[],
  walls: ReadonlyMap<string, Wall> | readonly Wall[],
  network?: ResolvedNetwork,
): GuideLine[] {
  const byId = wallsById(walls)
  const lines: GuideLine[] = []
  for (const guide of guides) {
    const line = resolveGuideLine(guide, byId, network)
    if (line) lines.push(line)
  }
  return lines
}

/**
 * Every pairwise crossing of the given guide lines (spec S9) — the point
 * targets a guide contributes to the snap engine. Parallel and collinear pairs
 * cross nowhere and are skipped.
 */
export function guideCrossings(lines: readonly GuideLine[]): GuideCrossing[] {
  const crossings: GuideCrossing[] = []
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const point = lineIntersection(lines[i].point, lines[i].dir, lines[j].point, lines[j].dir)
      if (point) crossings.push({ point, a: lines[i].guideId, b: lines[j].guideId })
    }
  }
  return crossings
}

/** The line through an anchored wall end, at the guide's stored angle. */
function pointGuideLine(
  guide: PointGuide,
  walls: ReadonlyMap<string, Wall>,
  network: ResolvedNetwork | undefined,
): GuideLine | null {
  const wall = walls.get(guide.anchor.wall_id)
  if (!wall) return null
  const resolved = network?.walls.get(wall.id)?.ends[guide.anchor.end]?.spine
  const point = resolved ?? endVertex(wall, guide.anchor.end)
  if (!point) return null
  return { guideId: guide.id, point: { ...point }, dir: dirFromAngle(guide.angle_deg * DEG_TO_RAD) }
}

/**
 * The line of a wall's surface on the guide's side, displaced a FURTHER
 * `offset_in` perpendicular to it, away from the wall body.
 *
 * The direction is the spine segment's, since the surface is parallel to it;
 * that also fixes what 'left' and 'right' mean here, both being named relative
 * to the wall's drawing direction (`wallFaceOffsets`).
 */
function surfaceGuideLine(guide: SurfaceGuide, walls: ReadonlyMap<string, Wall>): GuideLine | null {
  const wall = walls.get(guide.wall_id)
  if (!wall) return null
  const span = wallSegmentSpan(wall, guide.segment_index)
  if (!span) return null
  const dir = normalize(sub(span.b, span.a))
  if (Math.abs(dir.x) <= EPSILON && Math.abs(dir.y) <= EPSILON) return null

  const [left, right] = wallFaceOffsets(wall.reference, wall.thickness_in)
  const surface = guide.side === 'left' ? left : right
  // Outward is away from the body, which is the direction the surface itself lies in.
  const outward = guide.side === 'left' ? guide.offset_in : -guide.offset_in
  return {
    guideId: guide.id,
    point: add(span.a, scale(perpendicular(dir), surface + outward)),
    dir,
  }
}

/** A wall's stored vertex at one end, or `null` for a wall with no vertices. */
function endVertex(wall: Wall, end: WallEnd): Point | null {
  if (wall.vertices.length === 0) return null
  return end === 'start' ? wall.vertices[0] : wall.vertices[wall.vertices.length - 1]
}

/** Accepts either shape the callers have to hand, without rebuilding a map they already own. */
function wallsById(walls: ReadonlyMap<string, Wall> | readonly Wall[]): ReadonlyMap<string, Wall> {
  // Of the two shapes, only the map can look a wall up by id already.
  if ('get' in walls) return walls
  const byId = new Map<string, Wall>()
  for (const wall of walls) byId.set(wall.id, wall)
  return byId
}
