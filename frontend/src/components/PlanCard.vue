<script setup lang="ts">
import { Archive, Copy, Map, Pencil } from 'lucide-vue-next'
import { nextTick, onMounted, ref } from 'vue'

import { buildPlanSvg } from '@/export/svgExport'
import { EXPORT_SURFACE } from '@/export/exportTheme'
import { usePlansStore } from '@/stores/plans'
import type { PlanDocument, PlanSummary } from '@/types/plan'
import { formatRelativeTime } from '@/utils/relativeTime'

const props = defineProps<{
  plan: PlanSummary
}>()

const emit = defineEmits<{
  open: []
  rename: [name: string]
  duplicate: []
  archive: []
}>()

const plansStore = usePlansStore()

type ThumbnailState = { status: 'loading' } | { status: 'empty' } | { status: 'ready'; src: string }

const thumbnail = ref<ThumbnailState>({ status: 'loading' })

const editing = ref(false)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

function documentHasContent(document: PlanDocument): boolean {
  return (
    document.walls.length > 0 ||
    document.openings.length > 0 ||
    document.stairs.length > 0 ||
    document.devices.length > 0 ||
    document.wires.length > 0 ||
    document.labels.length > 0 ||
    document.dimensions.length > 0
  )
}

/** Renders a structure-only mini-preview via the shared SVG builder (spec §5.1 P1). */
function buildThumbnail(document: PlanDocument): ThumbnailState {
  if (!documentHasContent(document)) return { status: 'empty' }
  const svg = buildPlanSvg(document, {
    includeUnderlay: false,
    includeAnnotations: false,
    background: EXPORT_SURFACE,
  })
  return { status: 'ready', src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }
}

onMounted(async () => {
  try {
    const document = await plansStore.getDocument(props.plan.id)
    thumbnail.value = buildThumbnail(document)
  } catch {
    thumbnail.value = { status: 'empty' }
  }
})

async function startEditing(): Promise<void> {
  draftName.value = props.plan.name
  editing.value = true
  await nextTick()
  nameInput.value?.select()
}

function commitRename(): void {
  if (!editing.value) return
  editing.value = false
  const name = draftName.value.trim()
  if (name && name !== props.plan.name) {
    emit('rename', name)
  }
}

function cancelRename(): void {
  editing.value = false
}
</script>

<template>
  <article
    class="group border-line bg-surface rounded-card shadow-card hover:border-accent/40 relative flex flex-col border p-4 transition-colors"
  >
    <button
      type="button"
      class="bg-canvas flex h-24 items-center justify-center overflow-hidden rounded-md"
      :aria-label="`Open plan ${plan.name}`"
      @click="emit('open')"
    >
      <div
        v-if="thumbnail.status === 'loading'"
        class="bg-line/40 h-full w-full animate-pulse"
        aria-hidden="true"
      />
      <img
        v-else-if="thumbnail.status === 'ready'"
        :src="thumbnail.src"
        alt=""
        class="h-full w-full object-contain p-1"
      />
      <Map v-else :size="28" class="text-ink-faint" aria-hidden="true" />
    </button>

    <div class="mt-3 flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <input
          v-if="editing"
          ref="nameInput"
          v-model="draftName"
          type="text"
          aria-label="Plan name"
          class="border-line focus:border-accent w-full rounded border px-1.5 py-0.5 text-sm font-medium outline-none"
          @keydown.enter="commitRename"
          @keydown.esc="cancelRename"
          @blur="commitRename"
          @click.stop
        />
        <template v-else>
          <h3 class="truncate text-sm font-semibold">
            <button type="button" class="hover:text-accent transition-colors" @click="emit('open')">
              {{ plan.name }}
            </button>
          </h3>
          <p class="text-ink-muted mt-0.5 text-xs">
            Updated {{ formatRelativeTime(plan.updated_at) }}
          </p>
        </template>
      </div>

      <div
        class="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <button
          type="button"
          class="text-ink-muted hover:bg-canvas hover:text-ink rounded p-1.5 transition-colors"
          :aria-label="`Rename ${plan.name}`"
          title="Rename"
          @click="startEditing"
        >
          <Pencil :size="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="text-ink-muted hover:bg-canvas hover:text-ink rounded p-1.5 transition-colors"
          :aria-label="`Duplicate ${plan.name}`"
          title="Duplicate"
          @click="emit('duplicate')"
        >
          <Copy :size="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="text-ink-muted hover:bg-canvas hover:text-danger rounded p-1.5 transition-colors"
          :aria-label="`Archive ${plan.name}`"
          title="Archive"
          @click="emit('archive')"
        >
          <Archive :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>
  </article>
</template>
