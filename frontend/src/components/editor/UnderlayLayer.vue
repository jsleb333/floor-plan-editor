<script setup lang="ts">
import { computed } from 'vue'

import { assetUrl } from '@/persistence/rest/restAssetsAdapter'
import { UNDERLAY_ELEMENT_ID, useEditorStore } from '@/stores/editor'
import type { Underlay } from '@/types/plan'
import type { ImageSize } from '@/utils/imageSize'

const props = defineProps<{
  /** World-unit stroke width rendering as ~1px on screen. */
  hairline: number
  /** Natural pixel size of the underlay image; nothing renders until it is known. */
  size: ImageSize | null
}>()

const editorStore = useEditorStore()

const underlay = computed<Underlay | null>(() => {
  void editorStore.documentVersion
  return editorStore.document?.underlay ?? null
})

const href = computed(() => (underlay.value ? assetUrl(underlay.value.image_ref) : ''))

const transform = computed(() => {
  const t = underlay.value?.transform
  if (!t) return ''
  return `translate(${t.origin.x} ${t.origin.y}) rotate(${t.rotation_deg}) scale(${t.scale})`
})

const selected = computed(() =>
  editorStore.isSelected({ kind: 'underlay', id: UNDERLAY_ELEMENT_ID }),
)

/** Stroke values compensated for the group's pixel->inch scale so they stay ~screen-sized. */
const selectionStroke = computed(() => {
  const scale = underlay.value?.transform.scale ?? 1
  const unit = props.hairline / scale
  return { width: 1.5 * unit, dash: `${6 * unit} ${4 * unit}` }
})
</script>

<template>
  <g
    v-if="underlay && underlay.visible && size"
    aria-label="Underlay"
    :transform="transform"
    :opacity="underlay.opacity"
  >
    <image :href="href" :width="size.width" :height="size.height" />
    <rect
      v-if="selected"
      :width="size.width"
      :height="size.height"
      fill="none"
      class="stroke-accent"
      :stroke-width="selectionStroke.width"
      :stroke-dasharray="selectionStroke.dash"
    />
  </g>
</template>
