import type { Ref } from 'vue'

import type { Joint, Point, Wall, WallEnd, WallSide } from '@/types/plan'
import {
  EPSILON,
  add,
  alignFree,
  alignOnRay,
  anchorAlignFree,
  anchorAlignOnRay,
  collectAlignmentAnchors,
  distance,
  dot,
  length,
  lerp,
  lineIntersection,
  projectPointOnPolyline,
  scale,
  snapDirection,
  sub,
} from '@/utils/geometry'
import type { AlignmentAnchor, AlignmentGuide, ResolvedNetwork } from '@/utils/geometry'

/** Default grid pitch for grid snapping, in inches (spec §3: minor grid 3"). */
export const GRID_STEP_IN = 3
/** Snap capture radius on screen; converted to world inches by the current zoom. */
export const SNAP_THRESHOLD_PX = 10
/** Anchor capture radius on screen for the S1e alignment guides; scales with zoom like the snap threshold. */
export const ALIGN_ANCHOR_CAPTURE_PX = 250
/** Minimum vertices in the pending chain before the close-loop snap engages (spec S1c). */
const MIN_CLOSE_VERTICES = 3
/** Minimum chain vertices before alignment with the start vertex is offered (spec S1c). */
const MIN_ALIGN_VERTICES = 2
/** Shared empty guide list, so misses never allocate per cursor move. */
const NO_ALIGNMENT_GUIDES: readonly AlignmentGuide[] = []
/** Shared empty anchor list for resolutions with the S1e guides inactive. */
const NO_ANCHORS: readonly AlignmentAnchor[] = []
/** Shared empty joint list, for callers that snap without connectivity context. */
const NO_JOINTS: readonly Joint[] = []

/** Identifier of one snap toggle (status bar buttons). */
export type SnapToggleId = keyof SnapSettings

/** User-toggleable snap categories (status bar toggles, spec §6.1). */
export interface SnapSettings {
  /** Snap free points and segment lengths to the 3" grid. */
  grid: Ref<boolean>
  /** Constrain pending segments to the eight global 45° directions (spec S1). */
  angle: Ref<boolean>
  /** Snap to existing walls: endpoints, midpoints and projections (spec S3a). */
  walls: Ref<boolean>
}

/** Which visual marker a resolved snap displays (spec E6). Grid snaps show none. */
export type SnapMarkerKind = 'close' | 'endpoint' | 'midpoint' | 'projection' | 'surface'

/**
 * What existing geometry a wall snap captured, so the tool can record the right
 * relation (`docs/WALL_NETWORK.md` §6).
 *
 * The engine reports WHAT was hit and leaves the consequences to the tool: only
 * the tool knows the pending wall's thickness and reference, which is what
 * turns a captured surface into a spine position.
 */
export type SnapTarget =
  /** A wall's own free end. A new wall starting or ending here forms a corner. */
  | { kind: 'wall-end'; wallId: string; end: WallEnd }
  /** The terminus of a surface, at a free end: a new wall may continue it flush. */
  | { kind: 'surface-end'; wallId: string; side: WallSide; end: WallEnd; segmentIndex: number }
  /** A point along a surface, away from its ends: a new wall butts against it. */
  | { kind: 'surface'; wallId: string; side: WallSide; segmentIndex: number }

/** Where a projection snap landed on a host wall, for T-junction records (spec S3a). */
export interface WallSnapAttachment {
  wallId: string
  segmentIndex: number
  /** Inches along the host segment's reference line from its start vertex. */
  tIn: number
}

/** The pending chain the snap engine needs to know about, if any. */
export interface SnapChainContext {
  /** First vertex of the chain (close-loop target). */
  start: Point
  /** Most recently placed vertex (origin of the pending segment). */
  last: Point
  vertexCount: number
}

/** A guide line to render alongside a snapped point (angle ray, alignment line). */
export interface SnapGuide {
  origin: Point
  dir: Point
}

