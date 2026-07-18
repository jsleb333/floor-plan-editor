import { onBeforeUnmount, onMounted } from 'vue'

import type { ToolDefinition, ToolId } from '@/components/editor/tools'

/** True when the key event targets a text-entry element and must be left alone. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

export interface ToolShortcutOptions {
  /**
   * Returns true when the key belongs to the active tool (e.g. the wall
   * tool's exact-input buffer) and must not trigger a tool switch.
   */
  suppress?: (event: KeyboardEvent) => boolean
}

/**
 * Binds single-key tool shortcuts to the window while the host component is mounted.
 *
 * Keys are ignored when a modifier is held, while typing in an input,
 * textarea or contenteditable element, or when `options.suppress` claims the
 * key for the active tool; disabled tools do not respond.
 *
 * @param tools Tool definitions carrying `shortcut` and `enabled` flags.
 * @param onSelect Called with the tool id when its shortcut is pressed.
 * @param options Optional suppression hook (see `ToolShortcutOptions`).
 */
export function useToolShortcuts(
  tools: readonly ToolDefinition[],
  onSelect: (id: ToolId) => void,
  options: ToolShortcutOptions = {},
): void {
  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (options.suppress?.(event)) return
    const tool = tools.find((t) => t.shortcut === event.key.toLowerCase())
    if (tool?.enabled) {
      onSelect(tool.id)
      event.preventDefault()
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
}
