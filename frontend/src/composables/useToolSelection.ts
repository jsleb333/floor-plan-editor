import type { Ref } from 'vue'

import type { ToolId } from '@/components/editor/tools'
import type { ElementKind, ElementRef, SelectionMode } from '@/stores/editor'
import type { Device, Dimension, Label, Opening, Point, Stairs, Wall } from '@/types/plan'
import {
  deviceAtPoint,
  dimensionAtPoint,
  labelAtPoint,
  openingAtPoint,
  stairsAtPoint,
} from '@/utils/hitTest'

/** Capture radius (screen px) for clicking a dimension figure (matches the select tool). */
const DIMENSION_HIT_PX = 6

/** What the editor store must provide; satisfied by `useEditorStore()`. */
export interface ToolSelectionStore {
  readonly selection: ReadonlyMap<string, ElementRef>
  select(refs: readonly ElementRef[], mode?: SelectionMode): void
  clearSelection(): void
}

export interface UseToolSelectionOptions {
  store: ToolSelectionStore
  /** Current walls of the document (host lookup for openings and devices). */
  walls: Ref<readonly Wall[]>
  /** Current openings of the document (reactive to every mutation). */
  openings: Ref<readonly Opening[]>
  /** Current stair runs of the document (reactive to every mutation). */
  stairs: Ref<readonly Stairs[]>
  /** Current labels of the document (reactive to every mutation). */
  labels: Ref<readonly Label[]>
  /** Current dimension annotations of the document (reactive to every mutation). */
  dimensions: Ref<readonly Dimension[]>
  /** Current electrical devices of the document (reactive to every mutation). */
  devices: Ref<readonly Device[]>
  /** Current screen pixels per world inch, for pixel-based hit tolerances. */
  pixelsPerInch: Ref<number>
}

export interface UseToolSelectionReturn {
  /**
   * Wraps a placement commit so the committed element becomes the current
   * selection (spec E8 place-then-tweak); the tool itself stays armed.
   */
  placeThenTweak: <T extends { id: string }>(
    kind: ElementKind,
    commit: (element: T) => void,
  ) => (element: T) => void
  /**
   * Selects the existing element of the tool's own kind under `world` instead
   * of placing a new one (spec E8 edit-in-tool); returns true when the click
   * was consumed. The wall tool always returns false: clicks on walls keep
   * their drawing semantics (spec S3a).
   */
  trySelectForEdit: (tool: ToolId, world: Point) => boolean
  /**
   * Clears the selection on the first Esc while a tool is armed, returning to
   * pure placement (spec E8); true when consumed.
   */
  clearOnEscape: () => boolean
}

/**
 * Selection behaviour shared by every placement tool (spec E8): a committed
 * element becomes the current selection so its inspector opens immediately
 * (place-then-tweak); a click on an existing element of the tool's own kind
 * selects it for editing instead of placing a new one (edit-in-tool, the wall
 * tool excepted); and the first Esc clears that selection back to pure
 * placement.
 *
 * Headless by design: all inputs are injected, so the behaviour is testable
 * without a DOM.
 */
export function useToolSelection(options: UseToolSelectionOptions): UseToolSelectionReturn {
  const { store, walls, openings, stairs, labels, dimensions, devices, pixelsPerInch } = options

  function placeThenTweak<T extends { id: string }>(
    kind: ElementKind,
    commit: (element: T) => void,
  ): (element: T) => void {
    return (element) => {
      commit(element)
      store.select([{ kind, id: element.id }])
    }
  }

  /** The existing element of `tool`'s own kind under `world`, else null. */
  function editHitFor(tool: ToolId, world: Point): ElementRef | null {
    switch (tool) {
      case 'door':
      case 'window': {
        const opening = openingAtPoint(world, openings.value, walls.value)
        return opening?.kind === tool ? { kind: 'opening', id: opening.id } : null
      }
      case 'stairs': {
        const run = stairsAtPoint(world, stairs.value)
        return run ? { kind: 'stairs', id: run.id } : null
      }
      case 'label': {
        const label = labelAtPoint(world, labels.value)
        return label ? { kind: 'label', id: label.id } : null
      }
      case 'dimension': {
        const toleranceIn = DIMENSION_HIT_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
        const dimension = dimensionAtPoint(world, dimensions.value, toleranceIn)
        return dimension ? { kind: 'dimension', id: dimension.id } : null
      }
      case 'device': {
        const device = deviceAtPoint(world, devices.value, walls.value)
        return device ? { kind: 'device', id: device.id } : null
      }
      default:
        return null
    }
  }

  function trySelectForEdit(tool: ToolId, world: Point): boolean {
    const hit = editHitFor(tool, world)
    if (!hit) return false
    store.select([hit], 'replace')
    return true
  }

  function clearOnEscape(): boolean {
    if (store.selection.size === 0) return false
    store.clearSelection()
    return true
  }

  return { placeThenTweak, trySelectForEdit, clearOnEscape }
}
