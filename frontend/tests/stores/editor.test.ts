import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import { getPlan, savePlanDocument, updatePlanMetadata } from '@/api/plans'
import { useEditorStore } from '@/stores/editor'
import { CIRCUIT_PALETTE } from '@/utils/circuits'
import {
  makeCircuit,
  makeControlLink,
  makeDevice,
  makeDimension,
  makeDocument,
  makeLabel,
  makeOpening,
  makePlan,
  makeStairs,
  makeUnderlay,
  makeWall,
  makeWire,
} from '../helpers/planFactory'

vi.mock('@/api/plans')

describe('useEditorStore autosave', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves once, two seconds after the last mutation, with the current revision', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setViewport', viewport: { center: { x: 10, y: 20 }, zoom: 2 } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(savePlanDocument).not.toHaveBeenCalled()

    store.mutate({ type: 'setViewport', viewport: { center: { x: 30, y: 40 }, zoom: 2 } })
    await vi.advanceTimersByTimeAsync(1999)
    expect(savePlanDocument).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(savePlanDocument).toHaveBeenCalledTimes(1)
    expect(savePlanDocument).toHaveBeenCalledWith('plan-1', {
      revision: 3,
      document: makeDocument({ viewport: { center: { x: 30, y: 40 }, zoom: 2 } }),
    })
    expect(store.revision).toBe(4)
    expect(store.saveState).toBe('saved')
  })

  it('adopts the new revision so the next save uses it', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument)
      .mockResolvedValueOnce({ revision: 4 })
      .mockResolvedValueOnce({ revision: 5 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setViewport', viewport: { center: { x: 1, y: 1 }, zoom: 1 } })
    await vi.advanceTimersByTimeAsync(2000)
    store.mutate({ type: 'setViewport', viewport: { center: { x: 2, y: 2 }, zoom: 1 } })
    await vi.advanceTimersByTimeAsync(2000)

    expect(savePlanDocument).toHaveBeenCalledTimes(2)
    expect(vi.mocked(savePlanDocument).mock.calls[1]?.[1]?.revision).toBe(4)
    expect(store.revision).toBe(5)
  })

  it('reloads the server version and surfaces an error state on a 409 conflict', async () => {
    const fresh = makePlan({
      revision: 9,
      document: makeDocument({ viewport: { center: { x: 5, y: 5 }, zoom: 3 } }),
    })
    vi.mocked(getPlan).mockResolvedValueOnce(makePlan()).mockResolvedValueOnce(fresh)
    vi.mocked(savePlanDocument).mockRejectedValue(new ApiError(409, 'Revision conflict'))
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setViewport', viewport: { center: { x: 10, y: 20 }, zoom: 2 } })
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(0)

    expect(getPlan).toHaveBeenCalledTimes(2)
    expect(store.saveState).toBe('error')
    expect(store.saveError).toContain('reloaded')
    expect(store.revision).toBe(9)
    expect(store.document?.viewport.zoom).toBe(3)
  })

  it('surfaces non-conflict save failures without reloading', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockRejectedValue(new ApiError(500, 'boom'))
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setViewport', viewport: { center: { x: 1, y: 1 }, zoom: 1 } })
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(0)

    expect(getPlan).toHaveBeenCalledTimes(1)
    expect(store.saveState).toBe('error')
    expect(store.saveError).toBe('boom')
  })

  it('flushPendingSave saves immediately without waiting for the debounce', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setViewport', viewport: { center: { x: 7, y: 7 }, zoom: 1 } })
    await store.flushPendingSave()

    expect(savePlanDocument).toHaveBeenCalledTimes(1)
    expect(store.saveState).toBe('saved')
    await vi.advanceTimersByTimeAsync(5000)
    expect(savePlanDocument).toHaveBeenCalledTimes(1)
  })

  it('addWall appends the wall, bumps the document version and autosaves it', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    const versionBefore = store.documentVersion

    const wall = makeWall({ id: 'wall-new' })
    store.mutate({ type: 'addWall', wall })

    expect(store.document?.walls).toEqual([wall])
    expect(store.documentVersion).toBe(versionBefore + 1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(savePlanDocument).toHaveBeenCalledWith('plan-1', {
      revision: 3,
      document: makeDocument({ walls: [wall] }),
    })
  })

  it('setActiveTool writes the tool into the document and autosaves it like the viewport', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setActiveTool', toolId: 'wall' })

    expect(store.document?.active_tool).toBe('wall')
    await vi.advanceTimersByTimeAsync(2000)
    expect(savePlanDocument).toHaveBeenCalledWith('plan-1', {
      revision: 3,
      document: makeDocument({ active_tool: 'wall' }),
    })
  })

  it('setDisplayPrecision writes the override, drives displayPrecisionIn and autosaves, without entering the history', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    expect(store.displayPrecisionIn).toBe(1 / 8)

    store.mutate({ type: 'setDisplayPrecision', precisionIn: 0.25 })

    expect(store.displayPrecisionIn).toBe(0.25)
    expect(store.canUndo).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(savePlanDocument).toHaveBeenCalledWith('plan-1', {
      revision: 3,
      document: makeDocument({ display_precision_in: 0.25 }),
    })
  })

  it('setThicknessPresets replaces the preset list and autosaves, without entering the history', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    store.mutate({ type: 'setThicknessPresets', presetsIn: [12, 6, 3.5] })

    expect(store.document?.thickness_presets_in).toEqual([12, 6, 3.5])
    expect(store.canUndo).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(savePlanDocument).toHaveBeenCalledWith('plan-1', {
      revision: 3,
      document: makeDocument({ thickness_presets_in: [12, 6, 3.5] }),
    })
  })

  it('updateCurrentPlanMetadata patches the plan and adopts the returned metadata and revision', async () => {
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(updatePlanMetadata).mockResolvedValue(
      makePlan({ name: 'Cellar', description: 'Reno 2026', revision: 5 }),
    )
    const store = useEditorStore()
    await store.loadPlan('plan-1')

    await store.updateCurrentPlanMetadata({ name: 'Cellar', description: 'Reno 2026' })

    expect(updatePlanMetadata).toHaveBeenCalledWith('plan-1', {
      name: 'Cellar',
      description: 'Reno 2026',
    })
    expect(store.plan?.name).toBe('Cellar')
    expect(store.plan?.description).toBe('Reno 2026')
    expect(store.revision).toBe(5)
  })

  it('mutate does nothing before a plan is loaded', async () => {
    const store = useEditorStore()
    store.mutate({ type: 'setViewport', viewport: { center: { x: 1, y: 1 }, zoom: 1 } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(savePlanDocument).not.toHaveBeenCalled()
    expect(store.document).toBeNull()
  })
})

