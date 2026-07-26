<script setup lang="ts">
import { Crosshair, Eye, EyeOff, ImageUp, Lock, LockOpen, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { useUnderlayImport } from '@/composables/useUnderlayImport'
import { useUnderlayRotation } from '@/composables/useUnderlayRotation'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Underlay } from '@/types/plan'
import type { ImageSize } from '@/utils/imageSize'

const props = defineProps<{
  /** Natural pixel size of the underlay image; rotation pivots about its centre when known. */
  underlayImageSize: ImageSize | null
}>()

const emit = defineEmits<{
  /** The user asked to (re)calibrate — the page activates the Calibrate tool (spec U2). */
  recalibrate: []
}>()

const editorStore = useEditorStore()
const layersStore = useLayersStore()

const { uploading, error: uploadError, importFile } = useUnderlayImport()
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const underlay = computed<Underlay | null>(() => {
  void editorStore.documentVersion
  return editorStore.document?.underlay ?? null
})

const opacityPercent = computed(() =>
  underlay.value ? Math.round(underlay.value.opacity * 100) : 0,
)

const {
  draft: rotationDraft,
  error: rotationError,
  apply: applyRotation,
} = useUnderlayRotation({
  underlay,
  imageSize: computed(() => props.underlayImageSize),
  commit: (next) => editorStore.mutate({ type: 'setUnderlay', underlay: next }),
})

function update(patch: Partial<Underlay>): void {
  if (!underlay.value) return
  editorStore.mutate({ type: 'setUnderlay', underlay: { ...underlay.value, ...patch } })
}

function onFileChange(event: Event): void {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.files?.length) return
  void importFile(input.files[0])
  input.value = ''
}

function onDrop(event: DragEvent): void {
  dragOver.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void importFile(file)
}

function applyOpacity(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return
  update({ opacity: Number.parseInt(event.target.value, 10) / 100 })
}

function removeUnderlay(): void {
  editorStore.mutate({ type: 'setUnderlay', underlay: null })
}
</script>

