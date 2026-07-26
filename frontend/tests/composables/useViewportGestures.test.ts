import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { useViewport } from '@/composables/useViewport'
import type { UseViewportReturn } from '@/composables/useViewport'
import {
  classifyWheel,
  normalizeWheel,
  useViewportGestures,
} from '@/composables/useViewportGestures'
import type { ScrollMode, UseViewportGesturesReturn } from '@/composables/useViewportGestures'
import type { Point } from '@/types/plan'

interface WheelInit {
  deltaX?: number
  deltaY?: number
  deltaMode?: number
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

/** A WheelEvent built without a DOM, defaulting to a Chromium pixel-mode event. */
function wheelEvent(init: WheelInit): WheelEvent {
  return new WheelEvent('wheel', {
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
  })
}

/** A pointerdown/move/up stand-in; only the fields the gestures read matter. */
function pointerEvent(button: number, pointerId = 1): PointerEvent {
  return { button, pointerId } as PointerEvent
}

const MOUSE_WHEEL_NOTCH = 100
const TRACKPAD_SCROLL = 7

describe('normalizeWheel', () => {
  it('passes pixel-mode deltas through unchanged', () => {
    expect(normalizeWheel(wheelEvent({ deltaX: 3, deltaY: -12 }))).toEqual({ dx: 3, dy: -12 })
  })

  it('scales a line-mode notch up to pixel-mode magnitude', () => {
    const firefox = normalizeWheel(wheelEvent({ deltaY: 3, deltaMode: 1 }))
    expect(firefox.dy).toBeCloseTo(120)
  })
})

describe('classifyWheel', () => {
  it('zooms on a mouse-wheel notch in auto mode', () => {
    const action = classifyWheel(wheelEvent({ deltaY: -MOUSE_WHEEL_NOTCH }), 'auto')
    expect(action.kind).toBe('zoom')
    if (action.kind === 'zoom') expect(action.factor).toBeGreaterThan(1)
  })

  it('zooms a Firefox line-mode notch about as much as a Chromium pixel notch', () => {
    const firefox = classifyWheel(wheelEvent({ deltaY: -3, deltaMode: 1 }), 'auto')
    const chromium = classifyWheel(wheelEvent({ deltaY: -MOUSE_WHEEL_NOTCH }), 'auto')
    if (firefox.kind !== 'zoom' || chromium.kind !== 'zoom') throw new Error('expected zooms')
    expect(firefox.factor).toBeGreaterThan(1)
    expect(firefox.factor / chromium.factor).toBeGreaterThan(0.8)
    expect(firefox.factor / chromium.factor).toBeLessThan(1.25)
  })

  it('pans on fine-grained trackpad scrolling in auto mode', () => {
    const action = classifyWheel(wheelEvent({ deltaY: TRACKPAD_SCROLL }), 'auto')
    expect(action).toEqual({ kind: 'pan', dx: 0, dy: TRACKPAD_SCROLL })
  })

  it('pans on a horizontal trackpad swipe in auto mode', () => {
    const action = classifyWheel(wheelEvent({ deltaX: -TRACKPAD_SCROLL }), 'auto')
    expect(action).toEqual({ kind: 'pan', dx: -TRACKPAD_SCROLL, dy: 0 })
  })

  it('zooms on ctrl+wheel regardless of the mode', () => {
    for (const mode of ['auto', 'zoom', 'pan'] as const) {
      expect(classifyWheel(wheelEvent({ deltaY: -4, ctrlKey: true }), mode).kind).toBe('zoom')
    }
  })

  it('treats a trackpad pinch as finer than a wheel notch of the same delta', () => {
    const pinch = classifyWheel(wheelEvent({ deltaY: -10, ctrlKey: true }), 'auto')
    const notch = classifyWheel(wheelEvent({ deltaY: -MOUSE_WHEEL_NOTCH }), 'auto')
    if (pinch.kind !== 'zoom' || notch.kind !== 'zoom') throw new Error('expected zooms')
    expect(pinch.factor).toBeLessThan(notch.factor)
  })

  it('turns a zooming wheel into a horizontal pan with shift', () => {
    const action = classifyWheel(wheelEvent({ deltaY: MOUSE_WHEEL_NOTCH, shiftKey: true }), 'auto')
    expect(action).toEqual({ kind: 'pan', dx: MOUSE_WHEEL_NOTCH, dy: 0 })
  })

  it('honours the pan mode override on a mouse wheel', () => {
    const action = classifyWheel(wheelEvent({ deltaY: MOUSE_WHEEL_NOTCH }), 'pan')
    expect(action).toEqual({ kind: 'pan', dx: 0, dy: MOUSE_WHEEL_NOTCH })
  })

  it('honours the zoom mode override on trackpad scrolling', () => {
    expect(classifyWheel(wheelEvent({ deltaY: TRACKPAD_SCROLL }), 'zoom').kind).toBe('zoom')
  })
})

interface Harness {
  viewport: UseViewportReturn
  gestures: UseViewportGesturesReturn
}

let mounted: VueWrapper | null = null

/**
 * Mounts the gestures against a real viewport inside a throwaway component,
 * so the window key listeners registered in `onMounted` are live and are torn
 * down again after each test.
 */
function makeHarness(mode: ScrollMode = 'auto'): Harness {
  let harness: Harness | null = null
  mounted = mount(
    defineComponent({
      setup() {
        const viewport = useViewport()
        viewport.viewportSize.value = { width: 800, height: 600 }
        viewport.setViewport({ center: { x: 0, y: 0 }, zoom: 1 })
        harness = { viewport, gestures: useViewportGestures(viewport, ref<ScrollMode>(mode)) }
        return () => h('div')
      },
    }),
  )
  if (!harness) throw new Error('the harness component did not run its setup')
  return harness
}

/** Dispatches a bubbling Space keydown; returns true when a handler cancelled it. */
function pressSpace(target: EventTarget = window.document.body): boolean {
  return !target.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }),
  )
}

