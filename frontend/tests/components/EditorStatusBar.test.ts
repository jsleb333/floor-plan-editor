import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'

import EditorStatusBar from '@/components/editor/EditorStatusBar.vue'

function mountStatusBar(warningCount?: number): VueWrapper {
  return mount(EditorStatusBar, {
    global: { plugins: [createPinia()] },
    props: {
      cursor: null,
      zoomPercent: 100,
      snapGrid: true,
      snapAngle: true,
      snapWalls: true,
      scrollMode: 'auto' as const,
      wallReference: null,
      inputBuffer: '',
      notice: null,
      activeCircuitName: null,
      activeCircuitColor: null,
      warningCount,
    },
  })
}

function warningIndicator(wrapper: VueWrapper): DOMWrapper<Element> | undefined {
  return wrapper
    .findAll('button')
    .find((button) => button.attributes('aria-label')?.includes('over 80%'))
}

describe('EditorStatusBar', () => {
  it('stays quiet while no circuit is over 80% (spec C4/§6.1)', () => {
    expect(warningIndicator(mountStatusBar(0))).toBeUndefined()
    expect(warningIndicator(mountStatusBar())).toBeUndefined()
  })

  it('shows the loaded-circuit count once any circuit warns', () => {
    const indicator = warningIndicator(mountStatusBar(3))

    expect(indicator?.text()).toBe('3')
    expect(indicator?.attributes('aria-label')).toBe('3 circuits over 80%')
  })

  it('emits open-circuits when the indicator is clicked', async () => {
    const wrapper = mountStatusBar(1)

    await warningIndicator(wrapper)?.trigger('click')

    expect(wrapper.emitted('open-circuits')).toHaveLength(1)
  })
})
