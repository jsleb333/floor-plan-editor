import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { useEditorStore } from '@/stores/editor'

/**
 * The editor's effective display precision in inches (spec §5.9 tier 2): the
 * open plan's `display_precision_in` override when set, else the 1/8" app
 * default. One reactive source shared by every component that formats a
 * feet-inches length, so a precision change re-renders all labels at once.
 */
export function useDisplayPrecision(): ComputedRef<number> {
  const editorStore = useEditorStore()
  return computed(() => editorStore.displayPrecisionIn)
}
