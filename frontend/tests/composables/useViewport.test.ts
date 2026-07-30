import { describe, expect, it } from 'vitest'

import { BASE_PIXELS_PER_INCH, MAX_ZOOM, MIN_ZOOM, useViewport } from '@/composables/useViewport'
import type { UseViewportReturn } from '@/composables/useViewport'

function makeViewport(width = 800, height = 600): UseViewportReturn {
  const viewport = useViewport()
  viewport.viewportSize.value = { width, height }
  return viewport
}

describe('useViewport', () => {
  it('round-trips screen and world coordinates', () => {
    const viewport = makeViewport()
    viewport.setViewport({ center: { x: 42, y: -17 }, zoom: 3 })
    const screen = { x: 123, y: 456 }
    const world = viewport.screenToWorld(screen)
    const back = viewport.worldToScreen(world)
    expect(back.x).toBeCloseTo(screen.x, 10)
    expect(back.y).toBeCloseTo(screen.y, 10)
  })

  it('maps the centre of the viewport to the viewport centre point', () => {
    const viewport = makeViewport()
    viewport.setViewport({ center: { x: 10, y: 20 }, zoom: 1 })
    const screen = viewport.worldToScreen({ x: 10, y: 20 })
    expect(screen).toEqual({ x: 400, y: 300 })
  })

  describe('zoomAtPoint', () => {
    it('keeps the world point under the cursor fixed', () => {
      const viewport = makeViewport()
      viewport.setViewport({ center: { x: 10, y: 20 }, zoom: 1 })
      const cursor = { x: 200, y: 150 }
      const anchoredWorld = viewport.screenToWorld(cursor)

      viewport.zoomAtPoint(2, cursor)

      expect(viewport.zoom.value).toBe(2)
      const after = viewport.screenToWorld(cursor)
      expect(after.x).toBeCloseTo(anchoredWorld.x, 10)
      expect(after.y).toBeCloseTo(anchoredWorld.y, 10)
    })

    it('clamps zoom to the allowed range', () => {
      const viewport = makeViewport()
      viewport.zoomAtPoint(1e9, { x: 400, y: 300 })
      expect(viewport.zoom.value).toBe(MAX_ZOOM)
      viewport.zoomAtPoint(1e-12, { x: 400, y: 300 })
      expect(viewport.zoom.value).toBe(MIN_ZOOM)
    })
  })

  describe('panByScreen', () => {
    it('moves the centre opposite to the drag, in world units', () => {
      const viewport = makeViewport()
      viewport.setViewport({ center: { x: 0, y: 0 }, zoom: 1 })
      const scale = viewport.scale.value

      viewport.panByScreen(100, -50)

      expect(viewport.center.value.x).toBeCloseTo(-100 / scale, 10)
      expect(viewport.center.value.y).toBeCloseTo(50 / scale, 10)
    })
  })

  describe('fitToRect', () => {
    it('centres the rect and fills the viewport up to the padding', () => {
      const viewport = makeViewport(800, 600)
      const rect = { x: 0, y: 0, width: 360, height: 360 }

      viewport.fitToRect(rect, 48)

      // Limiting axis is vertical: (600 - 96) / 360 = 1.4 px/in -> zoom 0.7.
      expect(viewport.zoom.value).toBeCloseTo(1.4 / BASE_PIXELS_PER_INCH, 10)
      const centreOnScreen = viewport.worldToScreen({ x: 180, y: 180 })
      expect(centreOnScreen.x).toBeCloseTo(400, 10)
      expect(centreOnScreen.y).toBeCloseTo(300, 10)
      const topEdge = viewport.worldToScreen({ x: 180, y: 0 })
      expect(topEdge.y).toBeCloseTo(48, 10)
    })

    it('ignores degenerate rects and viewports', () => {
      const viewport = makeViewport(800, 600)
      viewport.setViewport({ center: { x: 1, y: 2 }, zoom: 3 })
      viewport.fitToRect({ x: 0, y: 0, width: 0, height: 100 })
      expect(viewport.getViewport()).toEqual({ center: { x: 1, y: 2 }, zoom: 3 })
    })

    it('centres the rect within the unoccluded region when chrome insets are given', () => {
      const viewport = makeViewport(800, 600)
      const rect = { x: 0, y: 0, width: 360, height: 360 }

      viewport.fitToRect(rect, 48, { left: 0, right: 200, top: 0, bottom: 0 })

      // Limiting axis is horizontal: (800 - 200 - 96) / 360 = 1.4 px/in.
      expect(viewport.zoom.value).toBeCloseTo(1.4 / BASE_PIXELS_PER_INCH, 10)
      // The rect centre lands at the middle of the visible 600px strip, not
      // at the viewport centre hiding under the 200px panel.
      const centreOnScreen = viewport.worldToScreen({ x: 180, y: 180 })
      expect(centreOnScreen.x).toBeCloseTo(300, 10)
      expect(centreOnScreen.y).toBeCloseTo(300, 10)
    })
  })

  it('produces an SVG transform matching the world-to-screen mapping', () => {
    const viewport = makeViewport()
    viewport.setViewport({ center: { x: 0, y: 0 }, zoom: 1 })
    expect(viewport.transform.value).toBe(`translate(400 300) scale(${BASE_PIXELS_PER_INCH})`)
  })

  it('reports the visible world rect', () => {
    const viewport = makeViewport(800, 600)
    viewport.setViewport({ center: { x: 0, y: 0 }, zoom: 1 })
    const rect = viewport.visibleWorldRect.value
    expect(rect.x).toBeCloseTo(-200, 10)
    expect(rect.y).toBeCloseTo(-150, 10)
    expect(rect.width).toBeCloseTo(400, 10)
    expect(rect.height).toBeCloseTo(300, 10)
  })
})