describe('useEditorStore undo/redo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(getPlan).mockResolvedValue(makePlan())
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function loadedStore() {
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    return store
  }

  it('undoes and redoes addWall, tracking canUndo/canRedo', async () => {
    const store = await loadedStore()
    expect(store.canUndo).toBe(false)

    const wall = makeWall({ id: 'w1' })
    store.mutate({ type: 'addWall', wall })
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)

    store.undo()
    expect(store.document?.walls).toEqual([])
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(true)

    store.redo()
    expect(store.document?.walls).toEqual([wall])
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
  })

  it('undoes updateWall back to the previous wall and redoes the replacement', async () => {
    const store = await loadedStore()
    const original = makeWall({ id: 'w1' })
    const updated = makeWall({ id: 'w1', thickness_in: 12 })
    store.mutate({ type: 'addWall', wall: original })
    store.mutate({ type: 'updateWall', wallId: 'w1', wall: updated })

    store.undo()
    expect(store.document?.walls).toEqual([original])
    store.redo()
    expect(store.document?.walls).toEqual([updated])
  })

  it('reference change and swap round-trip through undo/redo without touching attachments (spec S1a)', async () => {
    const store = await loadedStore()
    const wall = makeWall({ id: 'wall-1', reference: 'left' })
    const opening = makeOpening()
    const device = makeDevice()
    store.mutate({ type: 'addWall', wall })
    store.mutate({ type: 'addOpening', opening })
    store.mutate({ type: 'addDevice', device })

    // Swap sides: left -> right, geometry re-offsets, reference line stays put.
    store.mutate({ type: 'updateWall', wallId: 'wall-1', wall: { ...wall, reference: 'right' } })
    expect(store.document?.walls[0].reference).toBe('right')
    expect(store.document?.walls[0].vertices).toEqual(wall.vertices)
    // Attachments are parametric on the reference line — stored data untouched.
    expect(store.document?.openings[0]).toBe(opening)
    expect(store.document?.devices[0]).toBe(device)
    expect(store.document?.devices[0].attachment).toEqual({
      wall_id: 'wall-1',
      segment_index: 0,
      t: 60,
      side: 'left',
    })

    store.undo()
    expect(store.document?.walls[0].reference).toBe('left')
    expect(store.document?.openings[0]).toBe(opening)
    expect(store.document?.devices[0]).toBe(device)

    store.redo()
    expect(store.document?.walls[0].reference).toBe('right')
    expect(store.document?.walls[0].vertices).toEqual(wall.vertices)
    expect(store.document?.openings[0]).toBe(opening)
    expect(store.document?.devices[0]).toBe(device)
  })

  it('undoing removeWall restores the wall at its original index', async () => {
    const store = await loadedStore()
    const walls = [makeWall({ id: 'a' }), makeWall({ id: 'b' }), makeWall({ id: 'c' })]
    for (const wall of walls) store.mutate({ type: 'addWall', wall })

    store.mutate({ type: 'removeWall', wallId: 'b' })
    expect(store.document?.walls.map((w) => w.id)).toEqual(['a', 'c'])

    store.undo()
    expect(store.document?.walls.map((w) => w.id)).toEqual(['a', 'b', 'c'])
  })

  it('excludes setActiveTool from the history: undo skips over tool changes', async () => {
    const store = await loadedStore()
    store.mutate({ type: 'addWall', wall: makeWall({ id: 'w1' }) })
    store.mutate({ type: 'setActiveTool', toolId: 'device' })

    store.undo()
    expect(store.document?.walls).toEqual([])
    expect(store.document?.active_tool).toBe('device')
    expect(store.canUndo).toBe(false)
  })

  it('excludes setViewport from the history: undo skips over viewport changes', async () => {
    const store = await loadedStore()
    store.mutate({ type: 'addWall', wall: makeWall({ id: 'w1' }) })
    store.mutate({ type: 'setViewport', viewport: { center: { x: 9, y: 9 }, zoom: 2 } })

    store.undo()
    expect(store.document?.walls).toEqual([])
    expect(store.document?.viewport).toEqual({ center: { x: 9, y: 9 }, zoom: 2 })
    expect(store.canUndo).toBe(false)
  })

  it('ignores mutations whose target wall does not exist', async () => {
    const store = await loadedStore()
    store.mutate({ type: 'updateWall', wallId: 'ghost', wall: makeWall({ id: 'ghost' }) })
    store.mutate({ type: 'removeWall', wallId: 'ghost' })
    expect(store.canUndo).toBe(false)
    expect(store.document?.walls).toEqual([])
  })

  it('coalesces a transaction of many mutations into ONE undo step', async () => {
    const store = await loadedStore()
    const original = makeWall({ id: 'w1' })
    store.mutate({ type: 'addWall', wall: original })

    store.beginTransaction()
    for (let step = 1; step <= 5; step++) {
      store.mutate({
        type: 'updateWall',
        wallId: 'w1',
        wall: makeWall({
          id: 'w1',
          vertices: [
            { x: step, y: 0 },
            { x: 120 + step, y: 0 },
          ],
        }),
      })
    }
    store.commitTransaction()

    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 5, y: 0 })
    store.undo()
    expect(store.document?.walls).toEqual([original])
    store.redo()
    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 5, y: 0 })
  })

  it('abortTransaction reverts its mutations and records nothing', async () => {
    const store = await loadedStore()
    const original = makeWall({ id: 'w1' })
    store.mutate({ type: 'addWall', wall: original })

    store.beginTransaction()
    store.mutate({
      type: 'updateWall',
      wallId: 'w1',
      wall: makeWall({ id: 'w1', thickness_in: 9 }),
    })
    store.mutate({ type: 'addWall', wall: makeWall({ id: 'w2' }) })
    store.abortTransaction()

    expect(store.document?.walls).toEqual([original])
    store.undo()
    expect(store.document?.walls).toEqual([])
  })

  it('clears the redo stack on a new mutation', async () => {
    const store = await loadedStore()
    store.mutate({ type: 'addWall', wall: makeWall({ id: 'w1' }) })
    store.undo()
    expect(store.canRedo).toBe(true)

    store.mutate({ type: 'addWall', wall: makeWall({ id: 'w2' }) })
    expect(store.canRedo).toBe(false)
  })

  it('caps the history depth at 100 steps', async () => {
    const store = await loadedStore()
    for (let i = 0; i < 105; i++) {
      store.mutate({ type: 'addWall', wall: makeWall({ id: `w${i}` }) })
    }
    let undos = 0
    while (store.canUndo) {
      store.undo()
      undos++
    }
    expect(undos).toBe(100)
    expect(store.document?.walls).toHaveLength(5)
  })

  it('undo and redo schedule an autosave', async () => {
    const store = await loadedStore()
    store.mutate({ type: 'addWall', wall: makeWall({ id: 'w1' }) })
    await vi.advanceTimersByTimeAsync(2000)
    vi.mocked(savePlanDocument).mockClear()

    store.undo()
    await vi.advanceTimersByTimeAsync(2000)
    expect(savePlanDocument).toHaveBeenCalledTimes(1)

    store.redo()
    await vi.advanceTimersByTimeAsync(2000)
    expect(savePlanDocument).toHaveBeenCalledTimes(2)
  })
})

