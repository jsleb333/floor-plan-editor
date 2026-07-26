import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlanSettingsPanel from '@/components/editor/PlanSettingsPanel.vue'

function baseProps() {
  return {
    planName: 'Basement',
    planDescription: 'Reno 2026',
    thicknessPresetsIn: [12, 4.5, 3.5],
    displayPrecisionIn: null,
  }
}

describe('PlanSettingsPanel', () => {
  it('renders the plan name, description and current settings', () => {
    const wrapper = mount(PlanSettingsPanel, { props: baseProps() })

    expect(wrapper.text()).toContain('Basement')
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('Reno 2026')
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="Thickness preset 1"]').element.value,
    ).toBe('12"')
    // A null override falls back to the 1/8" default in the select (spec §5.9).
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('0.125')
  })

  it('renames like the top bar: click, edit, Enter commits, unchanged/empty is dropped', async () => {
    const wrapper = mount(PlanSettingsPanel, { props: baseProps() })
    await wrapper.get('button[aria-label="Rename plan"]').trigger('click')
    const input = wrapper.get('input[aria-label="Plan name"]')
    await input.setValue('  Cellar ')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('rename')).toEqual([['Cellar']])

    await wrapper.get('button[aria-label="Rename plan"]').trigger('click')
    const again = wrapper.get('input[aria-label="Plan name"]')
    await again.setValue('   ')
    await again.trigger('blur')
    expect(wrapper.emitted('rename')).toHaveLength(1)
  })

  it('escape cancels the rename without emitting', async () => {
    const wrapper = mount(PlanSettingsPanel, { props: baseProps() })
    await wrapper.get('button[aria-label="Rename plan"]').trigger('click')
    const input = wrapper.get('input[aria-label="Plan name"]')
    await input.setValue('Cellar')
    await input.trigger('keydown.esc')

    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.find('button[aria-label="Rename plan"]').exists()).toBe(true)
  })

  it('emits the trimmed description on blur only when it changed', async () => {
    const wrapper = mount(PlanSettingsPanel, { props: baseProps() })
    const textarea = wrapper.get('textarea')

    await textarea.trigger('blur')
    expect(wrapper.emitted('update-description')).toBeUndefined()

    await textarea.setValue('  New description ')
    await textarea.trigger('blur')
    expect(wrapper.emitted('update-description')).toEqual([['New description']])
  })

  it('emits the edited preset list', async () => {
    const wrapper = mount(PlanSettingsPanel, { props: baseProps() })
    const first = wrapper.get('input[aria-label="Thickness preset 1"]')
    await first.setValue(`8"`)
    await first.trigger('blur')

    expect(wrapper.emitted('set-thickness-presets')).toEqual([[[8, 4.5, 3.5]]])
  })

  it('emits the picked display precision as a number', async () => {
    const wrapper = mount(PlanSettingsPanel, { props: baseProps() })
    await wrapper.get('select').setValue('0.5')

    expect(wrapper.emitted('set-display-precision')).toEqual([[0.5]])
  })
})
