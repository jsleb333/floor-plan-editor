<script setup lang="ts">
import DevicePictogramShapes from '@/components/editor/DevicePictogramShapes.vue'
import { DEVICE_TYPES } from '@/devices/catalog'
import { PICTOGRAM_VIEWBOX, pictogramSymbolId } from '@/devices/pictograms'
</script>

<template>
  <defs>
    <symbol
      v-for="type in DEVICE_TYPES"
      :id="pictogramSymbolId(type)"
      :key="type"
      :viewBox="PICTOGRAM_VIEWBOX"
      overflow="visible"
    >
      <DevicePictogramShapes :type="type" />
    </symbol>
  </defs>
</template>