describe('useEditorStore selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(getPlan).mockResolvedValue(
      makePlan({
        document: makeDocument({ walls: [makeWall({ id: 'a' }), makeWall({ id: 'b' })] }),
      }),
    )
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function loadedStore() {
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    return store
  }

  it('supports replace, add and toggle selection modes', async () => {
    const store = await loadedStore()
    store.select([{ kind: 'wall', id: 'a' }])
    expect(store.isSelected({ kind: 'wall', id: 'a' })).toBe(true)

    store.select([{ kind: 'wall', id: 'b' }], 'add')
    expect(store.selectedWallIds).toEqual(new Set(['a', 'b']))

    store.select([{ kind: 'wall', id: 'a' }], 'toggle')
    expect(store.selectedWallIds).toEqual(new Set(['b']))

    store.select([{ kind: 'wall', id: 'a' }], 'replace')
    expect(store.selectedWallIds).toEqual(new Set(['a']))

    store.clearSelection()
    expect(store.selectedWallIds.size).toBe(0)
  })

  it('exposes the selected walls in document order', async () => {
    const store = await loadedStore()
    store.select([
      { kind: 'wall', id: 'b' },
      { kind: 'wall', id: 'a' },
    ])
    expect(store.selectedWalls.map((wall) => wall.id)).toEqual(['a', 'b'])
  })

  it('prunes the selection when a selected wall is removed, and on undo of addWall', async () => {
    const store = await loadedStore()
    store.select([{ kind: 'wall', id: 'a' }])
    store.mutate({ type: 'removeWall', wallId: 'a' })
    expect(store.selectedWallIds.size).toBe(0)

    store.mutate({ type: 'addWall', wall: makeWall({ id: 'new' }) })
    store.select([{ kind: 'wall', id: 'new' }])
    store.undo()
    expect(store.selectedWallIds.size).toBe(0)
  })

  it('deleteSelection removes every selected wall as a single undo step', async () => {
    const store = await loadedStore()
    store.select([
      { kind: 'wall', id: 'a' },
      { kind: 'wall', id: 'b' },
    ])
    store.deleteSelection()
    expect(store.document?.walls).toEqual([])
    expect(store.selectedWallIds.size).toBe(0)

    store.undo()
    expect(store.document?.walls.map((wall) => wall.id)).toEqual(['a', 'b'])
    expect(store.canUndo).toBe(false)
  })
})

