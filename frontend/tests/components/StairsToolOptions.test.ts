import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StairsToolOptions from '@/components/editor/StairsToolOptions.vue'

interface OptionsProps {
  widthIn: number
  direction: 'up' | 'down'
}

function mountOptions(overrides: Partial<OptionsProps> = {}) {
  const props: OptionsProps = { widthIn: 36, direction: 'up' }
  return mount(StairsToolOptions, { props: { ...props, ...overrides } })
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

describe('StairsToolOptions', () => {
  it('emits set-width when a preset is clicked and marks the active one', async () => {
    const wrapper = mountOptions()

    await buttonByText(wrapper, '42"').trigger('click')
    expect(wrapper.emitted('set-width')).toEqual([[42]])
    expect(buttonByText(wrapper, '36"').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, '42"').attributes('aria-pressed')).toBe('false')
  })

  it('emits set-width from a parsed custom entry and clears the field', async () => {
    const wrapper = mountOptions()
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Custom width in feet and inches"]',
    )

    await input.setValue(`3'6`)
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('set-width')).toEqual([[42]])
    expect(input.element.value).toBe('')
  })

  it('flags an invalid custom width without emitting', async () => {
    const wrapper = mountOptions()
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Custom width in feet and inches"]',
    )

    await input.setValue('abc')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('set-width')).toBeUndefined()
    expect(input.attributes('aria-invalid')).toBe('true')
  })

  it('emits set-direction from the toggle and reflects the active direction', async () => {
    const wrapper = mountOptions({ direction: 'down' })

    expect(buttonByText(wrapper, 'Down').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'Up').attributes('aria-pressed')).toBe('false')

    await buttonByText(wrapper, 'Up').trigger('click')
    expect(wrapper.emitted('set-direction')).toEqual([['up']])
  })
})
