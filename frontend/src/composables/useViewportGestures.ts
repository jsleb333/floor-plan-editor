import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Point } from '@/types/plan'

import { isTypingTarget } from './useToolShortcuts'
import type { UseViewportReturn } from './useViewport'

/** Zoom factor per pixel of wheel delta for a discrete mouse wheel notch. */
const WHEEL_ZOOM_SENSITIVITY = 0.0015
/** Zoom factor per pixel of delta for a trackpad pinch (much finer events). */
const PINCH_ZOOM_SENSITIVITY = 0.01
/**
 * Screen pixels per line, for `deltaMode === DOM_DELTA_LINE` (Firefox wheels).
 * Not a text line height: 40 puts Firefox's 3-line notch at 120px, matching
 * the 100-120px Chromium reports for the same physical detent.
 */
const LINE_HEIGHT_PX = 40
/** Screen pixels per page, for `deltaMode === DOM_DELTA_PAGE`. */
const PAGE_HEIGHT_PX = 800
/** Pixel deltas a discrete mouse-wheel notch is a whole multiple of. */
const WHEEL_NOTCH_PX = [100, 120]
/** Below this, a pixel-mode delta is too fine to have come from a wheel notch. */
const MIN_WHEEL_NOTCH_PX = 100

const PRIMARY_BUTTON = 0
const MIDDLE_BUTTON = 1

/**
 * How a plain (unmodified) scroll gesture is interpreted.
 *
 * `auto` routes discrete mouse-wheel notches to zoom and continuous trackpad
 * scrolling to pan; `zoom` and `pan` pin the behaviour for users whose
 * hardware the heuristic guesses wrong.
 */
export type ScrollMode = 'auto' | 'zoom' | 'pan'

export const SCROLL_MODES: readonly ScrollMode[] = ['auto', 'zoom', 'pan']

/** What a wheel event resolves to once the scroll mode and modifiers are applied. */
export type WheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }

/** The one pointer gesture that can be live at a time. */
export type PointerGesture =
  | { kind: 'idle' }
  | { kind: 'press'; pointerId: number }
  | { kind: 'pan'; pointerId: number; last: Point }

/** What the host should do with a pointer event the gestures did not consume. */
export type PointerOutcome = 'pan' | 'press' | 'ignored'

/** A wheel delta converted to screen pixels on both axes. */
export interface NormalizedWheel {
  dx: number
  dy: number
}

/**
 * Converts a wheel event's delta to screen pixels.
 *
 * Firefox reports line- or page-mode deltas (±3 per notch) where Chromium
 * reports pixels (±100), so raw `deltaY` is ~30x smaller on the same hardware
 * and must be normalised before it drives zoom or pan.
 */
export function normalizeWheel(event: WheelEvent): NormalizedWheel {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_HEIGHT_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? PAGE_HEIGHT_PX
        : 1
  return { dx: event.deltaX * unit, dy: event.deltaY * unit }
}

/**
 * Heuristic: did this wheel event come from a discrete mouse wheel rather
 * than a trackpad?
 *
 * Wheels emit one coarse, quantised notch at a time — line/page mode, or a
 * whole multiple of 100/120 pixels on one axis. Trackpads emit a fine-grained
 * stream with fractional deltas and a live horizontal axis. No signal is
 * exact, which is why `ScrollMode` lets the user override the guess.
 */
export function isMouseWheel(event: WheelEvent, wheel: NormalizedWheel): boolean {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return true
  const dominant = Math.abs(wheel.dy) >= Math.abs(wheel.dx) ? wheel.dy : wheel.dx
  if (!Number.isInteger(dominant)) return false
  const magnitude = Math.abs(dominant)
  if (magnitude < MIN_WHEEL_NOTCH_PX) return false
  return WHEEL_NOTCH_PX.some((notch) => magnitude % notch === 0)
}

function zoomAction(deltaY: number, sensitivity: number): WheelAction {
  return { kind: 'zoom', factor: Math.exp(-deltaY * sensitivity) }
}

/**
 * Resolves a wheel event into a zoom or a pan (spec E5).
 *
 * Ctrl/Cmd — the trackpad pinch gesture, and the universal zoom modifier —
 * always zooms. Otherwise `mode` decides, with Shift turning a zooming wheel
 * into a horizontal pan.
 *
 * @param event The raw wheel event; its modifier keys and `deltaMode` matter.
 * @param mode The user's scroll-gesture preference.
 *
 * @returns A zoom factor to apply at the cursor, or a screen-pixel pan delta.
 */
export function classifyWheel(event: WheelEvent, mode: ScrollMode): WheelAction {
  const wheel = normalizeWheel(event)
  const fromWheel = isMouseWheel(event, wheel)
  const sensitivity = fromWheel ? WHEEL_ZOOM_SENSITIVITY : PINCH_ZOOM_SENSITIVITY
  if (event.ctrlKey || event.metaKey) return zoomAction(wheel.dy, sensitivity)
  const zooms = mode === 'zoom' || (mode === 'auto' && fromWheel)
  if (!zooms) return { kind: 'pan', dx: wheel.dx, dy: wheel.dy }
  if (event.shiftKey) return { kind: 'pan', dx: wheel.dy !== 0 ? wheel.dy : wheel.dx, dy: 0 }
  return zoomAction(wheel.dy, sensitivity)
}