describe('useEditorStore structure element commands', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function loadedStore(document = makeDocument()) {
    vi.mocked(getPlan).mockResolvedValue(makePlan({ document }))
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    return store
  }

  it('add/update/removeOpening apply and their inverses undo exactly', async () => {
    const store = await loadedStore(makeDocument({ walls: [makeWall()] }))
    const opening = makeOpening({ id: 'o1' })
    const updated = makeOpening({ id: 'o1', t: 90, hinge: 'right', swing: 'out' })

    store.mutate({ type: 'addOpening', opening })
    store.mutate({ type: 'updateOpening', openingId: 'o1', opening: updated })
    store.mutate({ type: 'removeOpening', openingId: 'o1' })
    expect(store.document?.openings).toEqual([])

    store.undo()
    expect(store.document?.openings).toEqual([updated])
    store.undo()
    expect(store.document?.openings).toEqual([opening])
    store.undo()
    expect(store.document?.openings).toEqual([])
    expect(store.canUndo).toBe(false)

    store.redo()
    expect(store.document?.openings).toEqual([opening])
  })

  it('add/update/removeStairs apply and their inverses undo exactly', async () => {
    const store = await loadedStore()
    const stairs = makeStairs({ id: 's1' })
    const updated = makeStairs({ id: 's1', length_in: 120, direction: 'down' })

    store.mutate({ type: 'addStairs', stairs })
    store.mutate({ type: 'updateStairs', stairsId: 's1', stairs: updated })
    expect(store.document?.stairs).toEqual([updated])

    store.mutate({ type: 'removeStairs', stairsId: 's1' })
    expect(store.document?.stairs).toEqual([])

    store.undo()
    expect(store.document?.stairs).toEqual([updated])
    store.undo()
    expect(store.document?.stairs).toEqual([stairs])
  })

  it('add/update/removeLabel apply and their inverses undo exactly', async () => {
    const store = await loadedStore()
    const label = makeLabel({ id: 'l1' })
    const updated = makeLabel({ id: 'l1', text: 'Kitchen', size_in: 12 })

    store.mutate({ type: 'addLabel', label })
    store.mutate({ type: 'updateLabel', labelId: 'l1', label: updated })
    expect(store.document?.labels).toEqual([updated])

    store.mutate({ type: 'removeLabel', labelId: 'l1' })
    store.undo()
    expect(store.document?.labels).toEqual([updated])
    store.undo()
    expect(store.document?.labels).toEqual([label])
  })

  it('add/update/removeDimension apply and their inverses undo exactly', async () => {
    const store = await loadedStore()
    const dimension = makeDimension({ id: 'd1' })
    const updated = makeDimension({ id: 'd1', offset_in: -24 })

    store.mutate({ type: 'addDimension', dimension })
    store.mutate({ type: 'updateDimension', dimensionId: 'd1', dimension: updated })
    expect(store.document?.dimensions).toEqual([updated])

    store.mutate({ type: 'removeDimension', dimensionId: 'd1' })
    store.undo()
    expect(store.document?.dimensions).toEqual([updated])
    store.undo()
    expect(store.document?.dimensions).toEqual([dimension])
  })

  it('setUnderlay import, move and remove each undo and redo exactly', async () => {
    const store = await loadedStore()
    const imported = makeUnderlay()
    const moved = makeUnderlay({
      transform: { origin: { x: 25, y: 40 }, rotation_deg: 0, scale: 1 },
    })

    store.mutate({ type: 'setUnderlay', underlay: imported })
    store.mutate({ type: 'setUnderlay', underlay: moved })
    store.mutate({ type: 'setUnderlay', underlay: null })
    expect(store.document?.underlay).toBeNull()

    store.undo()
    expect(store.document?.underlay).toEqual(moved)
    store.undo()
    expect(store.document?.underlay).toEqual(imported)
    store.undo()
    expect(store.document?.underlay).toBeNull()
    expect(store.canUndo).toBe(false)

    store.redo()
    expect(store.document?.underlay).toEqual(imported)
    store.redo()
    expect(store.document?.underlay).toEqual(moved)
  })

  it('undoing a remove restores the element at its original index', async () => {
    const store = await loadedStore(
      makeDocument({
        labels: [makeLabel({ id: 'a' }), makeLabel({ id: 'b' }), makeLabel({ id: 'c' })],
      }),
    )

    store.mutate({ type: 'removeLabel', labelId: 'b' })
    store.undo()
    expect(store.document?.labels.map((label) => label.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores mutations whose target element does not exist', async () => {
    const store = await loadedStore()
    store.mutate({ type: 'updateOpening', openingId: 'ghost', opening: makeOpening() })
    store.mutate({ type: 'removeStairs', stairsId: 'ghost' })
    store.mutate({ type: 'removeDimension', dimensionId: 'ghost' })
    expect(store.canUndo).toBe(false)
  })

  it('removing a wall cascades to its openings in ONE undo step', async () => {
    const wallA = makeWall({ id: 'a' })
    const wallB = makeWall({
      id: 'b',
      vertices: [
        { x: 0, y: 100 },
        { x: 120, y: 100 },
      ],
    })
    const openings = [
      makeOpening({ id: 'o1', wall_id: 'a', t: 30 }),
      makeOpening({ id: 'o2', wall_id: 'a', t: 90 }),
      makeOpening({ id: 'o3', wall_id: 'b' }),
    ]
    const store = await loadedStore(makeDocument({ walls: [wallA, wallB], openings }))

    store.mutate({ type: 'removeWall', wallId: 'a' })
    expect(store.document?.walls.map((wall) => wall.id)).toEqual(['b'])
    expect(store.document?.openings.map((opening) => opening.id)).toEqual(['o3'])

    store.undo()
    expect(store.document?.walls.map((wall) => wall.id)).toEqual(['a', 'b'])
    expect(store.document?.openings.map((opening) => opening.id)).toEqual(['o1', 'o2', 'o3'])
    expect(store.canUndo).toBe(false)

    store.redo()
    expect(store.document?.openings.map((opening) => opening.id)).toEqual(['o3'])
  })

  it('deleteSelection handles a selected opening whose selected wall cascades too', async () => {
    const store = await loadedStore(
      makeDocument({
        walls: [makeWall({ id: 'a' })],
        openings: [makeOpening({ id: 'o1', wall_id: 'a' })],
        stairs: [makeStairs({ id: 's1' })],
        labels: [makeLabel({ id: 'l1' })],
        dimensions: [makeDimension({ id: 'd1' })],
      }),
    )
    store.select([
      { kind: 'wall', id: 'a' },
      { kind: 'opening', id: 'o1' },
      { kind: 'stairs', id: 's1' },
      { kind: 'label', id: 'l1' },
      { kind: 'dimension', id: 'd1' },
    ])

    store.deleteSelection()
    expect(store.document?.walls).toEqual([])
    expect(store.document?.openings).toEqual([])
    expect(store.document?.stairs).toEqual([])
    expect(store.document?.labels).toEqual([])
    expect(store.document?.dimensions).toEqual([])
    expect(store.selection.size).toBe(0)

    store.undo()
    expect(store.document?.walls).toHaveLength(1)
    expect(store.document?.openings).toHaveLength(1)
    expect(store.document?.stairs).toHaveLength(1)
    expect(store.document?.labels).toHaveLength(1)
    expect(store.document?.dimensions).toHaveLength(1)
    expect(store.canUndo).toBe(false)
  })

  it('prunes selections of removed openings, stairs, labels and dimensions', async () => {
    const store = await loadedStore(
      makeDocument({
        walls: [makeWall()],
        openings: [makeOpening({ id: 'o1' })],
        stairs: [makeStairs({ id: 's1' })],
      }),
    )
    store.select([
      { kind: 'opening', id: 'o1' },
      { kind: 'stairs', id: 's1' },
    ])

    store.mutate({ type: 'removeOpening', openingId: 'o1' })
    expect(store.selectedOpeningIds.size).toBe(0)
    expect(store.selectedStairsIds).toEqual(new Set(['s1']))
  })

  it('coalesces repeated element updates inside a transaction into one undo step', async () => {
    const store = await loadedStore(
      makeDocument({ walls: [makeWall()], openings: [makeOpening({ id: 'o1', t: 60 })] }),
    )

    store.beginTransaction()
    for (const t of [70, 80, 90]) {
      store.mutate({
        type: 'updateOpening',
        openingId: 'o1',
        opening: makeOpening({ id: 'o1', t }),
      })
    }
    store.commitTransaction()

    expect(store.document?.openings[0]?.t).toBe(90)
    store.undo()
    expect(store.document?.openings[0]?.t).toBe(60)
    expect(store.canUndo).toBe(false)
  })
})

describe('useEditorStore device commands', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function loadedStore(document = makeDocument()) {
    vi.mocked(getPlan).mockResolvedValue(makePlan({ document }))
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    return store
  }

  it('add/update/removeDevice apply and their inverses undo exactly', async () => {
    const store = await loadedStore(makeDocument({ walls: [makeWall()] }))

    store.mutate({ type: 'addDevice', device: makeDevice({ id: 'd1', label: 'A' }) })
    expect(store.document?.devices.map((device) => device.id)).toEqual(['d1'])

    store.mutate({
      type: 'updateDevice',
      deviceId: 'd1',
      device: makeDevice({ id: 'd1', label: 'B' }),
    })
    expect(store.document?.devices[0]?.label).toBe('B')
    store.undo()
    expect(store.document?.devices[0]?.label).toBe('A')

    store.mutate({ type: 'removeDevice', deviceId: 'd1' })
    expect(store.document?.devices).toEqual([])
    store.undo()
    expect(store.document?.devices.map((device) => device.id)).toEqual(['d1'])
  })

  it('removing a wall cascades to its attached devices in ONE undo step', async () => {
    const store = await loadedStore(
      makeDocument({
        walls: [
          makeWall({ id: 'a' }),
          makeWall({
            id: 'b',
            vertices: [
              { x: 0, y: 100 },
              { x: 120, y: 100 },
            ],
          }),
        ],
        devices: [
          makeDevice({
            id: 'd1',
            attachment: { wall_id: 'a', segment_index: 0, t: 30, side: 'left' },
          }),
          makeDevice({
            id: 'd2',
            attachment: { wall_id: 'b', segment_index: 0, t: 30, side: 'left' },
          }),
          makeDevice({
            id: 'd3',
            type: 'ceiling_light',
            attachment: null,
            position: { x: 5, y: 5 },
          }),
        ],
      }),
    )

    store.mutate({ type: 'removeWall', wallId: 'a' })
    expect(store.document?.devices.map((device) => device.id)).toEqual(['d2', 'd3'])

    store.undo()
    expect(store.document?.devices.map((device) => device.id)).toEqual(['d1', 'd2', 'd3'])
    expect(store.document?.walls.map((wall) => wall.id)).toEqual(['a', 'b'])
    expect(store.canUndo).toBe(false)
  })

  it('copies and pastes selected devices offset by 12 inches as one undo step', async () => {
    const store = await loadedStore(
      makeDocument({
        walls: [makeWall({ id: 'a' })],
        devices: [
          makeDevice({
            id: 'd1',
            attachment: { wall_id: 'a', segment_index: 0, t: 40, side: 'left' },
          }),
          makeDevice({
            id: 'd2',
            type: 'ceiling_light',
            attachment: null,
            position: { x: 10, y: 20 },
          }),
        ],
      }),
    )
    store.select([
      { kind: 'device', id: 'd1' },
      { kind: 'device', id: 'd2' },
    ])

    store.copySelection()
    store.pasteClipboard()

    const devices = store.document?.devices ?? []
    expect(devices).toHaveLength(4)
    const attachedCopy = devices.find((device) => device.id !== 'd1' && device.attachment)
    const freeCopy = devices.find((device) => device.id !== 'd2' && device.position)
    expect(attachedCopy?.attachment?.t).toBe(52)
    expect(freeCopy?.position).toEqual({ x: 22, y: 32 })
    // The pasted copies become the selection.
    expect(store.selectedDeviceIds.size).toBe(2)

    store.undo()
    expect(store.document?.devices).toHaveLength(2)
    expect(store.canUndo).toBe(false)
  })

  it('duplicate offsets the selected devices in one undo step', async () => {
    const store = await loadedStore(
      makeDocument({
        devices: [
          makeDevice({
            id: 'd1',
            type: 'ceiling_light',
            attachment: null,
            position: { x: 0, y: 0 },
          }),
        ],
      }),
    )
    store.select([{ kind: 'device', id: 'd1' }])

    store.duplicateSelection()
    expect(store.document?.devices).toHaveLength(2)
    const copy = store.document?.devices.find((device) => device.id !== 'd1')
    expect(copy?.position).toEqual({ x: 12, y: 12 })

    store.undo()
    expect(store.document?.devices).toHaveLength(1)
  })

  it('clamps a pasted attached device to its host segment span', async () => {
    const store = await loadedStore(
      makeDocument({
        walls: [makeWall({ id: 'a' })],
        devices: [
          makeDevice({
            id: 'd1',
            attachment: { wall_id: 'a', segment_index: 0, t: 115, side: 'left' },
          }),
        ],
      }),
    )
    store.select([{ kind: 'device', id: 'd1' }])
    store.copySelection()
    store.pasteClipboard()

    const copy = store.document?.devices.find((device) => device.id !== 'd1')
    // Segment is 120" long; 115 + 12 clamps to 120.
    expect(copy?.attachment?.t).toBe(120)
  })
})

