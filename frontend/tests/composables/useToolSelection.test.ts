import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import { useOpeningTool } from '@/composables/useOpeningTool'
import { useToolSelection } from '@/composables/useToolSelection'
import type { ToolSelectionStore } from '@/composables/useToolSelection'
import { selectionKeyOf } from '@/stores/editor'
import type { ElementRef } from '@/stores/editor'
import type { Device, Dimension, Label, Opening, Stairs, Wall } from '@/types/plan'
import {
  makeDevice,
  makeDimension,
  makeLabel,
  makeOpening,
  makeStairs,
  makeWall,
} from '../helpers/planFactory'

/** In-memory selection store standing in for the editor store's selection API. */
function makeStore(initial: readonly ElementRef[] = []): ToolSelectionStore {
  const selection = new Map<string, ElementRef>(
    initial.map((entry) => [selectionKeyOf(entry), entry]),
  )
  return {
    selection,
    select(refs, mode = 'replace') {
      if (mode === 'replace') selection.clear()
      for (const entry of refs) selection.set(selectionKeyOf(entry), entry)
    },
    clearSelection() {
      selection.clear()
    },
  }
}

function selectedRefs(store: ToolSelectionStore): ElementRef[] {
  return [...store.selection.values()]
}

describe('useToolSelection', () => {
  interface SetupOptions {
    openings?: Opening[]
    stairs?: Stairs[]
    labels?: Label[]
    dimensions?: Dimension[]
    devices?: Device[]
    selection?: ElementRef[]
  }

  function setup(options: SetupOptions = {}) {
    const store = makeStore(options.selection)
    const walls = ref<readonly Wall[]>([makeWall()])
    const toolSelection = useToolSelection({
      store,
      walls,
      openings: ref<readonly Opening[]>(options.openings ?? []),
      stairs: ref<readonly Stairs[]>(options.stairs ?? []),
      labels: ref<readonly Label[]>(options.labels ?? []),
      dimensions: ref<readonly Dimension[]>(options.dimensions ?? []),
      devices: ref<readonly Device[]>(options.devices ?? []),
      pixelsPerInch: ref(2),
    })
    return { store, toolSelection, walls }
  }

  it('makes each committed placement the current selection while the tool keeps placing', () => {
    const { store, toolSelection, walls } = setup()
    const commit = vi.fn<(opening: Opening) => void>()
    const tool = useOpeningTool({
      kind: computed(() => 'door' as const),
      walls,
      pixelsPerInch: ref(2),
      commit: toolSelection.placeThenTweak('opening', commit),
    })

    tool.onClick({ x: 60, y: 1 })
    expect(commit).toHaveBeenCalledTimes(1)
    const first = commit.mock.calls[0][0]
    expect(selectedRefs(store)).toEqual([{ kind: 'opening', id: first.id }])

    tool.onClick({ x: 100, y: 1 })
    expect(commit).toHaveBeenCalledTimes(2)
    const second = commit.mock.calls[1][0]
    expect(second.id).not.toBe(first.id)
    expect(selectedRefs(store)).toEqual([{ kind: 'opening', id: second.id }])
  })

  it('selects an existing door under the door tool instead of placing', () => {
    const door = makeOpening()
    const { store, toolSelection } = setup({ openings: [door] })

    expect(toolSelection.trySelectForEdit('door', { x: 60, y: 0 })).toBe(true)
    expect(selectedRefs(store)).toEqual([{ kind: 'opening', id: door.id }])
  })

  it('only treats openings of the tool kind as its own (door vs window)', () => {
    const window = makeOpening({ kind: 'window' })
    const { store, toolSelection } = setup({ openings: [window] })

    expect(toolSelection.trySelectForEdit('door', { x: 60, y: 0 })).toBe(false)
    expect(store.selection.size).toBe(0)

    expect(toolSelection.trySelectForEdit('window', { x: 60, y: 0 })).toBe(true)
    expect(selectedRefs(store)).toEqual([{ kind: 'opening', id: window.id }])
  })

  it('selects same-kind elements for the stairs, label, dimension and device tools', () => {
    const stairs = makeStairs({ origin: { x: 200, y: 200 } })
    const label = makeLabel({ position: { x: 300, y: 300 } })
    const dimension = makeDimension()
    const device = makeDevice({
      id: 'free-1',
      type: 'smoke_detector',
      attachment: null,
      position: { x: 400, y: 400 },
    })
    const { store, toolSelection } = setup({
      stairs: [stairs],
      labels: [label],
      dimensions: [dimension],
      devices: [device],
    })

    expect(toolSelection.trySelectForEdit('stairs', { x: 210, y: 210 })).toBe(true)
    expect(selectedRefs(store)).toEqual([{ kind: 'stairs', id: stairs.id }])

    expect(toolSelection.trySelectForEdit('label', { x: 302, y: 298 })).toBe(true)
    expect(selectedRefs(store)).toEqual([{ kind: 'label', id: label.id }])

    expect(toolSelection.trySelectForEdit('dimension', { x: 60, y: -12 })).toBe(true)
    expect(selectedRefs(store)).toEqual([{ kind: 'dimension', id: dimension.id }])

    expect(toolSelection.trySelectForEdit('device', { x: 400, y: 400 })).toBe(true)
    expect(selectedRefs(store)).toEqual([{ kind: 'device', id: device.id }])
  })

  it('never selects for the wall tool and leaves the selection alone on a miss', () => {
    const door = makeOpening()
    const initial: ElementRef[] = [{ kind: 'opening', id: door.id }]
    const { store, toolSelection } = setup({ openings: [door], selection: initial })

    expect(toolSelection.trySelectForEdit('wall', { x: 60, y: 0 })).toBe(false)
    expect(toolSelection.trySelectForEdit('door', { x: 60, y: 50 })).toBe(false)
    expect(selectedRefs(store)).toEqual(initial)
  })

  it('clears the selection on the first Escape and reports when there is nothing left', () => {
    const { store, toolSelection } = setup({
      selection: [{ kind: 'opening', id: 'opening-1' }],
    })

    expect(toolSelection.clearOnEscape()).toBe(true)
    expect(store.selection.size).toBe(0)
    expect(toolSelection.clearOnEscape()).toBe(false)
  })
})
