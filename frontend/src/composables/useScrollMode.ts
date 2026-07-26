import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import { SCROLL_MODES } from './useViewportGestures'
import type { ScrollMode } from './useViewportGestures'

const STORAGE_KEY = 'floor-plan:scroll-mode'

function readStored(): ScrollMode | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return SCROLL_MODES.find((mode) => mode === raw) ?? null
  } catch {
    return null
  }
}

/**
 * The scroll-gesture preference (spec E5) persisted in localStorage, so a user
 * whose hardware the `auto` heuristic guesses wrong only has to correct it
 * once. Defaults to `auto`.
 */
export function useScrollMode(): Ref<ScrollMode> {
  const mode = ref<ScrollMode>(readStored() ?? 'auto')
  watch(mode, (value) => window.localStorage.setItem(STORAGE_KEY, value))
  return mode
}

/** The next mode in the cycle, for the status-bar toggle. */
export function nextScrollMode(mode: ScrollMode): ScrollMode {
  const index = SCROLL_MODES.indexOf(mode)
  return SCROLL_MODES[(index + 1) % SCROLL_MODES.length] ?? 'auto'
}
