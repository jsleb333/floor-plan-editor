import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import OpeningInspector from '@/components/editor/OpeningInspector.vue'
import type { Opening } from '@/types/plan'
import { makeOpening, makeWall } from '../helpers/planFactory'

function mountInspector(opening: Opening): VueWrapper {
  return mount(OpeningInspector, { props: { opening, walls: [makeWall()] } })
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

describe('OpeningInspector', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('emits the whole opening with the new style when a style button is clicked', async () => {
    const opening = makeOpening()
    const wrapper = mountInspector(opening)

    expect(buttonByText(wrapper, 'Swing').attributes('aria-pressed')).toBe('true')
    await buttonByText(wrapper, 'Pocket').trigger('click')

    expect(wrapper.emitted('update-opening')).toEqual([[{ ...opening, style: 'pocket' }]])
  })

  it('shows only the side fields the placed style reads, under its own labels', () => {
    const swing = mountInspector(makeOpening())
    expect(swing.find('[aria-label="Hinge side"]').exists()).toBe(true)
    expect(swing.find('[aria-label="Swing direction"]').exists()).toBe(true)
    expect(swing.text()).toContain('Hinge')

    const slider = mountInspector(makeOpening({ style: 'sliding' }))
    expect(slider.find('[aria-label="Hinge side"]').exists()).toBe(true)
    expect(slider.find('[aria-label="Swing direction"]').exists()).toBe(false)
    expect(slider.text()).toContain('Slide side')

    const double = mountInspector(makeOpening({ style: 'double' }))
    expect(double.find('[aria-label="Hinge side"]').exists()).toBe(false)
    expect(double.find('[aria-label="Swing direction"]').exists()).toBe(true)
  })

  it('offers no door controls at all for a window', () => {
    const wrapper = mountInspector(makeOpening({ kind: 'window' }))

    expect(wrapper.find('[aria-label="Door style"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Hinge side"]').exists()).toBe(false)
  })

  it('keeps a placed closet door editable by width', async () => {
    const opening = makeOpening({ style: 'bifold', width_in: 48 })
    const wrapper = mountInspector(opening)
    const input = wrapper.get<HTMLInputElement>(
      'input[aria-label="Opening width in feet and inches"]',
    )

    await input.setValue(`5'`)
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('update-opening')?.[0]).toEqual([{ ...opening, width_in: 60, t: 60 }])
  })
})