export interface UseViewportGesturesReturn {
  /** True while a pan drag is in flight. */
  panning: ComputedRef<boolean>
  /** True while Space arms the pan modifier (pointer over the canvas only). */
  spaceHeld: ComputedRef<boolean>
  /** Tailwind cursor class matching the current gesture state. */
  cursorClass: ComputedRef<string>
  /** Records a pointer press; returns what the host should emit, if anything. */
  pointerDown: (event: PointerEvent, screen: Point) => PointerOutcome
  /** Pans when the event continues a pan drag; returns whether it was consumed. */
  pointerMove: (event: PointerEvent, screen: Point) => PointerOutcome
  /** Ends the live gesture; returns which one ended. */
  pointerUp: (event: PointerEvent) => PointerOutcome
  /** Applies a wheel event as a zoom or pan. */
  wheel: (event: WheelEvent, screen: Point) => void
  /** Called when the pointer enters or leaves the canvas. */
  setPointerInside: (inside: boolean) => void
  /** Drops any live pan (lost capture, window blur, tab hidden). */
  cancel: () => void
}

/**
 * Pointer and wheel gestures for the editor viewport (spec E5): space-drag,
 * middle-drag, trackpad scroll, wheel zoom and pinch zoom.
 *
 * A single `PointerGesture` union holds the live gesture, so a press and a pan
 * can never be active at once — with a mouse every button shares one
 * `pointerId`, and overlapping gestures used to leave the pan latched on.
 * Panning suppresses cursor tracking so tool previews and snapping do not
 * recompute against a world point that only moves because the camera does.
 *
 * @param viewport The viewport whose centre and zoom the gestures drive.
 * @param scrollMode How to interpret an unmodified scroll (see `ScrollMode`).
 */
export function useViewportGestures(
  viewport: UseViewportReturn,
  scrollMode: Ref<ScrollMode>,
): UseViewportGesturesReturn {
  const gesture = ref<PointerGesture>({ kind: 'idle' })
  const spaceDown = ref(false)
  const pointerInside = ref(false)

  const panning = computed(() => gesture.value.kind === 'pan')
  const spaceHeld = computed(() => spaceDown.value)

  const cursorClass = computed(() => {
    if (panning.value) return 'cursor-grabbing'
    if (spaceDown.value) return 'cursor-grab'
    return 'cursor-default'
  })

  function pointerDown(event: PointerEvent, screen: Point): PointerOutcome {
    if (gesture.value.kind !== 'idle') return 'ignored'
    const isPanGesture =
      event.button === MIDDLE_BUTTON || (event.button === PRIMARY_BUTTON && spaceDown.value)
    if (isPanGesture) {
      gesture.value = { kind: 'pan', pointerId: event.pointerId, last: { ...screen } }
      return 'pan'
    }
    if (event.button !== PRIMARY_BUTTON) return 'ignored'
    gesture.value = { kind: 'press', pointerId: event.pointerId }
    return 'press'
  }

  function pointerMove(event: PointerEvent, screen: Point): PointerOutcome {
    const live = gesture.value
    if (live.kind !== 'pan' || live.pointerId !== event.pointerId) return 'ignored'
    viewport.panByScreen(screen.x - live.last.x, screen.y - live.last.y)
    gesture.value = { kind: 'pan', pointerId: live.pointerId, last: { ...screen } }
    return 'pan'
  }

  function pointerUp(event: PointerEvent): PointerOutcome {
    const live = gesture.value
    if (live.kind === 'idle' || live.pointerId !== event.pointerId) return 'ignored'
    gesture.value = { kind: 'idle' }
    return live.kind
  }

  function wheel(event: WheelEvent, screen: Point): void {
    const action = classifyWheel(event, scrollMode.value)
    if (action.kind === 'zoom') {
      viewport.zoomAtPoint(action.factor, screen)
      return
    }
    // Scrolling down reveals content further down, i.e. the camera moves the
    // opposite way to a drag of the same delta.
    viewport.panByScreen(-action.dx, -action.dy)
  }

  function setPointerInside(inside: boolean): void {
    pointerInside.value = inside
    if (!inside && !panning.value) spaceDown.value = false
  }

  function cancel(): void {
    if (gesture.value.kind === 'pan') gesture.value = { kind: 'idle' }
  }

  function release(): void {
    spaceDown.value = false
    cancel()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat) return
    // Space is only the pan modifier while the pointer is over the canvas, so
    // it still activates a focused button everywhere else.
    if (!pointerInside.value || isTypingTarget(event.target)) return
    spaceDown.value = true
    // Suppresses page scroll and, crucially, activating whichever button still
    // holds focus after the user picked a tool from the rail.
    event.preventDefault()
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') spaceDown.value = false
  }

  function onVisibilityChange(): void {
    if (document.hidden) release()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', release)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    panning,
    spaceHeld,
    cursorClass,
    pointerDown,
    pointerMove,
    pointerUp,
    wheel,
    setPointerInside,
    cancel,
  }
}
