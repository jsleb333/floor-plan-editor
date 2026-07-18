import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ShortcutOverlay from '@/components/editor/ShortcutOverlay.vue'
import { TOOLS } from '@/components/editor/tools'

describe('ShortcutOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists every enabled tool shortcut key alongside editing keys', () => {
    const wrapper = mount(ShortcutOverlay)
    const text = document.body.textContent ?? ''
    for (const tool of TOOLS.filter((candidate) => candidate.enabled)) {
      expect(text).toContain(tool.name)
    }
    const keys = document.body.querySelectorAll('kbd')
    const keyLabels = Array.from(keys, (kbd) => kbd.textContent?.trim())
    expect(keyLabels).toContain('V')
    expect(keyLabels).toContain('Ctrl')
    expect(keyLabels).toContain('Esc')
    wrapper.unmount()
  })

  it('emits close when Escape is pressed', async () => {
    const wrapper = mount(ShortcutOverlay)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('emits close when the close button is clicked', async () => {
    const wrapper = mount(ShortcutOverlay)
    const closeButton = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Close shortcuts"]',
    )
    expect(closeButton).not.toBeNull()
    closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })
})
