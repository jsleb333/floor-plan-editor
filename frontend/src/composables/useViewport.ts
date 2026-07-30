import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Point, Viewport } from '@/types/plan'

/** Screen pixels per world inch at 100% zoom. */
export const BASE_PIXELS_PER_INCH = 2
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 40

export interface Size {
  width: number
  height: number
}

/**
 * Screen pixels occluded per side by chrome floating OVER the canvas (the
 * tool rail, the side panel, the mode pill), so fits frame content within
 * the visible region rather than the full viewport.
 */
export interface FitInsets {
  left: number
  right: number
  top: number
  bottom: number
}

const NO_INSETS: FitInsets = { left: 0, right: 0, top: 0, bottom: 0 }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface UseViewportReturn {
  /** World point currently shown at the centre of the screen. */
  center: Ref<Point>
  /** Zoom factor, 1 = 100%. Always within [MIN_ZOOM, MAX_ZOOM]. */
  zoom: Ref<number>
  /** Size of the on-screen viewport in pixels; must be kept up to date by the host. */
  viewportSize: Ref<Size>
  /** Screen pixels per world inch (zoom x base scale). */
  scale: ComputedRef<number>
  /** SVG transform string mapping world coordinates to screen coordinates. */
  transform: ComputedRef<string>
  /** World-space rectangle currently visible on screen. */
  visibleWorldRect: ComputedRef<Rect>
  worldToScreen: (point: Point) => Point
  screenToWorld: (point: Point) => Point
  /** Pans by a screen-space delta (e.g. pointer movement in pixels). */
  panByScreen: (dx: number, dy: number) => void
  /** Multiplies zoom by `factor`, keeping the world point under `screenPoint` fixed. */
  zoomAtPoint: (factor: number, screenPoint: Point) => void
  /** Sets an absolute zoom, anchored at `screenAnchor` (default: screen centre). */
  setZoom: (target: number, screenAnchor?: Point) => void
  /** Fits a world rectangle into the viewport with a screen padding in pixels. */
  fitToRect: (rect: Rect, padding?: number, insets?: FitInsets) => void
  getViewport: () => Viewport
  setViewport: (viewport: Viewport) => void
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * Pure pan/zoom state for the editor viewport — the screen/world transform
 * math lives here so it is unit-testable without any DOM.
 *
 * @param initial Optional persisted viewport (world centre + zoom) to restore.
 */
export function useViewport(initial?: Viewport): UseViewportReturn {
  const center = ref<Point>(initial ? { ...initial.center } : { x: 0, y: 0 })
  const zoom = ref(clampZoom(initial?.zoom ?? 1))
  const viewportSize = ref<Size>({ width: 0, height: 0 })

  const scale = computed(() => zoom.value * BASE_PIXELS_PER_INCH)

  function worldToScreen(point: Point): Point {
    return {
      x: (point.x - center.value.x) * scale.value + viewportSize.value.width / 2,
      y: (point.y - center.value.y) * scale.value + viewportSize.value.height / 2,
    }
  }

  function screenToWorld(point: Point): Point {
    return {
      x: (point.x - viewportSize.value.width / 2) / scale.value + center.value.x,
      y: (point.y - viewportSize.value.height / 2) / scale.value + center.value.y,
    }
  }

  function panByScreen(dx: number, dy: number): void {
    center.value = {
      x: center.value.x - dx / scale.value,
      y: center.value.y - dy / scale.value,
    }
  }

  function zoomAtPoint(factor: number, screenPoint: Point): void {
    const anchor = screenToWorld(screenPoint)
    zoom.value = clampZoom(zoom.value * factor)
    center.value = {
      x: anchor.x - (screenPoint.x - viewportSize.value.width / 2) / scale.value,
      y: anchor.y - (screenPoint.y - viewportSize.value.height / 2) / scale.value,
    }
  }

  function setZoom(target: number, screenAnchor?: Point): void {
    const anchor = screenAnchor ?? {
      x: viewportSize.value.width / 2,
      y: viewportSize.value.height / 2,
    }
    zoomAtPoint(clampZoom(target) / zoom.value, anchor)
  }

  function fitToRect(rect: Rect, padding = 48, insets: FitInsets = NO_INSETS): void {
    const availableWidth = viewportSize.value.width - insets.left - insets.right - 2 * padding
    const availableHeight = viewportSize.value.height - insets.top - insets.bottom - 2 * padding
    if (availableWidth <= 0 || availableHeight <= 0 || rect.width <= 0 || rect.height <= 0) return
    const targetScale = Math.min(availableWidth / rect.width, availableHeight / rect.height)
    zoom.value = clampZoom(targetScale / BASE_PIXELS_PER_INCH)
    // Centre the rect within the UNOCCLUDED region: the world point at the
    // viewport centre shifts toward the heavier inset by half the imbalance,
    // converted to world units at the final (possibly clamped) scale.
    const s = zoom.value * BASE_PIXELS_PER_INCH
    center.value = {
      x: rect.x + rect.width / 2 + (insets.right - insets.left) / (2 * s),
      y: rect.y + rect.height / 2 + (insets.bottom - insets.top) / (2 * s),
    }
  }

  const transform = computed(() => {
    const s = scale.value
    const tx = viewportSize.value.width / 2 - center.value.x * s
    const ty = viewportSize.value.height / 2 - center.value.y * s
    return `translate(${tx} ${ty}) scale(${s})`
  })

  const visibleWorldRect = computed<Rect>(() => {
    const topLeft = screenToWorld({ x: 0, y: 0 })
    const bottomRight = screenToWorld({
      x: viewportSize.value.width,
      y: viewportSize.value.height,
    })
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    }
  })

  function getViewport(): Viewport {
    return { center: { ...center.value }, zoom: zoom.value }
  }

  function setViewport(viewport: Viewport): void {
    center.value = { ...viewport.center }
    zoom.value = clampZoom(viewport.zoom)
  }

  return {
    center,
    zoom,
    viewportSize,
    scale,
    transform,
    visibleWorldRect,
    worldToScreen,
    screenToWorld,
    panByScreen,
    zoomAtPoint,
    setZoom,
    fitToRect,
    getViewport,
    setViewport,
  }
}
