import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import UnderlayPanel from '@/components/editor/UnderlayPanel.vue'
import { useEditorStore } from '@/stores/editor'
import type { Underlay } from '@/types/plan'
import { makeDocument, makeUnderlay } from '../helpers/planFactory'

/** Mounts the panel over a plan carrying `underlay` (null = nothing imported yet). */
function mountPanel(underlay: Underlay | null): VueWrapper {
  useEditorStore().document = makeDocument({ underlay })
  return mount(UnderlayPanel, { props: { underlayImageSize: null } })
}

describe('UnderlayPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('offers the import dropzone and nothing else while no underlay is set (spec U1)', () => {
    const wrapper = mountPanel(null)

    expect(wrapper.text()).toContain('Import a JPEG/PNG to trace')
    expect(wrapper.find('input[aria-label="Underlay image file"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Underlay opacity"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Hide underlay"]').exists()).toBe(false)
  })

  it('shows the full control set once an underlay is present (spec U3/§6.1)', () => {
    const wrapper = mountPanel(
      makeUnderlay({ transform: { origin: { x: 0, y: 0 }, rotation_deg: 0, scale: 0.5 } }),
    )

    expect(wrapper.find('[aria-label="Underlay opacity"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Underlay rotation in degrees"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="Underlay scale"]').text()).toContain('0.500')
    expect(wrapper.find('[aria-label="Underlay origin"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Recalibrate')
    expect(wrapper.text()).toContain('Remove')
    expect(wrapper.text()).not.toContain('Import a JPEG/PNG to trace')
  })

  it('toggles visibility and lock straight into the document', async () => {
    const wrapper = mountPanel(makeUnderlay())
    const store = useEditorStore()

    await wrapper.get('[aria-label="Hide underlay"]').trigger('click')
    expect(store.document?.underlay?.visible).toBe(false)

    await wrapper.get('[aria-label="Lock underlay"]').trigger('click')
    expect(store.document?.underlay?.locked).toBe(true)
    expect(wrapper.get('[aria-label="Show underlay"]').attributes('aria-pressed')).toBe('false')
  })

  it('writes the opacity slider through as a fraction', async () => {
    const wrapper = mountPanel(makeUnderlay())
    const store = useEditorStore()

    await wrapper.get('[aria-label="Underlay opacity"]').setValue('75')

    expect(store.document?.underlay?.opacity).toBeCloseTo(0.75)
  })

  it('emits recalibrate for the page to arm the Calibrate tool (spec U2)', async () => {
    const wrapper = mountPanel(makeUnderlay())
    const recalibrate = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Recalibrate'))

    await recalibrate?.trigger('click')

    expect(wrapper.emitted('recalibrate')).toHaveLength(1)
  })

  it('removes the underlay from the document', async () => {
    const wrapper = mountPanel(makeUnderlay())
    const store = useEditorStore()
    const remove = wrapper.findAll('button').find((button) => button.text().includes('Remove'))

    await remove?.trigger('click')

    expect(store.document?.underlay).toBeNull()
  })
})
