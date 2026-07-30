import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import InspectorOverviewPanel from '@/components/editor/InspectorOverviewPanel.vue'
import PlanSettingsPanel from '@/components/editor/PlanSettingsPanel.vue'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Underlay } from '@/types/plan'
import { makeDocument, makeUnderlay } from '../helpers/planFactory'

/** Mounts the Inspector home over a plan carrying `underlay` (null = none imported). */
function mountPanel(underlay: Underlay | null = null): VueWrapper {
  useEditorStore().document = makeDocument({ underlay })
  return mount(InspectorOverviewPanel, {
    props: { planName: 'Basement', planDescription: 'Reno 2026', displayPrecisionIn: 0.25 },
  })
}

describe('InspectorOverviewPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('is the Inspector home: plan settings, whole-plan layers and export (spec §6.1/E7)', () => {
    const wrapper = mountPanel()

    const settings = wrapper.findComponent(PlanSettingsPanel)
    expect(settings.props('planName')).toBe('Basement')
    expect(settings.props('displayPrecisionIn')).toBe(0.25)
    for (const label of ['Hide structure', 'Hide devices', 'Hide annotations']) {
      expect(wrapper.find(`[aria-label="${label}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[aria-label="Export plan"]').exists()).toBe(true)
  })

  it('keeps the wall thickness presets out — they belong to the Structure home', () => {
    expect(mountPanel().text()).not.toContain('Wall thickness presets')
  })

  it('flips whole-plan layer visibility in the layers store', async () => {
    const wrapper = mountPanel()
    const layers = useLayersStore()

    await wrapper.get('[aria-label="Hide devices"]').trigger('click')

    expect(layers.devicesVisible).toBe(false)
    expect(layers.structureVisible).toBe(true)
    expect(wrapper.get('[aria-label="Show devices"]').attributes('aria-pressed')).toBe('false')
  })

  it('offers no underlay row until the plan has one, then drives the document flag', async () => {
    expect(mountPanel().find('[aria-label="Hide underlay"]').exists()).toBe(false)

    const wrapper = mountPanel(makeUnderlay())
    const store = useEditorStore()

    await wrapper.get('[aria-label="Hide underlay"]').trigger('click')

    expect(store.document?.underlay?.visible).toBe(false)
  })

  it('relays the plan settings edits', () => {
    const wrapper = mountPanel()
    const settings = wrapper.findComponent(PlanSettingsPanel)

    settings.vm.$emit('rename', 'Cellar')
    settings.vm.$emit('update-description', 'Reno 2027')
    settings.vm.$emit('set-display-precision', 0.5)

    expect(wrapper.emitted('rename')).toEqual([['Cellar']])
    expect(wrapper.emitted('update-description')).toEqual([['Reno 2027']])
    expect(wrapper.emitted('set-display-precision')).toEqual([[0.5]])
  })

  it('emits export from the export button (spec X4)', async () => {
    const wrapper = mountPanel()

    await wrapper.get('[aria-label="Export plan"]').trigger('click')

    expect(wrapper.emitted('export')).toHaveLength(1)
  })
})
