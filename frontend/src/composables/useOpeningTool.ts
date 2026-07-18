import { computed, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Opening, Point, Wall } from '@/types/plan'
import { clampOpeningT, projectOntoWalls, wallSegmentSpan } from '@/utils/geometry'

/** Default opening width for doors and windows (specs S4/S5). */
export const DEFAULT_OPENING_WIDTH_IN = 32
/** Capture radius (screen px) for hovering a host wall. */
const PLACEMENT_RADIUS_PX = 16
/** Placeholder id of the preview opening (never committed). */
const PREVIEW_ID = 'opening-preview'

export interface UseOpeningToolOptions {
  /** Kind of opening the tool places; follows the active tool (door/window). */
  kind: Ref<'door' | 'window'>
  /** Existing walls to host openings. */
  walls: Ref<readonly Wall[]>
  /** Current screen pixels per world inch, to convert the capture radius. */
  pixelsPerInch: Ref<number>
  /** Receives each placed opening; the caller dispatches the store command. */
  commit: (opening: Opening) => void
}

export interface UseOpeningToolReturn {
  /** The opening the next click would place, derived from the hovered wall. */
  preview: ComputedRef<Opening | null>
  setCursor: (point: Point | null) => void
  onClick: (world: Point) => void
  /** Clears the hover state (on tool switch). */
  deactivate: () => void
}

/**
 * Door/window placement tool (specs S4/S5): hovering projects the cursor onto
 * the nearest wall reference line and previews the opening centred at that
 * attachment; clicking commits it with the parametric host address (§4.2).
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useOpeningTool(options: UseOpeningToolOptions): UseOpeningToolReturn {
  const { kind, walls, pixelsPerInch, commit } = options

  const cursor: ShallowRef<Point | null> = shallowRef(null)

  function thresholdIn(): number {
    return PLACEMENT_RADIUS_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
  }

  function openingAt(world: Point): Opening | null {
    const placement = projectOntoWalls(world, walls.value, thresholdIn())
    if (!placement) return null
    const wall = walls.value.find((candidate) => candidate.id === placement.wallId)
    if (!wall) return null
    const span = wallSegmentSpan(wall, placement.segmentIndex)
    if (!span || span.lengthIn <= 0) return null
    return {
      id: PREVIEW_ID,
      kind: kind.value,
      wall_id: placement.wallId,
      segment_index: placement.segmentIndex,
      t: clampOpeningT(placement.tIn, DEFAULT_OPENING_WIDTH_IN, span.lengthIn),
      width_in: DEFAULT_OPENING_WIDTH_IN,
      hinge: 'left',
      swing: 'in',
    }
  }

  const preview = computed<Opening | null>(() => (cursor.value ? openingAt(cursor.value) : null))

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function onClick(world: Point): void {
    const opening = openingAt(world)
    if (!opening) return
    commit({ ...opening, id: crypto.randomUUID() })
  }

  function deactivate(): void {
    cursor.value = null
  }

  return { preview, setCursor, onClick, deactivate }
}
