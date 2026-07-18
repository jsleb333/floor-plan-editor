<script setup lang="ts">
import { Crosshair, Eye, EyeOff, ImageUp, Lock, LockOpen, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { assetUrl, uploadAsset } from '@/api/assets'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Underlay } from '@/types/plan'
import { loadImageSize } from '@/utils/imageSize'
import { DEFAULT_UNDERLAY_OPACITY, initialUnderlayTransform } from '@/utils/underlay'

const emit = defineEmits<{
  /** The user asked to (re)calibrate — the page activates the Calibrate tool (spec U2). */
  recalibrate: []
}>()

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

const editorStore = useEditorStore()
const layersStore = useLayersStore()

const uploading = ref(false)
const uploadError = ref<string | null>(null)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const underlay = computed<Underlay | null>(() => {
  void editorStore.documentVersion
  return editorStore.document?.underlay ?? null
})

const opacityPercent = computed(() =>
  underlay.value ? Math.round(underlay.value.opacity * 100) : 0,
)

function update(patch: Partial<Underlay>): void {
  if (!underlay.value) return
  editorStore.mutate({ type: 'setUnderlay', underlay: { ...underlay.value, ...patch } })
}

async function importFile(file: File): Promise<void> {
  uploadError.value = null
  if (!ACCEPTED_TYPES.includes(file.type)) {
    uploadError.value = 'Only JPEG and PNG images are supported.'
    return
  }
  uploading.value = true
  try {
    const asset = await uploadAsset(file)
    const size = await loadImageSize(assetUrl(asset.id))
    const centre = editorStore.document?.viewport.center ?? { x: 0, y: 0 }
    editorStore.mutate({
      type: 'setUnderlay',
      underlay: {
        image_ref: asset.id,
        transform: initialUnderlayTransform(size, centre),
        opacity: DEFAULT_UNDERLAY_OPACITY,
        locked: false,
        visible: true,
      },
    })
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : 'Upload failed'
  } finally {
    uploading.value = false
  }
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

    <p class="text-ink-muted leading-relaxed">Per-circuit layer rows arrive with circuits in M5.</p>
  </section>
</template>