/** A resolved snap: the point to use plus everything needed to visualize it. */
export interface SnapResult {
  point: Point
  marker: SnapMarkerKind | null
  /** Angle-snap guide ray to render when the direction is constrained. */
  guide: SnapGuide | null
  /** Alignment line through the chain start when `point` is snapped in line with it (spec S1c). */
  alignGuide: SnapGuide | null
  /** Alignment guides through existing-geometry anchors when `point` snapped onto them (spec S1e, at most two). */
  alignmentGuides: readonly AlignmentGuide[]
  /** Set when the point lies on an existing wall's reference line (projection snap). */
  attachment: WallSnapAttachment | null
  /** What was captured, when the snap landed on existing wall geometry. */
  target: SnapTarget | null
}

/** The snapped point plus its engaged S1e guides, ready for the guides overlay. */
export interface AlignmentGuidesView {
  point: Point
  guides: readonly AlignmentGuide[]
}

export interface UseSnappingOptions {
  /** Existing walls to snap against (the pending chain is never included). */
  walls: Ref<readonly Wall[]>
  /** How those walls connect, for classifying the S1e junction anchors. */
  joints?: Ref<readonly Joint[]>
  /**
   * The resolved network, which is what makes a wall's SURFACES snappable — the
   * thing the user can actually see and point at. Without it the engine falls
   * back to spine geometry only.
   */
  network?: Ref<ResolvedNetwork>
  /** Current screen pixels per world inch, to convert the pixel threshold to inches. */
  pixelsPerInch: Ref<number>
  settings: SnapSettings
  /**
   * Enables the S1e alignment guides projected through existing wall vertices
   * (default true). The select tool opts out: its drags fold modifier state
   * into the `resolve` arguments upstream, and anchor guides there would
   * fight the drag-specific constraints.
   */
  anchorGuides?: boolean
}

export interface UseSnappingReturn {
  settings: SnapSettings
  /** Current snap capture radius in world inches. */
  thresholdIn: () => number
  /**
   * Resolves the snapped point for a raw world cursor (priority per specs
   * S3a/S1e/E6): chain-start close, wall endpoint, segment midpoint,
   * projection onto a reference line (constrained to the pending segment's
   * snapped direction while drawing with angle snap on), alignment with the
   * chain start (spec S1c), alignment guides through nearby wall vertices and
   * junctions (spec S1e), then angle/grid constraints. `free` (Alt held)
   * disables the alignment, angle and grid constraints only.
   */
  resolve: (cursor: Point, chain: SnapChainContext | null, free: boolean) => SnapResult
  /** Unit drawing direction `from -> toward`, angle-snapped unless disabled or `free`. */
  direction: (from: Point, toward: Point, free: boolean) => Point
}

interface WallSnapCandidate {
  point: Point
  distance: number
  attachment: WallSnapAttachment | null
  target: SnapTarget | null
}

/**
 * Shared snap-resolution engine for drawing and (later) editing tools.
 *
 * Pure with respect to the DOM: all inputs are injected refs, so the engine is
 * headlessly testable and reusable by the Phase C editing tools.
 */
