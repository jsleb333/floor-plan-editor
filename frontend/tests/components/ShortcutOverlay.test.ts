import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ShortcutOverlay from '@/components/editor/ShortcutOverlay.vue'
import { MODES, TOOLS, toolsForMode } from '@/components/editor/tools'

/** The rows of the named group, as `label` → the keys shown beside it. */
function groupRows(title: string): Record<string, string> {
  const group = document.body.querySelector(`[aria-label="${title}"]`)
  if (!group) throw new Error(`group "${title}" not found`)
  return Object.fromEntries(
    Array.from(group.querySelectorAll('li'), (row) => [
      row.querySelector('span')?.textContent?.trim() ?? '',
      Array.from(row.querySelectorAll('kbd'), (kbd) => kbd.textContent?.trim()).join('+'),
    ]),
  )
}

describe('ShortcutOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists the mode letters as their own group (spec E10)', () => {
    const wrapper = mount(ShortcutOverlay)

    expect(groupRows('Modes')).toEqual(
      Object.fromEntries(MODES.map((mode) => [mode.name, mode.shortcut.toUpperCase()])),
    )
    wrapper.unmount()
  })

  it('groups the tool letters by mode, so a letter is read in its own scope', () => {
    const wrapper = mount(ShortcutOverlay)

    for (const mode of MODES) {
      expect(groupRows(`${mode.name} tools`)).toEqual(
        Object.fromEntries(
          toolsForMode(mode.id)
            .filter((tool) => tool.enabled)
            .map((tool) => [tool.name, tool.shortcut.toUpperCase()]),
        ),
      )
    }
    // The same letter names a different tool in each mode — the point of scoping.
    expect(groupRows('Structure tools').Door).toBe('D')
    expect(groupRows('Electrical tools').Device).toBe('D')
    wrapper.unmount()
  })

  it('lists every enabled tool alongside the editing keys', () => {
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