describe('useEditorStore circuit / wire / control-link commands', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function loadedStore(document = makeDocument()) {
    vi.mocked(getPlan).mockResolvedValue(makePlan({ document }))
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    return store
  }

  it('add/update/removeCircuit apply and their inverses undo exactly', async () => {
    const store = await loadedStore()

    store.mutate({ type: 'addCircuit', circuit: makeCircuit({ id: 'c', name: 'A' }) })
    expect(store.document?.circuits.map((circuit) => circuit.id)).toEqual(['c'])

    store.mutate({
      type: 'updateCircuit',
      circuitId: 'c',
      circuit: makeCircuit({ id: 'c', name: 'B' }),
    })
    expect(store.document?.circuits[0]?.name).toBe('B')
    store.undo()
    expect(store.document?.circuits[0]?.name).toBe('A')

    store.mutate({ type: 'removeCircuit', circuitId: 'c' })
    expect(store.document?.circuits).toEqual([])
    store.undo()
    expect(store.document?.circuits.map((circuit) => circuit.id)).toEqual(['c'])
  })

  it('removing a circuit cascades to its wires in ONE undo step (spec C1)', async () => {
    const store = await loadedStore(
      makeDocument({
        circuits: [makeCircuit({ id: 'c' })],
        devices: [makeDevice({ id: 'p', type: 'panel' }), makeDevice({ id: 'o1' })],
        wires: [makeWire({ id: 'w1', circuit_id: 'c', from_device_id: 'p', to_device_id: 'o1' })],
      }),
    )

    store.mutate({ type: 'removeCircuit', circuitId: 'c' })
    expect(store.document?.circuits).toEqual([])
    expect(store.document?.wires).toEqual([])

    store.undo()
    expect(store.document?.circuits.map((circuit) => circuit.id)).toEqual(['c'])
    expect(store.document?.wires.map((wire) => wire.id)).toEqual(['w1'])
    expect(store.canUndo).toBe(false)
  })

  it('removing a device cascades to its wires and control links in ONE undo step (spec W5)', async () => {
    const store = await loadedStore(
      makeDocument({
        circuits: [makeCircuit({ id: 'c' })],
        devices: [
          makeDevice({ id: 'p', type: 'panel' }),
          makeDevice({ id: 'sw', type: 'switch' }),
          makeDevice({ id: 'l', type: 'ceiling_light' }),
        ],
        wires: [
          makeWire({ id: 'w1', circuit_id: 'c', from_device_id: 'p', to_device_id: 'l' }),
          makeWire({ id: 'w2', circuit_id: 'c', from_device_id: 'l', to_device_id: 'sw' }),
        ],
        control_links: [makeControlLink({ id: 'link-1', switch_id: 'sw', target_id: 'l' })],
      }),
    )

    // Removing the light drops both wires touching it and the link referencing it.
    store.mutate({ type: 'removeDevice', deviceId: 'l' })
    expect(store.document?.devices.map((device) => device.id)).toEqual(['p', 'sw'])
    expect(store.document?.wires).toEqual([])
    expect(store.document?.control_links).toEqual([])

    store.undo()
    expect(store.document?.devices.map((device) => device.id)).toEqual(['p', 'sw', 'l'])
    expect(store.document?.wires.map((wire) => wire.id)).toEqual(['w1', 'w2'])
    expect(store.document?.control_links.map((link) => link.id)).toEqual(['link-1'])
    expect(store.canUndo).toBe(false)
  })

  it('add/update/removeWire apply and their inverses undo exactly', async () => {
    const store = await loadedStore(
      makeDocument({
        circuits: [makeCircuit({ id: 'c' })],
        devices: [makeDevice({ id: 'p', type: 'panel' }), makeDevice({ id: 'o1' })],
      }),
    )
    const wire = makeWire({ id: 'w1', circuit_id: 'c', from_device_id: 'p', to_device_id: 'o1' })

    store.mutate({ type: 'addWire', wire })
    expect(store.document?.wires.map((w) => w.id)).toEqual(['w1'])

    store.mutate({
      type: 'updateWire',
      wireId: 'w1',
      wire: { ...wire, control_points: [{ x: 1, y: 1 }] },
    })
    expect(store.document?.wires[0]?.control_points).toHaveLength(1)
    store.undo()
    expect(store.document?.wires[0]?.control_points).toHaveLength(2)

    store.mutate({ type: 'removeWire', wireId: 'w1' })
    expect(store.document?.wires).toEqual([])
    store.undo()
    expect(store.document?.wires.map((w) => w.id)).toEqual(['w1'])
  })

  it('add/removeControlLink apply and their inverses undo exactly (spec D6)', async () => {
    const store = await loadedStore(
      makeDocument({
        devices: [makeDevice({ id: 'sw', type: 'switch' }), makeDevice({ id: 'l' })],
      }),
    )
    const link = makeControlLink({ id: 'link-1', switch_id: 'sw', target_id: 'l' })

    store.mutate({ type: 'addControlLink', link })
    expect(store.document?.control_links.map((l) => l.id)).toEqual(['link-1'])

    store.mutate({ type: 'removeControlLink', linkId: 'link-1' })
    expect(store.document?.control_links).toEqual([])
    store.undo()
    expect(store.document?.control_links.map((l) => l.id)).toEqual(['link-1'])
  })

  it('nextCircuitColor skips colours already in use (spec C2)', async () => {
    const store = await loadedStore(
      makeDocument({ circuits: [makeCircuit({ id: 'c', color: CIRCUIT_PALETTE[0] })] }),
    )
    expect(store.nextCircuitColor()).toBe(CIRCUIT_PALETTE[1])
  })

  it('toggleIsolatedCircuit isolates then clears, always setting the active circuit (spec C5)', async () => {
    const store = await loadedStore(makeDocument({ circuits: [makeCircuit({ id: 'c' })] }))

    store.toggleIsolatedCircuit('c')
    expect(store.isolatedCircuitId).toBe('c')
    expect(store.activeCircuitId).toBe('c')

    store.toggleIsolatedCircuit('c')
    expect(store.isolatedCircuitId).toBeNull()
    expect(store.activeCircuitId).toBe('c')
  })
})
