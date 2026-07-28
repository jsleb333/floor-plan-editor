import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModeSwitcher from '@/components/editor/ModeSwitcher.vue'
import { MODES } from '@/components/editor/tools'
import type { ModeId } from '@/components/editor/tools'

function mountSwitcher(activeMode: ModeId): VueWrapper {
  return mount(ModeSwitcher, { props: { activeMode } })
}

describe('ModeSwitcher', () => {
  it('offers one segment per mode, in mode order (spec E10)', () => {
    const wrapper = mountSwitcher('structure')

    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(
      MODES.map((mode) => mode.name),
    )
  })

  it('carries each mode letter in the tooltip', () => {
    const wrapper = mountSwitcher('structure')

    const titles = wrapper.findAll('button').map((button) => button.attributes('title'))

    expect(titles).toEqual(['Structure (S)', 'Electrical (E)', 'Inspector (I)'])
  })

  it('marks only the active mode as pressed', () => {
    const wrapper = mountSwitcher('electrical')

    const pressed = wrapper
      .findAll('button')
      .filter((button) => button.attributes('aria-pressed') === 'true')

    expect(pressed.map((button) => button.text())).toEqual(['Electrical'])
  })

  it('emits select with the picked mode', async () => {
    const wrapper = mountSwitcher('structure')

    const inspector = wrapper.findAll('button').find((button) => button.text() === 'Inspector')
    await inspector?.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['inspector']])
  })
})
