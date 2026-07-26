import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import EditorSidePanel from '@/components/editor/EditorSidePanel.vue'
import OpeningInspector from '@/components/editor/OpeningInspector.vue'
import OpeningToolOptions from '@/components/editor/OpeningToolOptions.vue'
import PlanSettingsPanel from '@/components/editor/PlanSettingsPanel.vue'
import StairsInspector from '@/components/editor/StairsInspector.vue'
import StairsToolOptions from '@/components/editor/StairsToolOptions.vue'
import ToolPlacementHint from '@/components/editor/ToolPlacementHint.vue'
import WallInspector from '@/components/editor/WallInspector.vue'
import WallToolOptions from '@/components/editor/WallToolOptions.vue'
import { makeOpening, makeStairs, makeWall } from '../helpers/planFactory'

/** Complete prop set for an idle panel (select tool, empty selection). */
function baseProps() {
  return {
    activeTool: 'select' as const,
    planName: 'Basement',
    planDescription: '',
    displayPrecisionIn: null,
    wallThicknessPresetsIn: [12, 4.5, 3.5],
    wallThicknessIn: 3.5,
    wallReference: 'center' as const,
    openingWidthIn: 32,
    openingHinge: 'left' as const,
    openingSwing: 'in' as const,
    stairsWidthIn: 36,
    stairsDirection: 'up' as const,
    walls: [makeWall()],
    selectedWalls: [],
    selectedOpenings: [],
    selectedStairs: [],
    selectedLabels: [],
    selectedDimensions: [],
    selectedDevices: [],
    selectedWires: [],
    allDevices: [],
    circuits: [],
    controlLinks: [],
    armedControlLinkSwitchId: null,
    requestedTab: null,
    selectedUnderlay: null,
    underlayImageSize: null,
    deviceArmedType: null,
    catalogDefaults: {},
  }
}

describe('EditorSidePanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows the door tool options and hint while the door tool is armed with no selection', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'door' },
    })

    const options = wrapper.findComponent(OpeningToolOptions)
    expect(options.props('kind')).toBe('door')
    expect(options.props('widthIn')).toBe(32)
    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Door')
    expect(wrapper.findComponent(OpeningInspector).exists()).toBe(false)
  })

  it('shows the window tool options while the window tool is armed', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'window' },
    })

    expect(wrapper.findComponent(OpeningToolOptions).props('kind')).toBe('window')
    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Window')
  })

  it('shows the stairs tool options above the stairs inspector while the stairs tool is armed', () => {
    const stairs = makeStairs()
    const wrapper = mount(EditorSidePanel, {
      props: {
        ...baseProps(),
        activeTool: 'stairs' as const,
        stairsWidthIn: 42,
        stairsDirection: 'down' as const,
        selectedStairs: [stairs],
      },
    })

    const options = wrapper.findComponent(StairsToolOptions)
    expect(options.props('widthIn')).toBe(42)
    expect(options.props('direction')).toBe('down')
    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Stairs')
    expect(wrapper.findComponent(StairsInspector).props('stairs')).toEqual(stairs)
  })

  it('stacks the door hint above the opening inspector when a door is selected in-tool', () => {
    const door = makeOpening()
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'door', selectedOpenings: [door] },
    })

    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Door')
    const inspector = wrapper.findComponent(OpeningInspector)
    expect(inspector.exists()).toBe(true)
    expect(inspector.props('opening')).toEqual(door)
  })

  it('does not inspect an opening of the other kind under the door tool', () => {
    const window = makeOpening({ kind: 'window' })
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'door', selectedOpenings: [window] },
    })

    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Door')
    expect(wrapper.findComponent(OpeningInspector).exists()).toBe(false)
  })

  it('does not inspect a selection of another kind under a placement tool', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'door', selectedStairs: [makeStairs()] },
    })

    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Door')
    expect(wrapper.findComponent(StairsInspector).exists()).toBe(false)
  })

  it('keeps the select tool behaviour: inspector only, no tool hint', () => {
    const door = makeOpening()
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), selectedOpenings: [door] },
    })

    expect(wrapper.findComponent(ToolPlacementHint).exists()).toBe(false)
    expect(wrapper.findComponent(OpeningInspector).exists()).toBe(true)
    expect(wrapper.findComponent(PlanSettingsPanel).exists()).toBe(false)
  })

  it('shows the plan settings when the select tool is active with nothing selected', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), planName: 'Basement', displayPrecisionIn: 0.25 },
    })

    const settings = wrapper.findComponent(PlanSettingsPanel)
    expect(settings.props('planName')).toBe('Basement')
    expect(settings.props('displayPrecisionIn')).toBe(0.25)
    expect(settings.props('thicknessPresetsIn')).toEqual([12, 4.5, 3.5])
  })

  it('relays the plan settings edits to the page', () => {
    const wrapper = mount(EditorSidePanel, { props: baseProps() })
    const settings = wrapper.findComponent(PlanSettingsPanel)

    settings.vm.$emit('rename', 'Cellar')
    settings.vm.$emit('update-description', 'Reno 2026')
    settings.vm.$emit('set-thickness-presets', [12, 6])
    settings.vm.$emit('set-display-precision', 0.5)

    expect(wrapper.emitted('rename')).toEqual([['Cellar']])
    expect(wrapper.emitted('update-description')).toEqual([['Reno 2026']])
    expect(wrapper.emitted('set-thickness-presets')).toEqual([[[12, 6]]])
    expect(wrapper.emitted('set-display-precision')).toEqual([[0.5]])
  })

  it('keeps the placeholder — not the plan settings — for the calibrate tool with no selection', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'calibrate' as const },
    })

    expect(wrapper.findComponent(PlanSettingsPanel).exists()).toBe(false)
    expect(wrapper.text()).toContain('Select an element to edit its properties.')
  })

  it('shows wall options without a wall inspector while the wall tool is armed', () => {
    const wall = makeWall()
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'wall', selectedWalls: [wall] },
    })

    expect(wrapper.findComponent(WallToolOptions).exists()).toBe(true)
    expect(wrapper.findComponent(WallInspector).exists()).toBe(false)
  })
})
