import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type { Circuit, Device, Point, Wall, Wire } from '@/types/plan'
import { autoCurveControlPoints, deviceWorldPlacement, pointInPolygon } from '@/utils/geometry'

export interface UseWireToolOptions {
  /** The circuit new wires are created on (spec W1); `null` disables placement. */
  activeCircuitId: Ref<string | null>
  /** All circuits, to resolve the active circuit's colour for the preview. */
  circuits: Ref<readonly Circuit[]>
  /** Current devices — the only things a wire connects (spec W1). */
  devices: Ref<readonly Device[]>
  /** Current walls, to resolve attached-device world centres. */
  walls: Ref<readonly Wall[]>
  /** Receives each placed wire; the caller dispatches the store command. */
  commit: (wire: Wire) => void
  /** Called when a click needs an active circuit but none is set (raises a quiet notice, W1). */
  onRequireCircuit: () => void
}

/** The wire the next click would draw, plus the colour it inherits (spec W1/W2). */
export interface WireToolPreview {
  from: Point
  to: Point
  controlPoints: [Point, Point]
  color: string
}

export interface UseWireToolReturn {
  /** The chain's current source device id, or `null` when awaiting the first pick. */
  sourceId: Ref<string | null>
  /** The eligible target device under the cursor (highlighted), else `null`. */
  hoveredId: ComputedRef<string | null>
  /** The rubber-band wire from the source to the hovered target/cursor, else `null`. */
  preview: ComputedRef<WireToolPreview | null>
  setCursor: (point: Point | null) => void
  onClick: (world: Point) => void
  /**
   * Routes a key press; returns true when consumed. Enter or Escape ends the
   * current chain (spec W1: chain placement) — Enter because finishing a run
   * of wires is a commit, Escape because it cancels everywhere else — leaving
   * a second Escape for the page to switch back to Select.
   */
  handleKey: (key: string) => boolean
  /** Clears the chain and cursor (on tool switch). */
  deactivate: () => void
}

/**
 * Wire drawing tool (spec W1/W2). Requires an active circuit; a click picks the
 * source device, the next click on another device draws a gentle auto-curved
 * wire between their centres on the active circuit, and the target becomes the
 * new source so outlets daisy-chain. Enter or Escape ends the chain.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useWireTool(options: UseWireToolOptions): UseWireToolReturn {
  const { activeCircuitId, circuits, devices, walls, commit, onRequireCircuit } = options

  const sourceId = ref<string | null>(null)
  const cursor: ShallowRef<Point | null> = shallowRef(null)

  function deviceById(id: string): Device | undefined {
    return devices.value.find((device) => device.id === id)
  }

  function deviceCenter(id: string): Point | null {
    const device = deviceById(id)
    if (!device) return null
    return deviceWorldPlacement(device, walls.value)?.position ?? null
  }

  function deviceAtPoint(point: Point): Device | null {
    const list = devices.value
    for (let i = list.length - 1; i >= 0; i--) {
      const placement = deviceWorldPlacement(list[i], walls.value)
      if (placement && pointInPolygon(point, placement.bounds)) return list[i]
    }
    return null
  }

  const hoveredId = computed<string | null>(() => {
    if (!cursor.value) return null
    const device = deviceAtPoint(cursor.value)
    if (!device) return null
    return device.id === sourceId.value ? null : device.id
  })

  const activeColor = computed<string>(
    () =>
      circuits.value.find((circuit) => circuit.id === activeCircuitId.value)?.color ?? '#64748b',
  )

  const preview = computed<WireToolPreview | null>(() => {
    if (sourceId.value === null) return null
    const from = deviceCenter(sourceId.value)
    if (!from) return null
    const hovered = hoveredId.value
    const to = hovered ? deviceCenter(hovered) : cursor.value
    if (!to) return null
    return { from, to, controlPoints: autoCurveControlPoints(from, to), color: activeColor.value }
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function onClick(world: Point): void {
    if (activeCircuitId.value === null) {
      onRequireCircuit()
      return
    }
    const device = deviceAtPoint(world)
    if (!device) return
    if (sourceId.value === null) {
      sourceId.value = device.id
      return
    }
    if (device.id === sourceId.value) return
    const from = deviceCenter(sourceId.value)
    const to = deviceCenter(device.id)
    if (from && to) {
      commit({
        id: crypto.randomUUID(),
        circuit_id: activeCircuitId.value,
        from_device_id: sourceId.value,
        to_device_id: device.id,
        control_points: autoCurveControlPoints(from, to),
      })
    }
    // Chain: the target becomes the new source (spec W1 daisy-chain).
    sourceId.value = device.id
  }

  function handleKey(key: string): boolean {
    if ((key === 'Escape' || key === 'Enter') && sourceId.value !== null) {
      sourceId.value = null
      return true
    }
    return false
  }

  function deactivate(): void {
    sourceId.value = null
    cursor.value = null
  }

  return { sourceId, hoveredId, preview, setCursor, onClick, handleKey, deactivate }
}
