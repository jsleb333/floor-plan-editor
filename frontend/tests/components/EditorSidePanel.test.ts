import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import CircuitsPanel from '@/components/editor/CircuitsPanel.vue'
import DeviceToolOptions from '@/components/editor/DeviceToolOptions.vue'
import EditorSidePanel from '@/components/editor/EditorSidePanel.vue'
import InspectorOverviewPanel from '@/components/editor/InspectorOverviewPanel.vue'
import OpeningInspector from '@/components/editor/OpeningInspector.vue'
import OpeningToolOptions from '@/components/editor/OpeningToolOptions.vue'
import StairsInspector from '@/components/editor/StairsInspector.vue'
import StairsToolOptions from '@/components/editor/StairsToolOptions.vue'
import StructureOverviewPanel from '@/components/editor/StructureOverviewPanel.vue'
import ToolPlacementHint from '@/components/editor/ToolPlacementHint.vue'
import UnderlayPanel from '@/components/editor/UnderlayPanel.vue'
import WallInspector from '@/components/editor/WallInspector.vue'
import WallToolOptions from '@/components/editor/WallToolOptions.vue'
import type { DeviceDraft } from '@/composables/useDeviceTool'
import { useEditorStore } from '@/stores/editor'
import {
  makeDevice,
  makeDocument,
  makeOpening,
  makeStairs,
  makeUnderlay,
  makeWall,
} from '../helpers/planFactory'

const EMPTY_DEVICE_DRAFT: DeviceDraft = {
  label: null,
  load_w: null,
  length_in: null,
  depth_in: null,
}

/** Complete prop set for an idle panel (Structure mode, select tool, empty selection). */
function baseProps() {
  return {
    activeTool: 'select' as const,
    activeMode: 'structure' as const,
    planName: 'Basement',
    planDescription: '',
    displayPrecisionIn: null,
    wallThicknessPresetsIn: [12, 4.5, 3.5],
    wallThicknessIn: 3.5,
    wallReference: 'center' as const,
    wallColor: null,
    openingWidthIn: 32,
    openingWidthPresetsIn: [24, 28, 30, 32, 36],
    openingStyle: 'swing' as const,
    openingHinge: 'left' as const,
    openingSwing: 'in' as const,
    stairsWidthIn: 36,
    stairsWidthPresetsIn: [30, 36, 42, 48],
    stairsDirection: 'up' as const,
    walls: [makeWall()],
    selectedWalls: [],
    selectedOpenings: [],
    selectedStairs: [],
    selectedLabels: [],
    selectedDimensions: [],
    selectedDevices: [],
    selectedWires: [],
    selectedGuides: [],
    allDevices: [],
    circuits: [],
    controlLinks: [],
    armedControlLinkSwitchId: null,
    selectedUnderlay: null,
    underlayImageSize: null,
    deviceArmedType: null,
    deviceDraft: EMPTY_DEVICE_DRAFT,
    catalogDefaults: {},
  }
}

