import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OpeningToolOptions from '@/components/editor/OpeningToolOptions.vue'

interface OptionsProps {
  kind: 'door' | 'window'
  widthIn: number
  hinge: 'left' | 'right'
  swing: 'in' | 'out'
}

function mountOptions(overrides: Partial<OptionsProps> = {}) {
  const props: OptionsProps = { kind: 'door', widthIn: 32, hinge: 'left', swing: 'in' }
  return mount(OpeningToolOptions, { props: { ...props, ...overrides } })
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

describe('OpeningToolOptions', () => {
  it('emits set-width when a door preset is clicked and marks the active one', async () => {
    const wrapper = mountOptions()

    await buttonByText(wrapper, '30"').trigger('click')
    expect(wrapper.emitted('set-width')).toEqual([[30]])
    expect(buttonByText(wrapper, '32"').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, '30"').attributes('aria-pressed')).toBe('false')
  })

  it('emits set-width from a parsed custom entry and clears the field', async () => {
    const wrapper = mountOptions()
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Custom width in feet and inches"]',
    )

    await input.setValue(`2'6`)
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('set-width')).toEqual([[30]])
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

  it('emits set-hinge and set-swing from the door toggles', async () => {
    const wrapper = mountOptions()

    await buttonByText(wrapper, 'Right').trigger('click')
    await buttonByText(wrapper, 'Out').trigger('click')

    expect(wrapper.emitted('set-hinge')).toEqual([['right']])
    expect(wrapper.emitted('set-swing')).toEqual([['out']])
  })

  it('reflects the live swing on the toggle', () => {
    const wrapper = mountOptions({ swing: 'out' })

    expect(buttonByText(wrapper, 'Out').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'In').attributes('aria-pressed')).toBe('false')
  })

  it('shows window presets without hinge or swing controls for the window kind', () => {
    const wrapper = mountOptions({ kind: 'window', widthIn: 36 })

    expect(buttonByText(wrapper, '72"').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[aria-label="Hinge side"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Swing direction"]').exists()).toBe(false)
  })
})
