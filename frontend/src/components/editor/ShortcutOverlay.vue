<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted } from 'vue'

import { TOOLS } from '@/components/editor/tools'

const emit = defineEmits<{
  close: []
}>()

interface Shortcut {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
  /** Optional prose under the list, for behaviour a key row can't express. */
  note?: string
}

const toolShortcuts = computed<Shortcut[]>(() =>
  TOOLS.filter((tool) => tool.enabled).map((tool) => ({
    keys: [tool.shortcut.toUpperCase()],
    label: tool.name,
  })),
)

const groups = computed<ShortcutGroup[]>(() => [
  { title: 'Tools', shortcuts: toolShortcuts.value },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', 'Y'], label: 'Redo (alt)' },
      { keys: ['Del'], label: 'Delete selection' },
      { keys: ['Ctrl', 'C'], label: 'Copy device' },
      { keys: ['Ctrl', 'V'], label: 'Paste device' },
      { keys: ['Ctrl', 'D'], label: 'Duplicate device' },
    ],
  },
  {
    title: 'Move & nudge',
    shortcuts: [
      { keys: ['←', '↑', '→', '↓'], label: 'Nudge 1″' },
      { keys: ['Shift', 'Arrows'], label: 'Nudge 12″' },
    ],
  },
  {
    title: 'While drawing',
    shortcuts: [
      { keys: ['Tab'], label: 'Cycle reference side / dimension' },
      { keys: ['Alt'], label: 'Free angle (hold)' },
      { keys: ['Enter'], label: 'Commit typed length / finish' },
      { keys: ['Esc'], label: 'Cancel current action' },
    ],
  },
  {
    title: 'Pan',
    shortcuts: [
      { keys: ['Space', 'Drag'], label: 'Pan' },
      { keys: ['Middle', 'Drag'], label: 'Pan (mouse)' },
      { keys: ['2 fingers', 'Scroll'], label: 'Pan (trackpad)' },
      { keys: ['Shift', 'Wheel'], label: 'Pan horizontally' },
    ],
    note: 'Space pans while the pointer is over the canvas.',
  },
  {
    title: 'Zoom',
    shortcuts: [
      { keys: ['Wheel'], label: 'Zoom to cursor' },
      { keys: ['Ctrl', 'Wheel'], label: 'Zoom to cursor' },
      { keys: ['Pinch'], label: 'Zoom to cursor (trackpad)' },
      { keys: ['Toolbar'], label: 'Zoom to fit / 100%' },
    ],
    note: 'Whether a plain scroll zooms or pans follows the scroll mode in the status bar (auto / zoom / pan).',
  },
  {
    title: 'Help',
    shortcuts: [{ keys: ['?'], label: 'Toggle this overlay' }],
  },
])

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-40 flex items-center justify-center p-4"
      @click.self="emit('close')"
    >
      <section
        role="dialog"
        aria-labelledby="shortcut-overlay-title"
        class="border-line bg-surface shadow-panel rounded-card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden border"
      >
        <header class="border-line flex items-center justify-between border-b px-5 py-3">
          <h2 id="shortcut-overlay-title" class="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            class="text-ink-muted hover:bg-canvas hover:text-ink rounded p-1 transition-colors"
            aria-label="Close shortcuts"
            @click="emit('close')"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </header>

        <div class="grid grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <section v-for="group in groups" :key="group.title" :aria-label="group.title">
            <h3 class="text-ink-muted mb-2 text-xs font-semibold tracking-wide uppercase">
              {{ group.title }}
            </h3>
            <ul class="space-y-1.5">
              <li
                v-for="shortcut in group.shortcuts"
                :key="`${shortcut.label}-${shortcut.keys.join('+')}`"
                class="flex items-center justify-between gap-3 text-sm"
              >
                <span class="text-ink">{{ shortcut.label }}</span>
                <span class="flex shrink-0 items-center gap-1">
                  <kbd
                    v-for="key in shortcut.keys"
                    :key="key"
                    class="border-line bg-canvas text-ink-muted rounded border px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    {{ key }}
                  </kbd>
                </span>
              </li>
            </ul>
            <p v-if="group.note" class="text-ink-faint mt-2 text-xs">{{ group.note }}</p>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
