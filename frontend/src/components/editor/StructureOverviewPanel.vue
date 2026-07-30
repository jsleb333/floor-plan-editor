<script setup lang="ts">
import ThicknessPresetsEditor from '@/components/ThicknessPresetsEditor.vue'
import UnderlayPanel from '@/components/editor/UnderlayPanel.vue'
import type { ImageSize } from '@/utils/imageSize'

defineProps<{
  /** The document's wall thickness presets (spec §5.9 tier 2). */
  thicknessPresetsIn: readonly number[]
  /** Natural pixel size of the underlay image, for centre-anchored rotation. */
  underlayImageSize: ImageSize | null
}>()

const emit = defineEmits<{
  'set-thickness-presets': [presetsIn: number[]]
  /** Forwarded from the underlay controls — the page arms the Calibrate tool (spec U2). */
  recalibrate: []
}>()
</script>

<template>
  <section aria-label="Structure overview" class="flex flex-col gap-4 text-xs">
    <UnderlayPanel :underlay-image-size="underlayImageSize" @recalibrate="emit('recalibrate')" />

    <div class="border-line border-t pt-4">
      <span class="text-ink text-sm font-semibold">Wall thickness presets</span>
      <p class="text-ink-muted mt-0.5 mb-1">Exterior first; the last is the interior default.</p>
      <ThicknessPresetsEditor
        :presets-in="thicknessPresetsIn"
        @change="emit('set-thickness-presets', $event)"
      />
    </div>
  </section>
</template>