<template>
  <section aria-label="Layers" class="flex flex-col gap-4 text-xs">
    <section aria-label="Underlay layer" class="flex flex-col gap-2">
      <h3 class="text-ink text-sm font-semibold">Underlay</h3>

      <template v-if="!underlay">
        <button
          type="button"
          class="border-line text-ink-muted hover:text-ink flex flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition-colors"
          :class="dragOver ? 'border-accent bg-accent-soft text-accent' : 'hover:border-accent'"
          :disabled="uploading"
          @click="fileInput?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <ImageUp :size="18" aria-hidden="true" />
          <span v-if="uploading">Uploading…</span>
          <span v-else>Import a JPEG/PNG to trace, or drop it here</span>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png"
          class="hidden"
          aria-label="Underlay image file"
          @change="onFileChange"
        />
      </template>

      <template v-else>
        <div class="flex items-center gap-1.5">
          <span class="text-ink flex-1">Image</span>
          <button
            type="button"
            :aria-pressed="underlay.visible"
            :aria-label="underlay.visible ? 'Hide underlay' : 'Show underlay'"
            class="hover:bg-canvas rounded p-1 transition-colors"
            :class="underlay.visible ? 'text-ink' : 'text-ink-faint'"
            @click="update({ visible: !underlay.visible })"
          >
            <component :is="underlay.visible ? Eye : EyeOff" :size="14" aria-hidden="true" />
          </button>
          <button
            type="button"
            :aria-pressed="underlay.locked"
            :aria-label="underlay.locked ? 'Unlock underlay' : 'Lock underlay'"
            class="hover:bg-canvas rounded p-1 transition-colors"
            :class="underlay.locked ? 'text-accent' : 'text-ink-muted'"
            @click="update({ locked: !underlay.locked })"
          >
            <component :is="underlay.locked ? Lock : LockOpen" :size="14" aria-hidden="true" />
          </button>
        </div>

        <label class="block">
          <span class="text-ink-muted">Opacity</span>
          <span class="text-ink-muted ml-1 tabular-nums">{{ opacityPercent }}%</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="opacityPercent"
            class="accent-accent mt-1 w-full"
            aria-label="Underlay opacity"
            @input="applyOpacity"
          />
        </label>

        <label class="block">
          <span class="text-ink-muted">Rotation</span>
          <input
            v-model="rotationDraft"
            type="text"
            :placeholder="`${underlay.transform.rotation_deg}°`"
            class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
            aria-label="Underlay rotation in degrees"
            @keydown.enter.prevent="applyRotation"
            @blur="applyRotation"
          />
        </label>
        <p
          v-if="rotationError"
          role="alert"
          class="bg-danger-soft text-danger rounded-md px-2 py-1.5 leading-snug"
        >
          Enter the rotation in degrees, between -180 and 180.
        </p>

        <p class="text-ink-muted tabular-nums" aria-label="Underlay scale">
          1 px = {{ underlay.transform.scale.toFixed(3) }}"
        </p>

        <div class="flex gap-2">
          <button
            type="button"
            class="border-line text-ink-muted hover:text-ink hover:bg-canvas flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
            @click="emit('recalibrate')"
          >
            <Crosshair :size="13" aria-hidden="true" />
            Recalibrate
          </button>
          <button
            type="button"
            class="border-danger/40 text-danger hover:bg-danger-soft flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
            @click="removeUnderlay"
          >
            <Trash2 :size="13" aria-hidden="true" />
            Remove
          </button>
        </div>
      </template>

      <p v-if="uploadError" role="alert" class="bg-danger-soft text-danger rounded-md px-2 py-1.5">
        {{ uploadError }}
      </p>
    </section>

    <section aria-label="Structure layer" class="flex items-center gap-1.5">
      <span class="text-ink flex-1">Structure</span>
      <button
        type="button"
        :aria-pressed="layersStore.structureVisible"
        :aria-label="layersStore.structureVisible ? 'Hide structure' : 'Show structure'"
        class="hover:bg-canvas rounded p-1 transition-colors"
        :class="layersStore.structureVisible ? 'text-ink' : 'text-ink-faint'"
        @click="layersStore.structureVisible = !layersStore.structureVisible"
      >
        <component
          :is="layersStore.structureVisible ? Eye : EyeOff"
          :size="14"
          aria-hidden="true"
        />
      </button>
    </section>

    <section aria-label="Devices layer" class="flex items-center gap-1.5">
      <span class="text-ink flex-1">Devices</span>
      <button
        type="button"
        :aria-pressed="layersStore.devicesVisible"
        :aria-label="layersStore.devicesVisible ? 'Hide devices' : 'Show devices'"
        class="hover:bg-canvas rounded p-1 transition-colors"
        :class="layersStore.devicesVisible ? 'text-ink' : 'text-ink-faint'"
        @click="layersStore.devicesVisible = !layersStore.devicesVisible"
      >
        <component :is="layersStore.devicesVisible ? Eye : EyeOff" :size="14" aria-hidden="true" />
      </button>
    </section>

    <section aria-label="Annotations layer" class="flex items-center gap-1.5">
      <span class="text-ink flex-1">Annotations</span>
      <button
        type="button"
        :aria-pressed="layersStore.annotationsVisible"
        :aria-label="layersStore.annotationsVisible ? 'Hide annotations' : 'Show annotations'"
        class="hover:bg-canvas rounded p-1 transition-colors"
        :class="layersStore.annotationsVisible ? 'text-ink' : 'text-ink-faint'"
        @click="layersStore.annotationsVisible = !layersStore.annotationsVisible"
      >
        <component
          :is="layersStore.annotationsVisible ? Eye : EyeOff"
          :size="14"
          aria-hidden="true"
        />
      </button>
    </section>

    <p class="text-ink-muted leading-relaxed">
      Per-circuit wire and device visibility lives in the Circuits tab, on each circuit's row.
    </p>
  </section>
</template>
