import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'

import type { ModeDefinition, ModeId, ToolDefinition, ToolId } from '@/components/editor/tools'

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
  /** Mode definitions carrying the mode letters (spec E10); omit for global tool letters. */
  modes?: readonly ModeDefinition[]
  /** The mode whose tool letters resolve first; omit to match tools across every mode. */
  activeMode?: Ref<ModeId>
  /** Called with the mode id when its letter is pressed (requires `modes`). */
  onSelectMode?: (id: ModeId) => void
}

/**
 * Binds single-key mode and tool shortcuts to the window while the host
 * component is mounted (spec E10, chorded mode-scoped shortcuts).
 *
 * Keys are ignored when a modifier is held, while typing in an input,
 * textarea or contenteditable element, or when `options.suppress` claims the
 * key for the active tool; disabled tools do not respond.
 *
 * A letter resolves against the active mode's tools first, then against the
 * mode letters — so <kbd>E</kbd> <kbd>W</kbd> arms the Wire tool from
 * anywhere, and <kbd>D</kbd> means Door in Structure but Device in
 * Electrical. Without `options.activeMode` the letter matches tools of every
 * mode, the pre-mode global behaviour.
 *
 * @param tools Tool definitions carrying `shortcut`, `enabled` and `modes`.
 * @param onSelect Called with the tool id when its shortcut is pressed.
 * @param options Suppression hook and the mode wiring (see `ToolShortcutOptions`).
 */
export function useToolShortcuts(
  tools: readonly ToolDefinition[],
  onSelect: (id: ToolId) => void,
  options: ToolShortcutOptions = {},
): void {
  function findTool(key: string): ToolDefinition | undefined {
    const activeMode = options.activeMode?.value
    return tools.find(
      (tool) =>
        tool.shortcut === key && (activeMode === undefined || tool.modes.includes(activeMode)),
    )
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (options.suppress?.(event)) return
    const key = event.key.toLowerCase()
    const tool = findTool(key)
    if (tool?.enabled) {
      onSelect(tool.id)
      event.preventDefault()
      return
    }
    const onSelectMode = options.onSelectMode
    if (!onSelectMode) return
    const mode = options.modes?.find((candidate) => candidate.shortcut === key)
    if (mode) {
      onSelectMode(mode.id)
      event.preventDefault()
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
}