export function useSnapping(options: UseSnappingOptions): UseSnappingReturn {
  const { walls, joints, network, pixelsPerInch, settings } = options
  const anchorGuidesEnabled = options.anchorGuides ?? true

  function thresholdIn(): number {
    return SNAP_THRESHOLD_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
  }

  function anchorCaptureIn(): number {
    return ALIGN_ANCHOR_CAPTURE_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
  }

  function direction(from: Point, toward: Point, free: boolean): Point {
    return snapDirection(sub(toward, from), settings.angle.value && !free)
  }

  function resolve(cursor: Point, chain: SnapChainContext | null, free: boolean): SnapResult {
    const threshold = thresholdIn()

    if (
      chain &&
      chain.vertexCount >= MIN_CLOSE_VERTICES &&
      distance(cursor, chain.start) <= threshold
    ) {
      return {
        point: { ...chain.start },
        marker: 'close',
        guide: null,
        alignGuide: null,
        alignmentGuides: NO_ALIGNMENT_GUIDES,
        attachment: null,
        target: null,
      }
    }

    const angleActive = settings.angle.value && !free
    const gridActive = settings.grid.value && !free
    const alignActive = !free && chain !== null && chain.vertexCount >= MIN_ALIGN_VERTICES
    // The S1e guides derive from walls, so the walls toggle governs them; Alt
    // suspends them with the rest of the align/angle family (spec S1e).
    const anchorsActive = anchorGuidesEnabled && settings.walls.value && !free

    if (settings.walls.value) {
      const ray =
        chain && angleActive
          ? { origin: chain.last, dir: snapDirection(sub(cursor, chain.last), true) }
          : null
      const wallSnap = resolveWallSnap(cursor, threshold, ray)
      if (wallSnap) return wallSnap
    }

    const anchors = anchorsActive
      ? collectAlignmentAnchors(walls.value, joints?.value ?? NO_JOINTS, cursor, anchorCaptureIn())
      : NO_ANCHORS

    if (chain && angleActive) {
      const dir = snapDirection(sub(cursor, chain.last), true)
      let along = Math.max(dot(sub(cursor, chain.last), dir), 0)
      if (alignActive) {
        const aligned = alignOnRay(chain.last, dir, chain.start, along, threshold)
        if (aligned) {
          return {
            point: aligned.point,
            marker: null,
            guide: { origin: chain.last, dir },
            alignGuide: { origin: { ...chain.start }, dir: aligned.guideDir },
            alignmentGuides: NO_ALIGNMENT_GUIDES,
            attachment: null,
            target: null,
          }
        }
      }
      if (anchors.length > 0) {
        const anchored = anchorAlignOnRay(chain.last, dir, anchors, along, threshold)
        if (anchored) {
          return {
            point: anchored.point,
            marker: null,
            guide: { origin: chain.last, dir },
            alignGuide: null,
            alignmentGuides: anchored.guides,
            attachment: null,
            target: null,
          }
        }
      }
      if (gridActive) along = Math.round(along / GRID_STEP_IN) * GRID_STEP_IN
      return {
        point: add(chain.last, scale(dir, along)),
        marker: null,
        guide: { origin: chain.last, dir },
        alignGuide: null,
        alignmentGuides: NO_ALIGNMENT_GUIDES,
        attachment: null,
        target: null,
      }
    }

    if (chain && alignActive) {
      const aligned = alignFree(cursor, chain.start, threshold)
      if (aligned) {
        return {
          point: aligned.point,
          marker: null,
          guide: null,
          alignGuide: { origin: { ...chain.start }, dir: aligned.guideDir },
          alignmentGuides: NO_ALIGNMENT_GUIDES,
          attachment: null,
          target: null,
        }
      }
    }

    if (anchors.length > 0) {
      const anchored = anchorAlignFree(cursor, anchors, threshold)
      if (anchored) {
        return {
          point: anchored.point,
          marker: null,
          guide: null,
          alignGuide: null,
          alignmentGuides: anchored.guides,
          attachment: null,
          target: null,
        }
      }
    }

    if (gridActive) {
      return {
        point: snapToGrid(cursor),
        marker: null,
        guide: null,
        alignGuide: null,
        alignmentGuides: NO_ALIGNMENT_GUIDES,
        attachment: null,
        target: null,
      }
    }
    return {
      point: { ...cursor },
      marker: null,
      guide: null,
      alignGuide: null,
      alignmentGuides: NO_ALIGNMENT_GUIDES,
      attachment: null,
      target: null,
    }
  }

  function resolveWallSnap(
    cursor: Point,
    threshold: number,
    ray: SnapGuide | null,
  ): SnapResult | null {
    let endpoint: WallSnapCandidate | null = null
    let surfaceEnd: WallSnapCandidate | null = null
    let midpoint: WallSnapCandidate | null = null
    let surface: WallSnapCandidate | null = null
    let projection: WallSnapCandidate | null = null

    const closer = (candidate: WallSnapCandidate | null, distance: number): boolean =>
      !candidate || distance < candidate.distance

    for (const wall of walls.value) {
      const ring = wall.closed ? [...wall.vertices, wall.vertices[0]] : wall.vertices
      const lastIndex = wall.vertices.length - 1

      for (let i = 0; i <= lastIndex; i++) {
        const vertex = wall.vertices[i]
        const d = distance(cursor, vertex)
        if (d > threshold || !closer(endpoint, d)) continue
        // Only a free end can form a corner; an interior vertex is a body.
        const end: WallEnd | null = wall.closed
          ? null
          : i === 0
            ? 'start'
            : i === lastIndex
              ? 'end'
              : null
        endpoint = {
          point: { ...vertex },
          distance: d,
          attachment: null,
          target: end === null ? null : { kind: 'wall-end', wallId: wall.id, end },
        }
      }

      for (let i = 0; i < ring.length - 1; i++) {
        const mid = lerp(ring[i], ring[i + 1], 0.5)
        const d = distance(cursor, mid)
        if (d <= threshold && closer(midpoint, d)) {
          midpoint = { point: mid, distance: d, attachment: null, target: null }
        }
      }

      if (ray) {
        // Drawing under the angle constraint: the landing point must stay on
        // the ray, so project along it — where the ray crosses the segment —
        // instead of dropping the cursor perpendicularly onto the wall.
        for (let i = 0; i < ring.length - 1; i++) {
          const segmentDir = sub(ring[i + 1], ring[i])
          const point = lineIntersection(ray.origin, ray.dir, ring[i], segmentDir)
          if (!point || dot(sub(point, ray.origin), ray.dir) <= EPSILON) continue
          const segmentLength = length(segmentDir)
          const tIn = dot(sub(point, ring[i]), segmentDir) / segmentLength
          if (tIn < -EPSILON || tIn > segmentLength + EPSILON) continue
          const d = distance(cursor, point)
          if (d <= threshold && closer(projection, d)) {
            projection = {
              point,
              distance: d,
              attachment: { wallId: wall.id, segmentIndex: i, tIn },
              target: null,
            }
          }
        }
      } else {
        const projected = projectPointOnPolyline(cursor, ring)
        if (
          projected &&
          projected.distance <= threshold &&
          closer(projection, projected.distance)
        ) {
          const segmentLength = distance(
            ring[projected.segmentIndex],
            ring[projected.segmentIndex + 1],
          )
          projection = {
            point: projected.point,
            distance: projected.distance,
            attachment: {
              wallId: wall.id,
              segmentIndex: projected.segmentIndex,
              tIn: projected.t * segmentLength,
            },
            target: null,
          }
        }
      }
    }

    // Surfaces: what the user can actually see and points at. A thick wall's
    // surface is half a thickness from its spine, which is why pointing at it
    // used to capture nothing (`docs/WALL_NETWORK.md` §6).
    for (const resolved of network?.value.walls.values() ?? []) {
      const host = walls.value.find((wall) => wall.id === resolved.wallId)
      if (!host) continue
      const spine = host.closed ? [...host.vertices, host.vertices[0]] : host.vertices
      const lastSegment = Math.max(spine.length - 2, 0)

      for (const side of ['left', 'right'] as const) {
        const face = resolved[side]
        if (face.length < 2) continue

        for (const end of ['start', 'end'] as const) {
          if (!resolved.ends[end]) continue
          const corner = end === 'start' ? face[0] : face[face.length - 1]
          const d = distance(cursor, corner)
          if (d > threshold || !closer(surfaceEnd, d)) continue
          surfaceEnd = {
            point: { ...corner },
            distance: d,
            attachment: null,
            target: {
              kind: 'surface-end',
              wallId: resolved.wallId,
              side,
              end,
              segmentIndex: end === 'start' ? 0 : lastSegment,
            },
          }
        }

        const hit = ray
          ? rayCrossing(face, ray, cursor, threshold)
          : dropOnto(face, cursor, threshold)
        if (!hit || !closer(surface, hit.distance)) continue
        // The relation is addressed on the host's SPINE segment, which the face
        // polyline cannot index directly: mitre joins and bevels give it a
        // different point count.
        const onSpine = projectPointOnPolyline(hit.point, spine)
        surface = {
          ...hit,
          attachment: null,
          target: {
            kind: 'surface',
            wallId: resolved.wallId,
            side,
            segmentIndex: onSpine?.segmentIndex ?? 0,
          },
        }
      }
    }

    // Point targets beat line targets outright (spec S3a). Among the points the
    // NEAREST wins rather than a fixed order: on a 12" wall the visible corner
    // and the spine end are 6" apart, and a fixed order would make whichever
    // lost unreachable — the same defect as snapping only to spines.
    const winner = nearest([endpoint, surfaceEnd, midpoint]) ?? surface ?? projection
    if (!winner) return null
    return {
      point: winner.point,
      marker: markerFor(winner, { endpoint, surfaceEnd, midpoint }),
      guide: winner === surface || winner === projection ? ray : null,
      alignGuide: null,
      alignmentGuides: NO_ALIGNMENT_GUIDES,
      attachment: winner.attachment,
      target: winner.target,
    }
  }

  return { settings, thresholdIn, resolve, direction }
}