function releaseSpace(): void {
  window.document.body.dispatchEvent(
    new KeyboardEvent('keyup', { code: 'Space', bubbles: true, cancelable: true }),
  )
}

const PRIMARY = 0
const MIDDLE = 1
const ORIGIN: Point = { x: 100, y: 100 }

afterEach(() => {
  mounted?.unmount()
  mounted = null
  window.document.body.innerHTML = ''
})

describe('useViewportGestures', () => {
  it('pans the viewport on a middle-button drag', () => {
    const { viewport, gestures } = makeHarness()

    expect(gestures.pointerDown(pointerEvent(MIDDLE), ORIGIN)).toBe('pan')
    gestures.pointerMove(pointerEvent(MIDDLE), { x: 140, y: 130 })

    const scale = viewport.scale.value
    expect(viewport.center.value.x).toBeCloseTo(-40 / scale, 10)
    expect(viewport.center.value.y).toBeCloseTo(-30 / scale, 10)
    expect(gestures.panning.value).toBe(true)
  })

  it('reports a plain left press for the host to forward, without panning', () => {
    const { viewport, gestures } = makeHarness()

    expect(gestures.pointerDown(pointerEvent(PRIMARY), ORIGIN)).toBe('press')
    gestures.pointerMove(pointerEvent(PRIMARY), { x: 300, y: 300 })

    expect(gestures.panning.value).toBe(false)
    expect(viewport.center.value).toEqual({ x: 0, y: 0 })
    expect(gestures.pointerUp(pointerEvent(PRIMARY))).toBe('press')
  })

  it('ignores a second button pressed during a live gesture', () => {
    const { gestures } = makeHarness()
    gestures.pointerDown(pointerEvent(PRIMARY), ORIGIN)

    // A mouse shares one pointerId across buttons, so this used to start a pan
    // that the matching pointerup could never clear.
    expect(gestures.pointerDown(pointerEvent(MIDDLE), ORIGIN)).toBe('ignored')
    expect(gestures.pointerUp(pointerEvent(PRIMARY))).toBe('press')
    expect(gestures.panning.value).toBe(false)
  })

  it('ends a pan on the pointerup that shares its id', () => {
    const { gestures } = makeHarness()
    gestures.pointerDown(pointerEvent(MIDDLE), ORIGIN)

    expect(gestures.pointerUp(pointerEvent(MIDDLE))).toBe('pan')
    expect(gestures.panning.value).toBe(false)
  })

  it('ignores moves from a pointer that is not the panning one', () => {
    const { viewport, gestures } = makeHarness()
    gestures.pointerDown(pointerEvent(MIDDLE, 1), ORIGIN)

    expect(gestures.pointerMove(pointerEvent(MIDDLE, 2), { x: 400, y: 400 })).toBe('ignored')
    expect(viewport.center.value).toEqual({ x: 0, y: 0 })
  })

  it('drops a live pan when the gesture is cancelled', () => {
    const { gestures } = makeHarness()
    gestures.pointerDown(pointerEvent(MIDDLE), ORIGIN)

    gestures.cancel()

    expect(gestures.panning.value).toBe(false)
  })

  it('zooms towards the cursor on a wheel notch', () => {
    const { viewport, gestures } = makeHarness()
    const cursor: Point = { x: 200, y: 150 }
    const anchored = viewport.screenToWorld(cursor)

    gestures.wheel(wheelEvent({ deltaY: -MOUSE_WHEEL_NOTCH }), cursor)

    expect(viewport.zoom.value).toBeGreaterThan(1)
    const after = viewport.screenToWorld(cursor)
    expect(after.x).toBeCloseTo(anchored.x, 10)
    expect(after.y).toBeCloseTo(anchored.y, 10)
  })

  it('moves the camera with the scroll direction on a trackpad pan', () => {
    const { viewport, gestures } = makeHarness()

    gestures.wheel(wheelEvent({ deltaX: 20, deltaY: 30 }), ORIGIN)

    // Scrolling down and right reveals content further down and right.
    expect(viewport.center.value.x).toBeGreaterThan(0)
    expect(viewport.center.value.y).toBeGreaterThan(0)
  })

  it('leaves the zoom untouched while scroll-panning', () => {
    const { viewport, gestures } = makeHarness('pan')

    gestures.wheel(wheelEvent({ deltaY: MOUSE_WHEEL_NOTCH }), ORIGIN)

    expect(viewport.zoom.value).toBe(1)
  })

  it('drops the space modifier when the pointer leaves the canvas', () => {
    const { gestures } = makeHarness()
    gestures.setPointerInside(true)
    pressSpace()

    gestures.setPointerInside(false)

    expect(gestures.spaceHeld.value).toBe(false)
    expect(gestures.cursorClass.value).toBe('cursor-default')
  })
})

