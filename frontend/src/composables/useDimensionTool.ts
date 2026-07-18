import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, ShallowRef } from 'vue'

import type { Dimension, Point } from '@/types/plan'
import { EPSILON, distance } from '@/utils/geometry'

import type { SnapMarkerKind, UseSnappingReturn } from './useSnapping'

/** Default side offset of a freshly placed dimension line (spec S8). */
export const DEFAULT_DIMENSION_OFFSET_IN = 12
/** Placeholder id of the preview dimension (never committed). */
const PREVIEW_ID = 'dimension-preview'

/** Everything the layer needs to visualize the pending dimension (spec E6). */
export interface DimensionToolPreview {
  /** The pending annotation once the first point is placed. */
  dimension: Dimension | null
  /** First committed anchor, shown as soon as it is placed. */
  start: Point | null
  /** Snapped cursor point (the anchor the next click would place). */
  point: Point | null
  marker: { kind: SnapMarkerKind; point: Point } | null
}

export interface UseDimensionToolOptions {
  /** Shared snap engine (endpoints / midpoints / projections / grid, spec S8). */
  snapping: UseSnappingReturn
  /** Receives each finished dimension; the caller dispatches the store command. */
  commit: (dimension: Dimension) => void
}

export interface UseDimensionToolReturn {
  preview: ComputedRef<DimensionToolPreview | null>
  isDrawing: ComputedRef<boolean>
  setCursor: (point: Point | null) => void
  setAlt: (held: boolean) => void
  onClick: (world: Point) => void
  /** Routes a key press to the tool; Escape cancels the pending first point (spec E4). */
  handleKey: (key: string) => boolean
  /** Cancels the pending state and clears modifier state (on tool switch). */
  deactivate: () => void
}

/**
 * Dimension annotation tool (spec S8): two snapped clicks define the measured
 * points `p1`/`p2`; a preview line follows the cursor in between; the commit
 * takes the default side offset, adjustable afterwards by dragging or in the
 * Inspector.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useDimensionTool(options: UseDimensionToolOptions): UseDimensionToolReturn {
  const { snapping, commit } = options

  const first: ShallowRef<Point | null> = shallowRef(null)
  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const altHeld = ref(false)

  const isDrawing = computed(() => first.value !== null)

  const preview = computed<DimensionToolPreview | null>(() => {
    const start = first.value
    if (!cursor.value && !start) return null
    const snap = cursor.value ? snapping.resolve(cursor.value, null, altHeld.value) : null
    const point = snap?.point ?? null
    const dimension: Dimension | null =
      start && point && distance(start, point) > EPSILON
        ? {
            id: PREVIEW_ID,
            p1: start,
            p2: point,
            offset_in: DEFAULT_DIMENSION_OFFSET_IN,
          }
        : null
    return {
      dimension,
      start,
      point,
      marker: snap?.marker && point ? { kind: snap.marker, point } : null,
    }
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function setAlt(held: boolean): void {
    altHeld.value = held
  }

  function onClick(world: Point): void {
    const snapped = snapping.resolve(world, null, altHeld.value).point
    if (!first.value) {
      first.value = { ...snapped }
      return
    }
    if (distance(first.value, snapped) <= EPSILON) return
    commit({
      id: crypto.randomUUID(),
      p1: { ...first.value },
      p2: { ...snapped },
      offset_in: DEFAULT_DIMENSION_OFFSET_IN,
    })
    first.value = null
  }

  function handleKey(key: string): boolean {
    if (key === 'Alt') {
      altHeld.value = true
      return isDrawing.value
    }
    if (key === 'Escape' && first.value) {
      first.value = null
      return true
    }
    return false
  }

  function deactivate(): void {
    first.value = null
    cursor.value = null
    altHeld.value = false
  }

  return { preview, isDrawing, setCursor, setAlt, onClick, handleKey, deactivate }
}
