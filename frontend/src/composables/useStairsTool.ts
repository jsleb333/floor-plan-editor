import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, ShallowRef } from 'vue'

import type { Point, Stairs } from '@/types/plan'
import { angleOf, dot, sub } from '@/utils/geometry'

import { GRID_STEP_IN } from './useSnapping'
import type { UseSnappingReturn } from './useSnapping'

/** Default stair run width (spec S6), editable in the Inspector afterwards. */
export const DEFAULT_STAIRS_WIDTH_IN = 36
/** Drags shorter than this commit nothing (an accidental click, not a run). */
const MIN_STAIRS_LENGTH_IN = 12
/** Placeholder id of the preview run (never committed). */
const PREVIEW_ID = 'stairs-preview'

const RAD_TO_DEG = 180 / Math.PI

export interface UseStairsToolOptions {
  /** Shared snap engine; provides the snap settings and point resolution. */
  snapping: UseSnappingReturn
  /** Receives each finished stair run; the caller dispatches the store command. */
  commit: (stairs: Stairs) => void
}

export interface UseStairsToolReturn {
  /** The pending run while dragging, for the layer preview. */
  preview: ComputedRef<Stairs | null>
  isDrawing: ComputedRef<boolean>
  setCursor: (point: Point | null) => void
  setAlt: (held: boolean) => void
  onPress: (world: Point) => void
  onRelease: (world: Point) => void
  /** Routes a key press to the tool; Escape cancels the pending drag (spec E4). */
  handleKey: (key: string) => boolean
  /** Cancels the pending drag and clears modifier state (on tool switch). */
  deactivate: () => void
}

/**
 * Stairs drawing tool (spec S6): press to set the origin corner, drag to set
 * the run direction (angle-snapped) and length, release to commit a run with
 * the default 36" width, pointing 'up'.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useStairsTool(options: UseStairsToolOptions): UseStairsToolReturn {
  const { snapping, commit } = options

  const origin: ShallowRef<Point | null> = shallowRef(null)
  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const altHeld = ref(false)

  const isDrawing = computed(() => origin.value !== null)

  function pendingRun(world: Point): Stairs | null {
    const from = origin.value
    if (!from) return null
    const direction = snapping.direction(from, world, altHeld.value)
    if (direction.x === 0 && direction.y === 0) return null
    let lengthIn = Math.max(dot(sub(world, from), direction), 0)
    if (snapping.settings.grid.value) {
      lengthIn = Math.round(lengthIn / GRID_STEP_IN) * GRID_STEP_IN
    }
    if (lengthIn <= 0) return null
    return {
      id: PREVIEW_ID,
      origin: { ...from },
      width_in: DEFAULT_STAIRS_WIDTH_IN,
      length_in: lengthIn,
      rotation_deg: angleOf(direction) * RAD_TO_DEG,
      direction: 'up',
    }
  }

  const preview = computed<Stairs | null>(() => (cursor.value ? pendingRun(cursor.value) : null))

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function setAlt(held: boolean): void {
    altHeld.value = held
  }

  function onPress(world: Point): void {
    origin.value = { ...snapping.resolve(world, null, altHeld.value).point }
  }

  function onRelease(world: Point): void {
    const run = pendingRun(world)
    origin.value = null
    if (!run || run.length_in < MIN_STAIRS_LENGTH_IN) return
    commit({ ...run, id: crypto.randomUUID() })
  }

  function handleKey(key: string): boolean {
    if (key === 'Alt') {
      altHeld.value = true
      return isDrawing.value
    }
    if (key === 'Escape' && origin.value) {
      origin.value = null
      return true
    }
    return false
  }

  function deactivate(): void {
    origin.value = null
    cursor.value = null
    altHeld.value = false
  }

  return { preview, isDrawing, setCursor, setAlt, onPress, onRelease, handleKey, deactivate }
}
