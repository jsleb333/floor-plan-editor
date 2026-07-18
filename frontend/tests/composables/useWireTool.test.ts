import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import { useWireTool } from '@/composables/useWireTool'
import type { Circuit, Device, Wire } from '@/types/plan'
import { makeCircuit, makeDevice } from '../helpers/planFactory'

function freeDevice(id: string, x: number): Device {
  return makeDevice({ id, type: 'outlet', attachment: null, position: { x, y: 0 } })
}

function setup(circuitId: string | null = 'c') {
  const committed: Wire[] = []
  const activeCircuitId = ref<string | null>(circuitId)
  const onRequireCircuit = vi.fn()
  const devices: Device[] = [freeDevice('a', 0), freeDevice('b', 100), freeDevice('c-dev', 200)]
  const circuits: Circuit[] = [makeCircuit({ id: 'c' })]
  const tool = useWireTool({
    activeCircuitId,
    circuits: computed(() => circuits),
    devices: computed(() => devices),
    walls: computed(() => []),
    commit: (wire) => committed.push(wire),
    onRequireCircuit,
  })
  return { tool, committed, onRequireCircuit, activeCircuitId }
}

describe('useWireTool', () => {
  it('daisy-chains: A→B→C creates two wires on the active circuit (spec W1)', () => {
    const { tool, committed } = setup()

    tool.onClick({ x: 0, y: 0 }) // pick A as source
    expect(tool.sourceId.value).toBe('a')
    expect(committed).toHaveLength(0)

    tool.onClick({ x: 100, y: 0 }) // A→B
    tool.onClick({ x: 200, y: 0 }) // B→C (chained)

    expect(committed).toHaveLength(2)
    expect(committed.map((wire) => [wire.from_device_id, wire.to_device_id])).toEqual([
      ['a', 'b'],
      ['b', 'c-dev'],
    ])
    expect(committed.every((wire) => wire.circuit_id === 'c')).toBe(true)
    expect(committed[0].control_points).toHaveLength(2)
    // The last target became the new source.
    expect(tool.sourceId.value).toBe('c-dev')
  })

  it('requires an active circuit before drawing (spec W1)', () => {
    const { tool, committed, onRequireCircuit } = setup(null)
    tool.onClick({ x: 0, y: 0 })
    expect(onRequireCircuit).toHaveBeenCalledTimes(1)
    expect(tool.sourceId.value).toBeNull()
    expect(committed).toHaveLength(0)
  })

  it('ignores clicking the source again and clicks on empty space', () => {
    const { tool, committed } = setup()
    tool.onClick({ x: 0, y: 0 }) // source A
    tool.onClick({ x: 0, y: 0 }) // same device — ignored
    tool.onClick({ x: 500, y: 500 }) // empty — ignored
    expect(committed).toHaveLength(0)
    expect(tool.sourceId.value).toBe('a')
  })

  it('highlights the hovered eligible target, excluding the source', () => {
    const { tool } = setup()
    tool.onClick({ x: 0, y: 0 }) // source A
    tool.setCursor({ x: 100, y: 0 })
    expect(tool.hoveredId.value).toBe('b')
    tool.setCursor({ x: 0, y: 0 })
    expect(tool.hoveredId.value).toBeNull()
  })

  it('Escape ends the chain, then is not consumed again', () => {
    const { tool } = setup()
    tool.onClick({ x: 0, y: 0 })
    expect(tool.handleKey('Escape')).toBe(true)
    expect(tool.sourceId.value).toBeNull()
    expect(tool.handleKey('Escape')).toBe(false)
  })
})
