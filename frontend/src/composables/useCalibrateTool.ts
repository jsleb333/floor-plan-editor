import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Point, Underlay } from '@/types/plan'
import { EPSILON, distance } from '@/utils/geometry'
import { calibrationScale, scaledAboutAnchor } from '@/utils/underlay'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

import { isBufferKey } from './useWallTool'

/** Everything the overlay needs to visualize the calibration segment (spec E6). */
export interface CalibrateToolPreview {
  /** First committed endpoint of the reference segment. */
  a: Point | null
  /** Second endpoint: committed by the second click, else the live cursor. */
  b: Point | null
  /** True once both endpoints are placed and the tool waits for the typed length. */
  awaitingLength: boolean
  /** Formatted current world length of the segment, for the on-canvas label. */
  lengthLabel: string | null
  /** Non-blocking guidance when calibration cannot proceed usefully (spec U3). */
  warning: string | null
}

export interface UseCalibrateToolOptions {
  /** The document's underlay, reactive to every mutation. */
  underlay: Ref<Underlay | null>
  /** Receives the recalibrated underlay; the caller dispatches ONE setUnderlay command. */
  commit: (underlay: Underlay) => void
  /** Called after a successful calibration so the page can return to Select (spec U2). */
  onApplied: () => void
}

export interface UseCalibrateToolReturn {
  preview: ComputedRef<CalibrateToolPreview>
  /** Typed known-length buffer, echoed in the status bar (spec S2 pattern). */
  inputBuffer: Ref<string>
  /** True while the tool waits for the typed length (used to suppress tool shortcuts). */
  isAwaitingLength: ComputedRef<boolean>
  setCursor: (point: Point | null) => void
  onClick: (world: Point) => void
  /** Routes a key press to the tool; returns true when consumed. */
  handleKey: (key: string) => boolean
  /** Cancels the pending segment and buffer (on tool switch). */
  deactivate: () => void
}

/**
 * Underlay calibration tool (spec U2): two clicks in world space mark the ends
 * of a known distance on the image, then the user types its real length
 * (feet-inches) and presses Enter. The underlay is rescaled ABOUT THE FIRST
 * ENDPOINT — the image point under it stays fixed — so traced geometry aligns
 * instead of jumping. Esc cancels; Enter hands control back via `onApplied`.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useCalibrateTool(options: UseCalibrateToolOptions): UseCalibrateToolReturn {
  const { underlay, commit, onApplied } = options

  const first: ShallowRef<Point | null> = shallowRef(null)
  const second: ShallowRef<Point | null> = shallowRef(null)
  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const inputBuffer = ref('')

  const isAwaitingLength = computed(() => second.value !== null)

  const preview = computed<CalibrateToolPreview>(() => {
    const a = first.value
    const b = second.value ?? (a ? cursor.value : null)
    let warning: string | null = null
    if (!underlay.value) {
      warning = 'No underlay to calibrate — import an image in the Layers tab first.'
    } else if (!underlay.value.visible) {
      warning = 'The underlay is hidden — show it in the Layers tab to aim the segment.'
    }
    return {
      a,
      b,
      awaitingLength: isAwaitingLength.value,
      lengthLabel: a && b && distance(a, b) > EPSILON ? formatFeetInches(distance(a, b)) : null,
      warning,
    }
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function reset(): void {
    first.value = null
    second.value = null
    inputBuffer.value = ''
  }

  function onClick(world: Point): void {
    if (!underlay.value) return
    if (!first.value) {
      first.value = { ...world }
      return
    }
    if (!second.value) {
      if (distance(first.value, world) <= EPSILON) return
      second.value = { ...world }
    }
  }

  function apply(): void {
    const current = underlay.value
    const a = first.value
    const b = second.value
    if (!current || !a || !b) return
    const typedIn = parseFeetInches(inputBuffer.value)
    inputBuffer.value = ''
    if (typedIn === null || typedIn <= 0) return
    const segmentLengthIn = distance(a, b)
    if (segmentLengthIn <= EPSILON) return
    const newScale = calibrationScale(segmentLengthIn, current.transform.scale, typedIn)
    commit({ ...current, transform: scaledAboutAnchor(current.transform, a, newScale) })
    reset()
    onApplied()
  }

  function handleKey(key: string): boolean {
    if (key === 'Escape') {
      if (!first.value) return false
      reset()
      return true
    }
    if (!isAwaitingLength.value) return false
    if (key === 'Enter') {
      if (inputBuffer.value === '') return false
      apply()
      return true
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    if (isBufferKey(key)) {
      if (key === ' ' && inputBuffer.value === '') return false
      inputBuffer.value += key
      return true
    }
    return false
  }

  function deactivate(): void {
    reset()
    cursor.value = null
  }

  return { preview, inputBuffer, isAwaitingLength, setCursor, onClick, handleKey, deactivate }
}
