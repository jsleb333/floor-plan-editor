import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import ViewportCanvas from '@/components/editor/ViewportCanvas.vue'
import type { Rect } from '@/composables/useViewport'
import type { Point, Viewport } from '@/types/plan'

const INITIAL: Viewport = { center: { x: 0, y: 0 }, zoom: 1 }
const PRIMARY = 0
const MIDDLE = 1
const MOUSE_WHEEL_NOTCH = 100
const VIEWPORT_WIDTH = 800
const VIEWPORT_HEIGHT = 600

beforeAll(() => {
  // jsdom ships none of these, and the canvas uses all of them.
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: VIEWPORT_WIDTH,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  })
})

interface CanvasExposed {
  fitTo: (rect: Rect | null) => void
  zoomTo100: () => void
}

interface Harness {
  wrapper: VueWrapper
  canvas: Element
  exposed: CanvasExposed
}

let mounted: VueWrapper | null = null

function mountCanvas(): Harness {
  const wrapper = mount(ViewportCanvas, {
    props: { initialViewport: INITIAL, scrollMode: 'auto' as const },
    attachTo: window.document.body,
  })
  mounted = wrapper
  return {
    wrapper,
    canvas: wrapper.find('svg').element,
    exposed: wrapper.vm as unknown as CanvasExposed,
  }
}

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

/**
 * Dispatches a real PointerEvent. `wrapper.trigger` cannot be used here:
 * it assigns `clientX`/`clientY` after construction, and they are getters.
 */
function pointer(
  target: Element,
  type: string,
  init: { button?: number; pointerId?: number; clientX?: number; clientY?: number },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
    }),
  )
}

function wheel(target: Element, deltaY: number, deltaX = 0): void {
  target.dispatchEvent(
    new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY, deltaMode: 0 }),
  )
}

/** The viewport of the last `viewport-change`, or null when none was emitted. */
function lastViewport(wrapper: VueWrapper): Viewport | null {
  const events = wrapper.emitted('viewport-change')
  if (!events?.length) return null
  return events[events.length - 1]?.[0] as Viewport
}

function lastCenter(wrapper: VueWrapper): Point | null {
  return lastViewport(wrapper)?.center ?? null
}

describe('ViewportCanvas gestures', () => {
  it('pans on a middle-button drag without reporting a press', async () => {
    const { wrapper, canvas } = mountCanvas()

    pointer(canvas, 'pointerdown', { button: MIDDLE, clientX: 100, clientY: 100 })
    pointer(canvas, 'pointermove', { clientX: 60, clientY: 100 })
    await nextTick()

    expect(wrapper.emitted('canvas-press')).toBeUndefined()
    expect(lastCenter(wrapper)?.x).toBeGreaterThan(0)
  })

  it('forwards a plain left drag to the tools and leaves the viewport alone', async () => {
    const { wrapper, canvas } = mountCanvas()

    pointer(canvas, 'pointerdown', { button: PRIMARY, clientX: 100, clientY: 100 })
    pointer(canvas, 'pointermove', { clientX: 160, clientY: 140 })
    pointer(canvas, 'pointerup', { clientX: 160, clientY: 140 })
    await nextTick()

    expect(wrapper.emitted('canvas-press')).toHaveLength(1)
    expect(wrapper.emitted('canvas-release')).toHaveLength(1)
    expect(lastViewport(wrapper)).toBeNull()
  })

  it('does not latch the pan on when a middle press overlaps a left press', async () => {
    const { wrapper, canvas } = mountCanvas()

    // One pointerId covers every mouse button, so the overlapping press used
    // to latch the pan on for good.
    pointer(canvas, 'pointerdown', { button: PRIMARY, clientX: 100, clientY: 100 })
    pointer(canvas, 'pointerdown', { button: MIDDLE, clientX: 100, clientY: 100 })
    pointer(canvas, 'pointerup', { clientX: 100, clientY: 100 })
    pointer(canvas, 'pointermove', { clientX: 300, clientY: 300 })
    await nextTick()

    expect(lastViewport(wrapper)).toBeNull()
  })

  it('holds cursor tracking for the length of a pan and resyncs on release', async () => {
    const { wrapper, canvas } = mountCanvas()

    pointer(canvas, 'pointermove', { clientX: 100, clientY: 100 })
    const beforePan = wrapper.emitted('cursor-move')?.length ?? 0

    pointer(canvas, 'pointerdown', { button: MIDDLE, clientX: 100, clientY: 100 })
    pointer(canvas, 'pointermove', { clientX: 120, clientY: 120 })
    pointer(canvas, 'pointermove', { clientX: 140, clientY: 140 })
    expect(wrapper.emitted('cursor-move')).toHaveLength(beforePan)

    pointer(canvas, 'pointerup', { clientX: 140, clientY: 140 })
    expect(wrapper.emitted('cursor-move')).toHaveLength(beforePan + 1)
  })

  it('pans on trackpad scrolling and zooms on a wheel notch', async () => {
    const { wrapper, canvas } = mountCanvas()

    wheel(canvas, 7)
    await nextTick()
    expect(lastCenter(wrapper)?.y).toBeGreaterThan(0)
    expect(lastViewport(wrapper)?.zoom).toBe(1)

    wheel(canvas, -MOUSE_WHEEL_NOTCH)
    await nextTick()
    expect(lastViewport(wrapper)?.zoom).toBeGreaterThan(1)
  })
})

describe('ViewportCanvas fitTo', () => {
  it('centres and fills the viewport with the rect it is given', async () => {
    const { wrapper, exposed } = mountCanvas()

    exposed.fitTo({ x: 1000, y: 500, width: 240, height: 120 })
    await nextTick()

    expect(lastCenter(wrapper)).toEqual({ x: 1120, y: 560 })
    expect(lastViewport(wrapper)?.zoom).toBeGreaterThan(1)
  })

  it('grows a degenerate rect around its centre instead of bailing out', async () => {
    const { wrapper, exposed } = mountCanvas()

    // A single device, or a perfectly horizontal wall, has no height.
    exposed.fitTo({ x: 240, y: 100, width: 120, height: 0 })
    await nextTick()

    expect(lastCenter(wrapper)).toEqual({ x: 300, y: 100 })
    expect(lastViewport(wrapper)?.zoom).toBeGreaterThan(1)
  })

  it('falls back to the default region for a plan with no content', async () => {
    const { wrapper, exposed } = mountCanvas()

    exposed.fitTo(null)
    await nextTick()

    expect(lastCenter(wrapper)).toEqual({ x: 180, y: 180 })
  })
})