describe('EditorSidePanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useEditorStore().document = makeDocument()
  })

  it('is one contextual panel — no tab bar, no navigation (spec §6.1)', () => {
    const wrapper = mount(EditorSidePanel, { props: baseProps() })

    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
  })

  it('shows the door tool options and hint while the door tool is armed with no selection', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'door' },
    })

    const options = wrapper.findComponent(OpeningToolOptions)
    expect(options.props('kind')).toBe('door')
    expect(options.props('widthIn')).toBe(32)
    expect(options.props('presetsIn')).toEqual([24, 28, 30, 32, 36])
    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Door')
    expect(wrapper.findComponent(OpeningInspector).exists()).toBe(false)
  })

  it('relays add-width-preset from the opening tool options as add-opening-width-preset', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'door' },
    })

    wrapper.findComponent(OpeningToolOptions).vm.$emit('add-width-preset', 54)

    expect(wrapper.emitted('add-opening-width-preset')).toEqual([[54]])
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
    expect(options.props('presetsIn')).toEqual([30, 36, 42, 48])
    expect(options.props('direction')).toBe('down')
    expect(wrapper.findComponent(ToolPlacementHint).props('title')).toBe('Stairs')
    expect(wrapper.findComponent(StairsInspector).props('stairs')).toEqual(stairs)
  })

  it('relays add-width-preset from the stairs tool options as add-stairs-width-preset', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'stairs' as const },
    })

    wrapper.findComponent(StairsToolOptions).vm.$emit('add-width-preset', 60)

    expect(wrapper.emitted('add-stairs-width-preset')).toEqual([[60]])
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

  it('keeps the select tool behaviour: inspector only, no tool hint, no overview', () => {
    const door = makeOpening()
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), selectedOpenings: [door] },
    })

    expect(wrapper.findComponent(ToolPlacementHint).exists()).toBe(false)
    expect(wrapper.findComponent(OpeningInspector).exists()).toBe(true)
    expect(wrapper.findComponent(StructureOverviewPanel).exists()).toBe(false)
  })

  it('inspects a selected underlay with the same underlay panel the Calibrate tool shows', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), selectedUnderlay: makeUnderlay() },
    })

    expect(wrapper.findComponent(UnderlayPanel).exists()).toBe(true)
    expect(wrapper.findComponent(StructureOverviewPanel).exists()).toBe(false)
  })

  it('shows wall options without a wall inspector while the wall tool is armed', () => {
    const wall = makeWall()
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'wall', selectedWalls: [wall] },
    })

    expect(wrapper.findComponent(WallToolOptions).exists()).toBe(true)
    expect(wrapper.findComponent(WallInspector).exists()).toBe(false)
  })

  it('shows the device picker while the device tool is armed with no type picked', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'device' as const, activeMode: 'electrical' as const },
    })

    expect(wrapper.find('[aria-label="Device picker"]').exists()).toBe(true)
    expect(wrapper.findComponent(DeviceToolOptions).exists()).toBe(false)
  })

  it('shows the device tool options and hint above the device inspector once a type is armed', () => {
    const device = makeDevice({ type: 'outlet' })
    const draft: DeviceDraft = { label: null, load_w: 200, length_in: null, depth_in: null }
    const wrapper = mount(EditorSidePanel, {
      props: {
        ...baseProps(),
        activeTool: 'device' as const,
        activeMode: 'electrical' as const,
        deviceArmedType: 'outlet' as const,
        deviceDraft: draft,
        catalogDefaults: { outlet: 240 },
        selectedDevices: [device],
      },
    })

    expect(wrapper.find('[aria-label="Device picker"]').exists()).toBe(false)
    const options = wrapper.findComponent(DeviceToolOptions)
    expect(options.props('type')).toBe('outlet')
    expect(options.props('draft')).toEqual(draft)
    expect(options.props('catalogDefaults')).toEqual({ outlet: 240 })
    expect(wrapper.findComponent(ToolPlacementHint).exists()).toBe(true)
  })

  it('relays update-draft from the device tool options as update-device-draft', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'device' as const, deviceArmedType: 'outlet' as const },
    })

    wrapper.findComponent(DeviceToolOptions).vm.$emit('update-draft', { load_w: 300 })

    expect(wrapper.emitted('update-device-draft')).toEqual([[{ load_w: 300 }]])
  })

  it('relays change-device from the device tool options', () => {
    const wrapper = mount(EditorSidePanel, {
      props: { ...baseProps(), activeTool: 'device' as const, deviceArmedType: 'outlet' as const },
    })

    wrapper.findComponent(DeviceToolOptions).vm.$emit('change-device')

    expect(wrapper.emitted('change-device')).toHaveLength(1)
  })

  describe('tool options (spec §6.1)', () => {
    it('gives the wire tool the circuits list and a hint naming the digit shortcut', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), activeTool: 'wire' as const, activeMode: 'electrical' as const },
      })

      expect(wrapper.findComponent(CircuitsPanel).exists()).toBe(true)
      const hint = wrapper.findComponent(ToolPlacementHint)
      expect(hint.props('title')).toBe('Wire')
      expect(hint.props('lines').join(' ')).toContain('1–9')
    })

    it('gives the calibrate tool the underlay controls', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), activeTool: 'calibrate' as const },
      })

      expect(wrapper.findComponent(UnderlayPanel).exists()).toBe(true)
      expect(wrapper.findComponent(StructureOverviewPanel).exists()).toBe(false)
    })

    it('relays recalibrate from the underlay controls', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), activeTool: 'calibrate' as const },
      })

      wrapper.findComponent(UnderlayPanel).vm.$emit('recalibrate')

      expect(wrapper.emitted('recalibrate')).toHaveLength(1)
    })
  })

  describe('mode overview (spec §6.1)', () => {
    it('shows the Structure overview under Select with nothing selected', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), wallThicknessPresetsIn: [12, 6] },
      })

      const overview = wrapper.findComponent(StructureOverviewPanel)
      expect(overview.props('thicknessPresetsIn')).toEqual([12, 6])
      expect(wrapper.findComponent(InspectorOverviewPanel).exists()).toBe(false)
    })

    it('relays the Structure overview preset edits and recalibrate to the page', () => {
      const wrapper = mount(EditorSidePanel, { props: baseProps() })
      const overview = wrapper.findComponent(StructureOverviewPanel)

      overview.vm.$emit('set-thickness-presets', [12, 6])
      overview.vm.$emit('recalibrate')

      expect(wrapper.emitted('set-thickness-presets')).toEqual([[[12, 6]]])
      expect(wrapper.emitted('recalibrate')).toHaveLength(1)
    })

    it('shows the circuits list — the very component the Wire tool arms — in Electrical mode', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), activeMode: 'electrical' as const },
      })

      expect(wrapper.findComponent(CircuitsPanel).exists()).toBe(true)
      expect(wrapper.findComponent(StructureOverviewPanel).exists()).toBe(false)
    })

    it('shows the plan settings, layers and export in Inspector mode', () => {
      const wrapper = mount(EditorSidePanel, {
        props: {
          ...baseProps(),
          activeMode: 'inspector' as const,
          planName: 'Basement',
          displayPrecisionIn: 0.25,
        },
      })

      const overview = wrapper.findComponent(InspectorOverviewPanel)
      expect(overview.props('planName')).toBe('Basement')
      expect(overview.props('displayPrecisionIn')).toBe(0.25)
    })

    it('relays the Inspector overview edits and its export request to the page', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), activeMode: 'inspector' as const },
      })
      const overview = wrapper.findComponent(InspectorOverviewPanel)

      overview.vm.$emit('rename', 'Cellar')
      overview.vm.$emit('update-description', 'Reno 2026')
      overview.vm.$emit('set-display-precision', 0.5)
      overview.vm.$emit('export')

      expect(wrapper.emitted('rename')).toEqual([['Cellar']])
      expect(wrapper.emitted('update-description')).toEqual([['Reno 2026']])
      expect(wrapper.emitted('set-display-precision')).toEqual([[0.5]])
      expect(wrapper.emitted('export')).toHaveLength(1)
    })

    it('yields to a selection: the inspector replaces the overview', () => {
      const wrapper = mount(EditorSidePanel, {
        props: { ...baseProps(), selectedWalls: [makeWall()] },
      })

      expect(wrapper.findComponent(StructureOverviewPanel).exists()).toBe(false)
      expect(wrapper.findComponent(WallInspector).exists()).toBe(true)
    })
  })
})
