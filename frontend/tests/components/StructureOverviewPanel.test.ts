import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import StructureOverviewPanel from '@/components/editor/StructureOverviewPanel.vue'
import UnderlayPanel from '@/components/editor/UnderlayPanel.vue'
import { useEditorStore } from '@/stores/editor'
import { makeDocument, makeUnderlay } from '../helpers/planFactory'

describe('StructureOverviewPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useEditorStore().document = makeDocument({ underlay: makeUnderlay() })
  })

  it('is the Structure home: underlay controls on top, thickness presets below (spec §6.1)', () => {
    const wrapper = mount(StructureOverviewPanel, {
      props: { thicknessPresetsIn: [12, 4.5, 3.5], underlayImageSize: null },
    })

    expect(wrapper.findComponent(UnderlayPanel).exists()).toBe(true)
    expect(wrapper.text()).toContain('Wall thickness presets')
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="Thickness preset 1"]').element.value,
    ).toBe('12"')
  })

  it('emits the edited preset list', async () => {
    const wrapper = mount(StructureOverviewPanel, {
      props: { thicknessPresetsIn: [12, 4.5, 3.5], underlayImageSize: null },
    })
    const first = wrapper.get('input[aria-label="Thickness preset 1"]')

    await first.setValue(`8"`)
    await first.trigger('blur')

    expect(wrapper.emitted('set-thickness-presets')).toEqual([[[8, 4.5, 3.5]]])
  })

  it('forwards recalibrate from the underlay controls', () => {
    const wrapper = mount(StructureOverviewPanel, {
      props: { thicknessPresetsIn: [12], underlayImageSize: null },
    })

    wrapper.findComponent(UnderlayPanel).vm.$emit('recalibrate')

    expect(wrapper.emitted('recalibrate')).toHaveLength(1)
  })
})
