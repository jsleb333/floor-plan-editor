import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import { useSelectTool } from '@/composables/useSelectTool'
import type { UseSelectToolReturn } from '@/composables/useSelectTool'
import type { SnapSettings } from '@/composables/useSnapping'
import { getPlan, savePlanDocument } from '@/persistence/plans'
import { UNDERLAY_ELEMENT_ID, useEditorStore } from '@/stores/editor'
import type { Guide, PlanDocument, Wall } from '@/types/plan'
import type { ImageSize } from '@/utils/imageSize'
import { underlayToWorld } from '@/utils/underlay'
import {
  makeCircuit,
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

vi.mock('@/persistence/plans')

const NO_MODIFIERS = { shift: false, alt: false }
const SHIFT = { shift: true, alt: false }

describe('useSelectTool', () => {
  let snapSettings: SnapSettings

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(savePlanDocument).mockResolvedValue({ revision: 4 })
    snapSettings = { grid: ref(false), angle: ref(true), walls: ref(false) }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function setupDocument(
    overrides: Partial<PlanDocument>,
    imageSize: ImageSize | null = null,
  ): Promise<{ store: ReturnType<typeof useEditorStore>; tool: UseSelectToolReturn }> {
    vi.mocked(getPlan).mockResolvedValue(makePlan({ document: makeDocument(overrides) }))
    const store = useEditorStore()
    await store.loadPlan('plan-1')
    const tool = useSelectTool({
      store,
      walls: computed(() => store.document?.walls ?? []),
      openings: computed(() => store.document?.openings ?? []),
      stairs: computed(() => store.document?.stairs ?? []),
      labels: computed(() => store.document?.labels ?? []),
      dimensions: computed(() => store.document?.dimensions ?? []),
      devices: computed(() => store.document?.devices ?? []),
      wires: computed(() => store.document?.wires ?? []),
      isCircuitWiresVisible: () => true,
      guideLines: computed(() => store.guideLines),
      underlay: computed(() => store.document?.underlay ?? null),
      underlayImageSize: ref(imageSize),
      pixelsPerInch: ref(2),
      snapSettings,
    })
    return { store, tool }
  }

  async function setup(
    walls: Wall[],
  ): Promise<{ store: ReturnType<typeof useEditorStore>; tool: UseSelectToolReturn }> {
    return setupDocument({ walls })
  }

  function click(tool: UseSelectToolReturn, x: number, y: number, shift = false): void {
    tool.onPointerDown({ x, y }, shift ? SHIFT : NO_MODIFIERS)
    tool.onPointerUp({ x, y })
  }

  it('selects a wall on click of its body and deselects on empty click', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a' })])

    click(tool, 60, 0.5)
    expect(store.selectedWallIds).toEqual(new Set(['a']))

    click(tool, 500, 500)
    expect(store.selectedWallIds.size).toBe(0)
  })

  it('toggles membership on shift-click', async () => {
    const walls = [
      makeWall({ id: 'a' }),
      makeWall({
        id: 'b',
        vertices: [
          { x: 0, y: 100 },
          { x: 120, y: 100 },
        ],
      }),
    ]
    const { store, tool } = await setup(walls)

    click(tool, 60, 0.5)
    click(tool, 60, 100, true)
    expect(store.selectedWallIds).toEqual(new Set(['a', 'b']))

    click(tool, 60, 100, true)
    expect(store.selectedWallIds).toEqual(new Set(['a']))
  })

  it('selects walls intersecting a rubber band, additively with shift', async () => {
    const walls = [
      makeWall({ id: 'a' }),
      makeWall({
        id: 'b',
        vertices: [
          { x: 0, y: 100 },
          { x: 120, y: 100 },
        ],
      }),
    ]
    const { store, tool } = await setup(walls)

    tool.onPointerDown({ x: -10, y: -10 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 130, y: 50 })
    expect(tool.preview.value.band).not.toBeNull()
    tool.onPointerUp({ x: 130, y: 50 })
    expect(store.selectedWallIds).toEqual(new Set(['a']))

    tool.onPointerDown({ x: -10, y: 80 }, SHIFT)
    tool.onPointerMove({ x: 130, y: 120 })
    tool.onPointerUp({ x: 130, y: 120 })
    expect(store.selectedWallIds).toEqual(new Set(['a', 'b']))
  })

  it('clears the selection on Escape', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a' })])
    click(tool, 60, 0.5)

    expect(tool.handleKey('Escape')).toBe(true)
    expect(store.selectedWallIds.size).toBe(0)
    expect(tool.handleKey('Escape')).toBe(false)
  })

  it('nudges the selection by 1 inch (12 with Shift) as one undo step per keypress', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a' })])
    store.select([{ kind: 'wall', id: 'a' }])

    expect(tool.nudge(1, 0, false)).toBe(true)
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 1, y: 0 },
      { x: 121, y: 0 },
    ])

    tool.nudge(0, 1, true)
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 1, y: 12 },
      { x: 121, y: 12 },
    ])

    store.undo()
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 1, y: 0 },
      { x: 121, y: 0 },
    ])
    store.undo()
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ])
    expect(store.canUndo).toBe(false)
  })

  it('refuses to nudge walls with locked segments, flashing the lock', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a', locked_segments: [0] })])
    store.select([{ kind: 'wall', id: 'a' }])

    expect(tool.nudge(1, 0, false)).toBe(true)
    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(tool.preview.value.lockFlash).toEqual({ wallId: 'a', segments: [0] })
    expect(store.canUndo).toBe(false)
  })

  it('drags a segment parallel to itself as a single undo step', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a' })])
    store.select([{ kind: 'wall', id: 'a' }])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 60, y: 10.5 })
    tool.onPointerMove({ x: 60, y: 20.5 })
    expect(tool.isDragging.value).toBe(true)
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: 20 },
      { x: 120, y: 20 },
    ])
    tool.onPointerUp({ x: 60, y: 20.5 })

    store.undo()
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ])
    expect(store.canUndo).toBe(false)
  })

  it('stretches adjacent segments, directions preserved, when a middle segment drags', async () => {
    // U-shape: dragging the bottom moves it down; both vertical arms stretch.
    const wall = makeWall({
      id: 'u',
      vertices: [
        { x: 0, y: -50 },
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: -50 },
      ],
    })
    const { store, tool } = await setup([wall])
    store.select([{ kind: 'wall', id: 'u' }])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 60, y: 24.5 })
    tool.onPointerUp({ x: 60, y: 24.5 })

    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: -50 },
      { x: 0, y: 24 },
      { x: 120, y: 24 },
      { x: 120, y: -50 },
    ])
  })

  it('aborts a drag on Escape, restoring the original geometry with no undo entry', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a' })])
    store.select([{ kind: 'wall', id: 'a' }])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 60, y: 20.5 })
    expect(tool.handleKey('Escape')).toBe(true)

    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ])
    expect(tool.isDragging.value).toBe(false)
    expect(store.canUndo).toBe(false)
  })

  it('refuses to drag a locked segment, flashing it', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a', locked_segments: [0] })])
    store.select([{ kind: 'wall', id: 'a' }])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 60, y: 20.5 })

    expect(tool.isDragging.value).toBe(false)
    expect(tool.preview.value.lockFlash).toEqual({ wallId: 'a', segments: [0] })
    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 0, y: 0 })
  })

  it('drags an open-chain end vertex along the allowed direction through its neighbour', async () => {
    const { store, tool } = await setup([makeWall({ id: 'a' })])
    store.select([{ kind: 'wall', id: 'a' }])

    tool.onPointerDown({ x: 120, y: 0 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 100, y: 5 })
    tool.onPointerUp({ x: 100, y: 5 })

    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
    store.undo()
    expect(store.document?.walls[0]?.vertices[1]).toEqual({ x: 120, y: 0 })
    expect(store.canUndo).toBe(false)
  })

  it('shows temporary dimension chips during a segment drag and applies a typed exact gap', async () => {
    const walls = [
      makeWall({ id: 'a' }),
      makeWall({
        id: 'b',
        vertices: [
          { x: 0, y: 50 },
          { x: 120, y: 50 },
        ],
        thickness_in: 4,
      }),
    ]
    const { store, tool } = await setup(walls)
    store.select([{ kind: 'wall', id: 'a' }])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 60, y: 6.5 })

    const chips = tool.preview.value.chips
    expect(chips).toHaveLength(1)
    expect(chips[0]?.side).toBe('right')
    expect(chips[0]?.active).toBe(true)
    // Wall a sits at y=6: its lower face y=7.75 to b's upper face y=48.
    expect(chips[0]?.distanceIn).toBeCloseTo(40.25)

    tool.handleKey('2')
    tool.handleKey('4')
    expect(tool.inputBuffer.value).toBe('24')
    expect(tool.handleKey('Enter')).toBe(true)

    expect(tool.isDragging.value).toBe(false)
    expect(store.document?.walls[0]?.vertices).toEqual([
      { x: 0, y: 22.25 },
      { x: 120, y: 22.25 },
    ])

    store.undo()
    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(store.canUndo).toBe(false)
  })

  it('translates every wall of a multi-selection on body drag, one undo step', async () => {
    const walls = [
      makeWall({ id: 'a' }),
      makeWall({
        id: 'b',
        vertices: [
          { x: 0, y: 100 },
          { x: 120, y: 100 },
        ],
      }),
    ]
    const { store, tool } = await setup(walls)
    store.select([
      { kind: 'wall', id: 'a' },
      { kind: 'wall', id: 'b' },
    ])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 70, y: 30.5 })
    tool.onPointerUp({ x: 70, y: 30.5 })

    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 10, y: 30 })
    expect(store.document?.walls[1]?.vertices[0]).toEqual({ x: 10, y: 130 })

    store.undo()
    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(store.document?.walls[1]?.vertices[0]).toEqual({ x: 0, y: 100 })
    expect(store.canUndo).toBe(false)
  })

  it('refuses a body drag when any selected wall has a locked segment', async () => {
    const walls = [
      makeWall({ id: 'a' }),
      makeWall({
        id: 'b',
        vertices: [
          { x: 0, y: 100 },
          { x: 120, y: 100 },
        ],
        locked_segments: [0],
      }),
    ]
    const { store, tool } = await setup(walls)
    store.select([
      { kind: 'wall', id: 'a' },
      { kind: 'wall', id: 'b' },
    ])

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 70, y: 30.5 })

    expect(tool.isDragging.value).toBe(false)
    expect(tool.preview.value.lockFlash?.wallId).toBe('b')
    expect(store.document?.walls[0]?.vertices[0]).toEqual({ x: 0, y: 0 })
  })

  it('selects an opening over its wall body on click', async () => {
    const { store, tool } = await setupDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'o1' })],
    })

    click(tool, 60, 0.5)
    expect(store.selectedOpeningIds).toEqual(new Set(['o1']))
    expect(store.selectedWallIds.size).toBe(0)

    // Outside the opening span the wall body still wins.
    click(tool, 10, 0.5)
    expect(store.selectedWallIds).toEqual(new Set(['wall-1']))
    expect(store.selectedOpeningIds.size).toBe(0)
  })

  it('slides an opening along its wall, clamped within the segment, one undo step', async () => {
    const { store, tool } = await setupDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'o1', t: 60, width_in: 32 })],
    })

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 100, y: 0.5 })
    expect(store.document?.openings[0]?.t).toBe(100)

    tool.onPointerMove({ x: 119, y: 0.5 })
    expect(store.document?.openings[0]?.t).toBe(104)
    tool.onPointerUp({ x: 119, y: 0.5 })

    store.undo()
    expect(store.document?.openings[0]?.t).toBe(60)
    expect(store.canUndo).toBe(false)
  })

  it('reassigns the opening to another segment when sliding across a corner', async () => {
    const wall = makeWall({
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
      ],
    })
    const { store, tool } = await setupDocument({
      walls: [wall],
      openings: [makeOpening({ id: 'o1', t: 60, width_in: 32 })],
    })

    tool.onPointerDown({ x: 60, y: 0.5 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 118, y: 60 })
    tool.onPointerUp({ x: 118, y: 60 })

    expect(store.document?.openings[0]?.segment_index).toBe(1)
    expect(store.document?.openings[0]?.t).toBe(60)
  })

  it('drags a dimension perpendicular to itself, adjusting its signed offset', async () => {
    const { store, tool } = await setupDocument({
      dimensions: [makeDimension({ id: 'd1', offset_in: 12 })],
    })

    tool.onPointerDown({ x: 60, y: -12 }, NO_MODIFIERS)
    expect(store.selectedDimensionIds).toEqual(new Set(['d1']))

    tool.onPointerMove({ x: 60, y: -30 })
    expect(store.document?.dimensions[0]?.offset_in).toBe(30)

    tool.onPointerMove({ x: 60, y: 10 })
    expect(store.document?.dimensions[0]?.offset_in).toBe(-10)
    tool.onPointerUp({ x: 60, y: 10 })

    store.undo()
    expect(store.document?.dimensions[0]?.offset_in).toBe(12)
    expect(store.canUndo).toBe(false)
  })

  it('translates stairs on body drag as a single undo step', async () => {
    const { store, tool } = await setupDocument({
      stairs: [makeStairs({ id: 's1', origin: { x: 200, y: 200 } })],
    })

    tool.onPointerDown({ x: 220, y: 220 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 250, y: 260 })
    tool.onPointerUp({ x: 250, y: 260 })

    expect(store.document?.stairs[0]?.origin).toEqual({ x: 230, y: 240 })
    store.undo()
    expect(store.document?.stairs[0]?.origin).toEqual({ x: 200, y: 200 })
    expect(store.canUndo).toBe(false)
  })

  it('selects and drags a label by its text box', async () => {
    const { store, tool } = await setupDocument({
      labels: [makeLabel({ id: 'l1', position: { x: 300, y: 300 } })],
    })

    tool.onPointerDown({ x: 305, y: 298 }, NO_MODIFIERS)
    expect(store.isSelected({ kind: 'label', id: 'l1' })).toBe(true)

    tool.onPointerMove({ x: 315, y: 310 })
    tool.onPointerUp({ x: 315, y: 310 })
    expect(store.document?.labels[0]?.position).toEqual({ x: 310, y: 312 })
  })

  it('includes openings, stairs, labels and dimensions in a rubber band', async () => {
    const { store, tool } = await setupDocument({
      walls: [makeWall()],
      openings: [makeOpening({ id: 'o1' })],
      stairs: [makeStairs({ id: 's1', origin: { x: 0, y: 200 } })],
      labels: [makeLabel({ id: 'l1', position: { x: 50, y: 300 } })],
      dimensions: [makeDimension({ id: 'd1', p1: { x: 0, y: 350 }, p2: { x: 120, y: 350 } })],
    })

    tool.onPointerDown({ x: -20, y: -60 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 400, y: 400 })
    tool.onPointerUp({ x: 400, y: 400 })

    expect(store.selection.size).toBe(5)
    expect(store.selectedOpeningIds).toEqual(new Set(['o1']))
    expect(store.selectedStairsIds).toEqual(new Set(['s1']))
    expect(store.selectedLabelIds).toEqual(new Set(['l1']))
    expect(store.selectedDimensionIds).toEqual(new Set(['d1']))
  })

  it('nudges stairs, labels and dimensions along with walls', async () => {
    const { store, tool } = await setupDocument({
      stairs: [makeStairs({ id: 's1', origin: { x: 200, y: 200 } })],
      labels: [makeLabel({ id: 'l1', position: { x: 300, y: 300 } })],
      dimensions: [makeDimension({ id: 'd1' })],
    })
    store.select([
      { kind: 'stairs', id: 's1' },
      { kind: 'label', id: 'l1' },
      { kind: 'dimension', id: 'd1' },
    ])

    expect(tool.nudge(1, 0, false)).toBe(true)
    expect(store.document?.stairs[0]?.origin).toEqual({ x: 201, y: 200 })
    expect(store.document?.labels[0]?.position).toEqual({ x: 301, y: 300 })
    expect(store.document?.dimensions[0]?.p1).toEqual({ x: 1, y: 0 })
    expect(store.document?.dimensions[0]?.p2).toEqual({ x: 121, y: 0 })

    store.undo()
    expect(store.document?.stairs[0]?.origin).toEqual({ x: 200, y: 200 })
    expect(store.canUndo).toBe(false)
  })

  /** A free horizontal guide 50" below the wall, crossing the whole plan (spec S9). */
  const GUIDE: Guide = { id: 'g1', kind: 'free', origin: { x: 0, y: 50 }, angle_deg: 0 }

  it('selects a guide only where nothing else was clicked, and deletes it (spec S9)', async () => {
    const { store, tool } = await setupDocument({ walls: [makeWall({ id: 'a' })], guides: [GUIDE] })

    // The guide crosses the plan, so over the wall the wall still wins.
    click(tool, 60, 0.5)
    expect(store.selectedWallIds).toEqual(new Set(['a']))

    // 1" off the guide line; at 2 px/in the 6 px click radius is 3".
    click(tool, 60, 51)
    expect([...store.selection.values()]).toEqual([{ kind: 'guide', id: 'g1' }])

    // 10" off it: out of reach, so the click clears the selection instead.
    click(tool, 60, 60)
    expect(store.selection.size).toBe(0)

    click(tool, 60, 51)
    store.deleteSelection()
    expect(store.document?.guides).toEqual([])
    expect(store.selection.size).toBe(0)

    store.undo()
    expect(store.document?.guides).toEqual([GUIDE])
  })

  const IMAGE_SIZE: ImageSize = { width: 200, height: 200 }
  const underlayRef = { kind: 'underlay', id: UNDERLAY_ELEMENT_ID } as const

  it('selects the underlay only where nothing else sits, at lowest hit priority', async () => {
    const { store, tool } = await setupDocument(
      { walls: [makeWall({ id: 'a' })], underlay: makeUnderlay() },
      IMAGE_SIZE,
    )

    // Over both the wall and the underlay: the wall wins (underlay is lowest).
    click(tool, 60, 0.5)
    expect(store.selectedWallIds).toEqual(new Set(['a']))
    expect(store.isSelected(underlayRef)).toBe(false)

    // Over the underlay only.
    click(tool, 150, 150)
    expect(store.isSelected(underlayRef)).toBe(true)
  })

  it('does not hit the underlay when it is locked or hidden', async () => {
    const locked = await setupDocument({ underlay: makeUnderlay({ locked: true }) }, IMAGE_SIZE)
    click(locked.tool, 150, 150)
    expect(locked.store.isSelected(underlayRef)).toBe(false)

    const hidden = await setupDocument({ underlay: makeUnderlay({ visible: false }) }, IMAGE_SIZE)
    click(hidden.tool, 150, 150)
    expect(hidden.store.isSelected(underlayRef)).toBe(false)
  })

  it('translates an unlocked underlay by a body drag as a single undo step', async () => {
    const { store, tool } = await setupDocument({ underlay: makeUnderlay() }, IMAGE_SIZE)

    tool.onPointerDown({ x: 150, y: 150 }, NO_MODIFIERS)
    expect(store.isSelected(underlayRef)).toBe(true)
    tool.onPointerMove({ x: 170, y: 160 })
    tool.onPointerUp({ x: 170, y: 160 })
    expect(store.document?.underlay?.transform.origin).toEqual({ x: 20, y: 10 })

    store.undo()
    expect(store.document?.underlay?.transform.origin).toEqual({ x: 0, y: 0 })
    expect(store.canUndo).toBe(false)
  })

  it('shows the rotation handle only while the unlocked underlay is selected', async () => {
    const { store, tool } = await setupDocument({ underlay: makeUnderlay() }, IMAGE_SIZE)
    expect(tool.preview.value.underlayRotationHandle).toBeNull()

    click(tool, 150, 150)
    // 24 screen px at 2 px/in = 12" above the top-centre of the 200x200 image.
    const handle = tool.preview.value.underlayRotationHandle
    expect(handle?.anchor.x).toBeCloseTo(100, 9)
    expect(handle?.anchor.y).toBeCloseTo(0, 9)
    expect(handle?.point.x).toBeCloseTo(100, 9)
    expect(handle?.point.y).toBeCloseTo(-12, 9)

    store.mutate({ type: 'setUnderlay', underlay: makeUnderlay({ locked: true }) })
    expect(tool.preview.value.underlayRotationHandle).toBeNull()
  })

  it('rotates the underlay about its centre by dragging the handle, as one undo step', async () => {
    const { store, tool } = await setupDocument({ underlay: makeUnderlay() }, IMAGE_SIZE)
    click(tool, 150, 150)

    // Grab the handle at (100, -12) and drag due east of the centre: +90°.
    tool.onPointerDown({ x: 100, y: -12 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 250, y: 100 })
    tool.onPointerUp({ x: 250, y: 100 })

    const transform = store.document?.underlay?.transform
    expect(transform?.rotation_deg).toBe(90)
    // The image centre stayed fixed while rotating.
    const centre = transform ? underlayToWorld(transform, { x: 100, y: 100 }) : null
    expect(centre?.x).toBeCloseTo(100, 6)
    expect(centre?.y).toBeCloseTo(100, 6)

    store.undo()
    expect(store.document?.underlay?.transform.rotation_deg).toBe(0)
    expect(store.canUndo).toBe(false)
  })

  it('snaps handle rotation to 15° while angle snap is on and Escape cancels it', async () => {
    const { store, tool } = await setupDocument({ underlay: makeUnderlay() }, IMAGE_SIZE)
    click(tool, 150, 150)

    // Drag the handle to 50° clockwise of its grab angle: snaps to 45.
    const rad = ((-90 + 50) * Math.PI) / 180
    const target = { x: 100 + 150 * Math.cos(rad), y: 100 + 150 * Math.sin(rad) }
    tool.onPointerDown({ x: 100, y: -12 }, NO_MODIFIERS)
    tool.onPointerMove(target)
    expect(store.document?.underlay?.transform.rotation_deg).toBe(45)

    tool.handleKey('Escape')
    expect(store.document?.underlay?.transform.rotation_deg).toBe(0)
    expect(store.document?.underlay?.transform.origin).toEqual({ x: 0, y: 0 })
    expect(store.canUndo).toBe(false)
  })

  it('rotates the underlay freely when angle snapping is off', async () => {
    snapSettings.angle.value = false
    const { store, tool } = await setupDocument({ underlay: makeUnderlay() }, IMAGE_SIZE)
    click(tool, 150, 150)

    const rad = ((-90 + 50) * Math.PI) / 180
    tool.onPointerDown({ x: 100, y: -12 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 100 + 150 * Math.cos(rad), y: 100 + 150 * Math.sin(rad) })
    tool.onPointerUp({ x: 100 + 150 * Math.cos(rad), y: 100 + 150 * Math.sin(rad) })

    expect(store.document?.underlay?.transform.rotation_deg).toBeCloseTo(50, 6)
  })

  it('slides an attached device along its wall and flips side across the wall', async () => {
    const wall = makeWall({ id: 'w' })
    const device = makeDevice({
      id: 'd1',
      attachment: { wall_id: 'w', segment_index: 0, t: 60, side: 'left' },
    })
    const { store, tool } = await setupDocument({ walls: [wall], devices: [device] })

    tool.onPointerDown({ x: 60, y: -4 }, NO_MODIFIERS)
    expect(store.selectedDeviceIds).toEqual(new Set(['d1']))
    tool.onPointerMove({ x: 90, y: 4 })
    tool.onPointerUp({ x: 90, y: 4 })

    const updated = store.document?.devices[0]
    expect(updated?.attachment?.t).toBeCloseTo(90, 6)
    expect(updated?.attachment?.side).toBe('right')

    store.undo()
    expect(store.document?.devices[0]?.attachment).toEqual({
      wall_id: 'w',
      segment_index: 0,
      t: 60,
      side: 'left',
    })
  })

  it('carries a sliding device across a corner into the next segment', async () => {
    const wall = makeWall({
      id: 'w',
      vertices: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 120 },
      ],
    })
    const device = makeDevice({
      id: 'd1',
      attachment: { wall_id: 'w', segment_index: 0, t: 60, side: 'left' },
    })
    const { store, tool } = await setupDocument({ walls: [wall], devices: [device] })

    tool.onPointerDown({ x: 60, y: -4 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 116, y: 60 })
    tool.onPointerUp({ x: 116, y: 60 })

    expect(store.document?.devices[0]?.attachment?.segment_index).toBe(1)
    expect(store.document?.devices[0]?.attachment?.t).toBeCloseTo(60, 6)
  })

  it('shows temporary dimensions while sliding an attached device (spec S2a)', async () => {
    const wall = makeWall({ id: 'w' })
    const device = makeDevice({
      id: 'd1',
      attachment: { wall_id: 'w', segment_index: 0, t: 60, side: 'left' },
    })
    const { tool } = await setupDocument({ walls: [wall], devices: [device] })

    tool.onPointerDown({ x: 60, y: -4 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 90, y: -4 })

    const chips = tool.preview.value.chips
    expect(chips).toHaveLength(2)
    expect(chips.find((chip) => chip.side === 'left')?.distanceIn).toBeCloseTo(90, 6)
    expect(chips.find((chip) => chip.side === 'right')?.distanceIn).toBeCloseTo(30, 6)
  })

  it('body-drags positioned devices but leaves attached ones on their wall', async () => {
    const wall = makeWall({ id: 'w' })
    const attached = makeDevice({
      id: 'd1',
      attachment: { wall_id: 'w', segment_index: 0, t: 60, side: 'left' },
    })
    const free = makeDevice({
      id: 'd2',
      type: 'ceiling_light',
      attachment: null,
      position: { x: 200, y: 200 },
    })
    const { store, tool } = await setupDocument({ walls: [wall], devices: [attached, free] })
    store.select([
      { kind: 'device', id: 'd1' },
      { kind: 'device', id: 'd2' },
    ])

    tool.onPointerDown({ x: 200, y: 200 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 220, y: 210 })
    tool.onPointerUp({ x: 220, y: 210 })

    expect(store.document?.devices.find((d) => d.id === 'd2')?.position).toEqual({ x: 220, y: 210 })
    expect(store.document?.devices.find((d) => d.id === 'd1')?.attachment?.t).toBe(60)
  })

  async function wireDocument() {
    const from = makeDevice({ id: 'a', attachment: null, position: { x: 0, y: 0 } })
    const to = makeDevice({ id: 'b', attachment: null, position: { x: 120, y: 0 } })
    const wire = makeWire({
      id: 'wire-1',
      circuit_id: 'c',
      from_device_id: 'a',
      to_device_id: 'b',
      control_points: [
        { x: 40, y: -18 },
        { x: 80, y: -18 },
      ],
    })
    return setupDocument({
      circuits: [makeCircuit({ id: 'c' })],
      devices: [from, to],
      wires: [wire],
    })
  }

  it('selects a wire by clicking near its Bézier curve (spec W2)', async () => {
    const { store, tool } = await wireDocument()
    // Curve peak sits near (60, -13.5); click within the hit radius.
    click(tool, 60, -13)
    expect(store.isSelected({ kind: 'wire', id: 'wire-1' })).toBe(true)
  })

  it('drags a control-point handle of the selected wire, transactioned (spec W2)', async () => {
    const { store, tool } = await wireDocument()
    store.select([{ kind: 'wire', id: 'wire-1' }])

    tool.onPointerDown({ x: 40, y: -18 }, NO_MODIFIERS)
    tool.onPointerMove({ x: 40, y: -60 })
    tool.onPointerUp({ x: 40, y: -60 })

    expect(store.document?.wires[0]?.control_points[0]).toEqual({ x: 40, y: -60 })
    // Second handle untouched.
    expect(store.document?.wires[0]?.control_points[1]).toEqual({ x: 80, y: -18 })

    store.undo()
    expect(store.document?.wires[0]?.control_points[0]).toEqual({ x: 40, y: -18 })
  })
})
