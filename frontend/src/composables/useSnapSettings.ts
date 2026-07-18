import { ref, watch } from 'vue'

import type { SnapSettings } from './useSnapping'

const STORAGE_KEY = 'floor-plan:snap-settings'

interface StoredSnapSettings {
  grid: boolean
  angle: boolean
  walls: boolean
}

function readStored(): StoredSnapSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Partial<Record<keyof StoredSnapSettings, unknown>>
    return {
      grid: record.grid !== false,
      angle: record.angle !== false,
      walls: record.walls !== false,
    }
  } catch {
    return null
  }
}

/**
 * Snap toggles (grid / angle / walls) persisted in localStorage, so the
 * user's preferences survive reloads (spec §5.9 tier 1). All default to on.
 */
export function useSnapSettings(): SnapSettings {
  const stored = readStored()
  const grid = ref(stored?.grid ?? true)
  const angle = ref(stored?.angle ?? true)
  const walls = ref(stored?.walls ?? true)

  watch([grid, angle, walls], () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ grid: grid.value, angle: angle.value, walls: walls.value }),
    )
  })

  return { grid, angle, walls }
}
