import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import DeviceToolOptions from '@/components/editor/DeviceToolOptions.vue'
import type { DeviceDraft } from '@/composables/useDeviceTool'
import type { DeviceType } from '@/types/plan'

const EMPTY_DRAFT: DeviceDraft = { label: null, load_w: null, length_in: null }

interface OptionsProps {
  type: DeviceType
  draft: DeviceDraft
  catalogDefaults: Record<string, number>
}

function mountOptions(overrides: Partial<OptionsProps> = {}): VueWrapper {
  const props: OptionsProps = { type: 'outlet', draft: EMPTY_DRAFT, catalogDefaults: {} }
  return mount(DeviceToolOptions, { props: { ...props, ...overrides } })
}

describe('DeviceToolOptions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows the armed type name and glyph', () => {
    const wrapper = mountOptions({ type: 'ceiling_light' })

    expect(wrapper.text()).toContain('Ceiling light')
  })

  it('emits change-device from the Change device button', async () => {
    const wrapper = mountOptions()

    await wrapper.get('button[type="button"]').trigger('click')

    expect(wrapper.emitted('change-device')).toHaveLength(1)
  })

  it('emits update-draft with the trimmed label on blur', async () => {
    const wrapper = mountOptions()
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Device label"]')

    await input.setValue('Kitchen counter')
    await input.trigger('blur')

    expect(wrapper.emitted('update-draft')).toEqual([[{ label: 'Kitchen counter' }]])
  })

  it('emits update-draft with a null label once the field is cleared', async () => {
    const wrapper = mountOptions({ draft: { ...EMPTY_DRAFT, label: 'Kitchen counter' } })
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Device label"]')

    await input.setValue('')
    await input.trigger('blur')

    expect(wrapper.emitted('update-draft')).toEqual([[{ label: null }]])
  })

  it('shows the plan default load as the placeholder and emits a parsed override', async () => {
    const wrapper = mountOptions({ type: 'outlet', catalogDefaults: { outlet: 240 } })
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Load override in watts"]')

    expect(input.attributes('placeholder')).toBe('plan default 240 W')

    await input.setValue('300')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('update-draft')).toEqual([[{ load_w: 300 }]])
  })

  it('falls back to the catalog default load when the plan has no override', () => {
    const wrapper = mountOptions({ type: 'outlet', catalogDefaults: {} })
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Load override in watts"]')

    expect(input.attributes('placeholder')).toBe('default 180 W')
  })

  it('does not show baseboard controls for a non-baseboard type', () => {
    const wrapper = mountOptions({ type: 'outlet' })

    expect(wrapper.find('[aria-label="Baseboard properties"]').exists()).toBe(false)
  })

  it('shows baseboard length and wattage presets for the baseboard heater type', async () => {
    const wrapper = mountOptions({ type: 'baseboard_heater' })

    wrapper.get('[aria-label="Baseboard properties"]')

    const preset = wrapper
      .findAll('[aria-label="Wattage presets"] button')
      .find((button) => button.text() === '1500 W')
    if (!preset) throw new Error('1500 W preset button not found')

    await preset.trigger('click')

    expect(wrapper.emitted('update-draft')).toEqual([[{ load_w: 1500 }]])
  })

  it('emits update-draft with a parsed baseboard length and clears the field', async () => {
    const wrapper = mountOptions({ type: 'baseboard_heater' })
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Baseboard length in feet and inches"]',
    )

    await input.setValue("4'")
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('update-draft')).toEqual([[{ length_in: 48 }]])
    expect(input.element.value).toBe('')
  })
})
