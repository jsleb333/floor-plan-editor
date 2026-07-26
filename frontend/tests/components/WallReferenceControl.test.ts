import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import WallReferenceControl from '@/components/editor/WallReferenceControl.vue'
import type { WallReference } from '@/utils/geometry'

function mountControl(reference: WallReference = 'center'): VueWrapper {
  return mount(WallReferenceControl, { props: { reference } })
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!button) throw new Error(`button "${text}" not found`)
  return button
}

describe('WallReferenceControl', () => {
  it('marks the current side pressed and emits set-reference on click', async () => {
    const wrapper = mountControl('center')

    expect(buttonByText(wrapper, 'Center').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'Left face').attributes('aria-pressed')).toBe('false')

    await buttonByText(wrapper, 'Left face').trigger('click')
    expect(wrapper.emitted('set-reference')).toEqual([['left']])
  })

  it('emits preview-reference on hover and null when the pointer leaves the group', async () => {
    const wrapper = mountControl('center')

    await buttonByText(wrapper, 'Right face').trigger('mouseenter')
    await wrapper.get('[role="group"]').trigger('mouseleave')

    expect(wrapper.emitted('preview-reference')).toEqual([['right'], [null]])
  })

  it('carries the face tint swatches on the two face options (spec S1a)', () => {
    const wrapper = mountControl('center')

    expect(buttonByText(wrapper, 'Left face').find('.bg-face-left').exists()).toBe(true)
    expect(buttonByText(wrapper, 'Right face').find('.bg-face-right').exists()).toBe(true)
    expect(buttonByText(wrapper, 'Center').find('.bg-face-left, .bg-face-right').exists()).toBe(
      false,
    )
  })
})
