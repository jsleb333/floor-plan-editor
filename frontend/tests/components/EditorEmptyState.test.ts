import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import EditorEmptyState from '@/components/editor/EditorEmptyState.vue'

function mountEmptyState(): VueWrapper {
  return mount(EditorEmptyState, { global: { plugins: [createPinia()] } })
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

describe('EditorEmptyState', () => {
  it('offers the two entry paths of an empty plan (spec E9)', () => {
    const wrapper = mountEmptyState()

    expect(wrapper.text()).toContain('This plan is empty')
    expect(buttonByText(wrapper, 'Import a photo to trace').exists()).toBe(true)
    expect(buttonByText(wrapper, 'Start drawing walls').exists()).toBe(true)
  })

  it('emits start-drawing when the drawing path is picked', async () => {
    const wrapper = mountEmptyState()

    await buttonByText(wrapper, 'Start drawing walls').trigger('click')

    expect(wrapper.emitted('start-drawing')).toHaveLength(1)
  })
})