/** The closest of several candidates; ties resolve to the earlier one. */
function nearest(candidates: readonly (WallSnapCandidate | null)[]): WallSnapCandidate | null {
  let best: WallSnapCandidate | null = null
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.distance < best.distance)) best = candidate
  }
  return best
}

/** Which marker a winning candidate shows; surfaces and the spine both read as a projection. */
function markerFor(
  winner: WallSnapCandidate,
  points: {
    endpoint: WallSnapCandidate | null
    surfaceEnd: WallSnapCandidate | null
    midpoint: WallSnapCandidate | null
  },
): SnapMarkerKind {
  if (winner === points.endpoint) return 'endpoint'
  if (winner === points.surfaceEnd) return 'surface'
  if (winner === points.midpoint) return 'midpoint'
  return 'projection'
}

/** Perpendicular drop of the cursor onto a polyline, within `threshold`. */
function dropOnto(
  polyline: readonly Point[],
  cursor: Point,
  threshold: number,
): { point: Point; distance: number } | null {
  const projected = projectPointOnPolyline(cursor, [...polyline])
  if (!projected || projected.distance > threshold) return null
  return { point: projected.point, distance: projected.distance }
}

/**
 * Where a pending segment's constrained ray crosses a polyline (spec S3a): the
 * segment keeps its 90/45 angle and still lands exactly on the wall.
 */
function rayCrossing(
  polyline: readonly Point[],
  ray: SnapGuide,
  cursor: Point,
  threshold: number,
): { point: Point; distance: number } | null {
  let best: { point: Point; distance: number } | null = null
  for (let i = 0; i < polyline.length - 1; i++) {
    const segmentDir = sub(polyline[i + 1], polyline[i])
    const point = lineIntersection(ray.origin, ray.dir, polyline[i], segmentDir)
    if (!point || dot(sub(point, ray.origin), ray.dir) <= EPSILON) continue
    const along = dot(sub(point, polyline[i]), segmentDir) / length(segmentDir)
    if (along < -EPSILON || along > length(segmentDir) + EPSILON) continue
    const d = distance(cursor, point)
    if (d <= threshold && (!best || d < best.distance)) best = { point, distance: d }
  }
  return best
}

function snapToGrid(point: Point): Point {
  return {
    x: Math.round(point.x / GRID_STEP_IN) * GRID_STEP_IN,
    y: Math.round(point.y / GRID_STEP_IN) * GRID_STEP_IN,
  }
}
