import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OpeningToolOptions from '@/components/editor/OpeningToolOptions.vue'
import type { DoorStyle } from '@/types/plan'

const DOOR_WIDTH_PRESETS_IN: readonly number[] = [24, 28, 30, 32, 36]
const WINDOW_WIDTH_PRESETS_IN: readonly number[] = [24, 36, 48, 60, 72]

interface OptionsProps {
  kind: 'door' | 'window'
  widthIn: number
  presetsIn: readonly number[]
  doorStyle: DoorStyle
  hinge: 'left' | 'right'
  swing: 'in' | 'out'
}

function mountOptions(overrides: Partial<OptionsProps> = {}) {
  const props: OptionsProps = {
    kind: 'door',
    widthIn: 32,
    presetsIn: DOOR_WIDTH_PRESETS_IN,
    doorStyle: 'swing',
    hinge: 'left',
    swing: 'in',
  }
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

  it('also emits add-width-preset when the committed custom value is not already a preset', async () => {
    const wrapper = mountOptions()
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Custom width in feet and inches"]',
    )

    await input.setValue('54')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('set-width')).toEqual([[54]])
    expect(wrapper.emitted('add-width-preset')).toEqual([[54]])
  })

  it('does not emit add-width-preset when the committed custom value matches an existing preset', async () => {
    const wrapper = mountOptions()
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Custom width in feet and inches"]',
    )

    await input.setValue('30')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('set-width')).toEqual([[30]])
    expect(wrapper.emitted('add-width-preset')).toBeUndefined()
  })

  it('does not emit add-width-preset when a preset button is clicked', async () => {
    const wrapper = mountOptions()

    await buttonByText(wrapper, '30"').trigger('click')

    expect(wrapper.emitted('add-width-preset')).toBeUndefined()
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

  it('shows window presets without style, hinge or swing controls for the window kind', () => {
    const wrapper = mountOptions({
      kind: 'window',
      widthIn: 36,
      presetsIn: WINDOW_WIDTH_PRESETS_IN,
    })

    expect(buttonByText(wrapper, '72"').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('[aria-label="Door style"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Hinge side"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Swing direction"]').exists()).toBe(false)
  })

  it('emits set-style from the style buttons and marks the armed one', async () => {
    const wrapper = mountOptions()

    await buttonByText(wrapper, 'Sliding').trigger('click')

    expect(wrapper.emitted('set-style')).toEqual([['sliding']])
    expect(buttonByText(wrapper, 'Swing').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'Sliding').attributes('aria-pressed')).toBe('false')
  })

  it('shows only the swing toggle for a double door', () => {
    const wrapper = mountOptions({ doorStyle: 'double' })

    expect(wrapper.find('[aria-label="Hinge side"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Swing direction"]').exists()).toBe(true)
  })

  it.each([
    ['sliding', 'Slide side'],
    ['pocket', 'Pocket side'],
  ] as const)('relabels the hinge field and drops the swing toggle for %s', (style, label) => {
    const wrapper = mountOptions({ doorStyle: style })

    expect(wrapper.find('[aria-label="Swing direction"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Hinge side"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(label)
  })

  it('labels a bifold door with its stack and fold sides', () => {
    const wrapper = mountOptions({ doorStyle: 'bifold' })

    expect(wrapper.text()).toContain('Stack side')
    expect(wrapper.text()).toContain('Fold side')
  })

  it('describes only the cursor gestures the armed style reads', () => {
    expect(mountOptions().text()).toContain(
      'While hovering: the swing follows the cursor across the wall, Tab cycles the hinge, and typed digits set the width exactly.',
    )
    expect(mountOptions({ doorStyle: 'pocket' }).text()).toContain(
      'While hovering: Tab cycles the pocket side, and typed digits set the width exactly.',
    )
  })

  it('keeps the width presets and custom entry working for a closet-wide slider', async () => {
    const wrapper = mountOptions({ doorStyle: 'sliding', widthIn: 60 })
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Custom width in feet and inches"]',
    )

    await input.setValue(`4'`)
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('set-width')).toEqual([[48]])
    expect(wrapper.emitted('add-width-preset')).toEqual([[48]])
  })
})
