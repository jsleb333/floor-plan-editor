import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useSnapSettings } from '@/composables/useSnapSettings'

describe('useSnapSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults every snap toggle to on', () => {
    const settings = useSnapSettings()
    expect(settings.grid.value).toBe(true)
    expect(settings.angle.value).toBe(true)
    expect(settings.walls.value).toBe(true)
  })

  it('persists toggles so a new instance restores them', async () => {
    const settings = useSnapSettings()
    settings.grid.value = false
    settings.walls.value = false
    await nextTick()

    const restored = useSnapSettings()
    expect(restored.grid.value).toBe(false)
    expect(restored.angle.value).toBe(true)
    expect(restored.walls.value).toBe(false)
  })

  it('ignores corrupted stored values', () => {
    window.localStorage.setItem('floor-plan:snap-settings', '{not json')
    const settings = useSnapSettings()
    expect(settings.grid.value).toBe(true)
  })
})
