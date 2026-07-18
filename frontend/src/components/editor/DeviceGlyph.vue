<script setup lang="ts">
import DevicePictogramShapes from '@/components/editor/DevicePictogramShapes.vue'
import { PICTOGRAM_VIEWBOX } from '@/devices/pictograms'
import type { DeviceType } from '@/types/plan'

defineProps<{
  type: DeviceType
  /** Rendered box size in pixels (defaults to a picker-button icon). */
  size?: number
}>()
</script>

<template>
  <svg
    :viewBox="PICTOGRAM_VIEWBOX"
    :width="size ?? 28"
    :height="size ?? 28"
    aria-hidden="true"
    class="text-ink"
  >
    <DevicePictogramShapes :type="type" :stroke-width="1" />
  </svg>
</template>
