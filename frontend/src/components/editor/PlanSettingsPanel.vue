<script setup lang="ts">
import { Pencil } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'

import DisplayPrecisionSelect from '@/components/DisplayPrecisionSelect.vue'
import { DEFAULT_DISPLAY_PRECISION_IN } from '@/utils/units'

const props = defineProps<{
  planName: string
  planDescription: string
  /** The document's precision override; `null` shows the 1/8" default (spec §5.9 tier 2). */
  displayPrecisionIn: number | null
}>()

const emit = defineEmits<{
  rename: [name: string]
  'update-description': [description: string]
  'set-display-precision': [precisionIn: number]
}>()

const editingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const descriptionDraft = ref(props.planDescription)

watch(
  () => props.planDescription,
  (description) => {
    descriptionDraft.value = description
  },
)

async function startRename(): Promise<void> {
  nameDraft.value = props.planName
  editingName.value = true
  await nextTick()
  nameInput.value?.select()
}

function commitRename(): void {
  if (!editingName.value) return
  editingName.value = false
  const name = nameDraft.value.trim()
  if (name && name !== props.planName) {
    emit('rename', name)
  }
}

function cancelRename(): void {
  editingName.value = false
}

function commitDescription(): void {
  const description = descriptionDraft.value.trim()
  if (description !== props.planDescription) {
    emit('update-description', description)
  }
}
</script>

<template>
  <section aria-label="Plan settings" class="flex flex-col gap-4 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Plan settings</h3>
      <p class="text-ink-muted mt-0.5">Name, description and display precision for this plan.</p>
    </header>

    <div>
      <span class="text-ink font-semibold">Name</span>
      <input
        v-if="editingName"
        ref="nameInput"
        v-model="nameDraft"
        type="text"
        aria-label="Plan name"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
        @blur="commitRename"
      />
      <button
        v-else
        type="button"
        class="group border-line hover:border-ink-faint mt-1 flex w-full items-center justify-between gap-1.5 rounded-md border px-2 py-1 text-left transition-colors"
        aria-label="Rename plan"
        title="Rename plan"
        @click="startRename"
      >
        <span class="text-ink truncate">{{ planName }}</span>
        <Pencil
          :size="12"
          class="text-ink-faint shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </button>
    </div>

    <label class="block">
      <span class="text-ink font-semibold">Description</span>
      <textarea
        v-model="descriptionDraft"
        rows="3"
        placeholder="Shown under the name on the home page"
        aria-label="Plan description"
        class="border-line focus:border-accent mt-1 w-full resize-none rounded-md border px-2 py-1 outline-none"
        @blur="commitDescription"
      />
    </label>

    <label class="block">
      <span class="text-ink font-semibold">Display precision</span>
      <p class="text-ink-muted mt-0.5 mb-1">Lengths shown rounded to the nearest step.</p>
      <DisplayPrecisionSelect
        :model-value="displayPrecisionIn ?? DEFAULT_DISPLAY_PRECISION_IN"
        @update:model-value="emit('set-display-precision', $event)"
      />
    </label>
  </section>
</template>
