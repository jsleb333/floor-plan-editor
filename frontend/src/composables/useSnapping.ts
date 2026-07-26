import type { Ref } from 'vue'

import type { Point, Wall } from '@/types/plan'
import {
  add,
  alignFree,
  alignOnRay,
  distance,
  dot,
  lerp,
  projectPointOnPolyline,
  scale,
  snapDirection,
  sub,
} from '@/utils/geometry'

/** Default grid pitch for grid snapping, in inches (spec §3: minor grid 3"). */
export const GRID_STEP_IN = 3
/** Snap capture radius on screen; converted to world inches by the current zoom. */
export const SNAP_THRESHOLD_PX = 10
/** Minimum vertices in the pending chain before the close-loop snap engages (spec S1c). */
const MIN_CLOSE_VERTICES = 3
/** Minimum chain vertices before alignment with the start vertex is offered (spec S1c). */
const MIN_ALIGN_VERTICES = 2

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
  /** Set when the point lies on an existing wall's reference line (projection snap). */
  attachment: WallSnapAttachment | null
}

export interface UseSnappingOptions {
  /** Existing walls to snap against (the pending chain is never included). */
  walls: Ref<readonly Wall[]>
  /** Current screen pixels per world inch, to convert the pixel threshold to inches. */
  pixelsPerInch: Ref<number>
  settings: SnapSettings
}

export interface UseSnappingReturn {
  settings: SnapSettings
  /** Current snap capture radius in world inches. */
  thresholdIn: () => number
  /**
   * Resolves the snapped point for a raw world cursor (priority per specs
   * S3a/E6): chain-start close, wall endpoint, segment midpoint, projection
   * onto a reference line, alignment with the chain start, then angle/grid
   * constraints. `free` (Alt held) disables the alignment, angle and grid
   * constraints only.
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
  const { walls, pixelsPerInch, settings } = options

  function thresholdIn(): number {
    return SNAP_THRESHOLD_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
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
        attachment: null,
      }
    }

    if (settings.walls.value) {
      const wallSnap = resolveWallSnap(cursor, threshold)
      if (wallSnap) return wallSnap
    }

    const angleActive = settings.angle.value && !free
    const gridActive = settings.grid.value && !free
    const alignActive = !free && chain !== null && chain.vertexCount >= MIN_ALIGN_VERTICES

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
        attachment: null,
      }
    }
    return { point: { ...cursor }, marker: null, guide: null, alignGuide: null, attachment: null }
  }

  function resolveWallSnap(cursor: Point, threshold: number): SnapResult | null {
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

    if (endpoint) {
      return {
        point: endpoint.point,
        marker: 'endpoint',
        guide: null,
        alignGuide: null,
        attachment: null,
      }
    }
    if (midpoint) {
      return {
        point: midpoint.point,
        marker: 'midpoint',
        guide: null,
        alignGuide: null,
        attachment: null,
      }
    }
    if (projection) {
      return {
        point: projection.point,
        marker: 'projection',
        guide: null,
        alignGuide: null,
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