describe('useViewportGestures space modifier', () => {
  it('turns a left drag into a pan while space is held', () => {
    const { viewport, gestures } = makeHarness()
    gestures.setPointerInside(true)
    pressSpace()

    expect(gestures.spaceHeld.value).toBe(true)
    expect(gestures.cursorClass.value).toBe('cursor-grab')
    expect(gestures.pointerDown(pointerEvent(PRIMARY), ORIGIN)).toBe('pan')
    gestures.pointerMove(pointerEvent(PRIMARY), { x: 150, y: 100 })
    expect(viewport.center.value.x).toBeLessThan(0)
  })

  it('arms the pan even while a toolbar button holds focus', () => {
    const { gestures } = makeHarness()
    gestures.setPointerInside(true)
    const button = window.document.createElement('button')
    window.document.body.appendChild(button)
    button.focus()

    const cancelled = pressSpace(button)

    expect(gestures.spaceHeld.value).toBe(true)
    // Cancelling the keydown is what stops Space from re-activating the button.
    expect(cancelled).toBe(true)
  })

  it('leaves space alone when the pointer is not over the canvas', () => {
    const { gestures } = makeHarness()

    const cancelled = pressSpace()

    expect(gestures.spaceHeld.value).toBe(false)
    expect(cancelled).toBe(false)
  })

  it('leaves space alone while typing in a field', () => {
    const { gestures } = makeHarness()
    gestures.setPointerInside(true)
    const input = window.document.createElement('input')
    window.document.body.appendChild(input)

    expect(pressSpace(input)).toBe(false)
    expect(gestures.spaceHeld.value).toBe(false)
  })

  it('releases the modifier on keyup', () => {
    const { gestures } = makeHarness()
    gestures.setPointerInside(true)
    pressSpace()

    releaseSpace()

    expect(gestures.spaceHeld.value).toBe(false)
    expect(gestures.pointerDown(pointerEvent(PRIMARY), ORIGIN)).toBe('press')
  })

  it('releases the modifier and any live pan when the window loses focus', () => {
    const { gestures } = makeHarness()
    gestures.setPointerInside(true)
    pressSpace()
    gestures.pointerDown(pointerEvent(PRIMARY), ORIGIN)

    window.dispatchEvent(new Event('blur'))

    expect(gestures.spaceHeld.value).toBe(false)
    expect(gestures.panning.value).toBe(false)
  })
})
