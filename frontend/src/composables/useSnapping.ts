import type { Ref } from 'vue'

import type { Joint, Point, Wall } from '@/types/plan'
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
import type { AlignmentAnchor, AlignmentGuide } from '@/utils/geometry'

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
export type SnapMarkerKind = 'close' | 'endpoint' | 'midpoint' | 'projection'

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
}

/**
 * Shared snap-resolution engine for drawing and (later) editing tools.
 *
 * Pure with respect to the DOM: all inputs are injected refs, so the engine is
 * headlessly testable and reusable by the Phase C editing tools.
 */
export function useSnapping(options: UseSnappingOptions): UseSnappingReturn {
  const { walls, joints, pixelsPerInch, settings } = options
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
      }
    }
    return {
      point: { ...cursor },
      marker: null,
      guide: null,
      alignGuide: null,
      alignmentGuides: NO_ALIGNMENT_GUIDES,
      attachment: null,
    }
  }

  function resolveWallSnap(
    cursor: Point,
    threshold: number,
    ray: SnapGuide | null,
  ): SnapResult | null {
    let endpoint: WallSnapCandidate | null = null
    let midpoint: WallSnapCandidate | null = null
    let projection: WallSnapCandidate | null = null

    for (const wall of walls.value) {
      const ring = wall.closed ? [...wall.vertices, wall.vertices[0]] : wall.vertices

      for (const vertex of wall.vertices) {
        const d = distance(cursor, vertex)
        if (d <= threshold && (!endpoint || d < endpoint.distance)) {
          endpoint = { point: { ...vertex }, distance: d, attachment: null }
        }
      }

      for (let i = 0; i < ring.length - 1; i++) {
        const mid = lerp(ring[i], ring[i + 1], 0.5)
        const d = distance(cursor, mid)
        if (d <= threshold && (!midpoint || d < midpoint.distance)) {
          midpoint = { point: mid, distance: d, attachment: null }
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
          if (d <= threshold && (!projection || d < projection.distance)) {
            projection = {
              point,
              distance: d,
              attachment: { wallId: wall.id, segmentIndex: i, tIn },
            }
          }
        }
      } else {
        const projected = projectPointOnPolyline(cursor, ring)
        if (projected && projected.distance <= threshold) {
          if (!projection || projected.distance < projection.distance) {
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
            }
          }
        }
      }
    }

    if (endpoint) {
      return {
        point: endpoint.point,
        marker: 'endpoint',
        guide: null,
        alignGuide: null,
        alignmentGuides: NO_ALIGNMENT_GUIDES,
        attachment: null,
      }
    }
    if (midpoint) {
      return {
        point: midpoint.point,
        marker: 'midpoint',
        guide: null,
        alignGuide: null,
        alignmentGuides: NO_ALIGNMENT_GUIDES,
        attachment: null,
      }
    }
    if (projection) {
      return {
        point: projection.point,
        marker: 'projection',
        guide: ray,
        alignGuide: null,
        alignmentGuides: NO_ALIGNMENT_GUIDES,
        attachment: projection.attachment,
      }
    }
    return null
  }

  return { settings, thresholdIn, resolve, direction }
}

function snapToGrid(point: Point): Point {
  return {
    x: Math.round(point.x / GRID_STEP_IN) * GRID_STEP_IN,
    y: Math.round(point.y / GRID_STEP_IN) * GRID_STEP_IN,
  }
}
