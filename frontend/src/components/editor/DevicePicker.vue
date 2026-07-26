<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import DeviceGlyph from '@/components/editor/DeviceGlyph.vue'
import { DEVICE_CATALOG, DEVICE_GROUPS, searchDeviceTypes } from '@/devices/catalog'
import type { DeviceGroupDefinition } from '@/devices/catalog'
import { useDeviceMruStore } from '@/stores/deviceMru'
import type { DeviceType } from '@/types/plan'

defineProps<{
  /** The armed type, highlighted in the grid; `null` when nothing is armed. */
  armedType: DeviceType | null
}>()

const emit = defineEmits<{
  /** The user picked a type to place (spec §6.1). */
  pick: [type: DeviceType]
}>()

const mru = useDeviceMruStore()

const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const results = computed<DeviceType[]>(() => searchDeviceTypes(query.value))

/** MRU types still present in the current results, shown as a quick-access row. */
const recentResults = computed<DeviceType[]>(() => {
  const set = new Set(results.value)
  return mru.recent.filter((type) => set.has(type))
})

interface DeviceGroupSection {
  group: DeviceGroupDefinition
  types: DeviceType[]
}

/** The current results sectioned by group, in display order; empty sections are omitted. */
const groupedResults = computed<DeviceGroupSection[]>(() => {
  const sections: DeviceGroupSection[] = []
  for (const group of DEVICE_GROUPS) {
    const types = results.value.filter((type) => DEVICE_CATALOG[type].group === group.id)
    if (types.length > 0) sections.push({ group, types })
  }
  return sections
})

function pick(type: DeviceType): void {
  mru.record(type)
  emit('pick', type)
}

onMounted(() => {
  searchInput.value?.focus()
})
</script>

<template>
  <section aria-label="Device picker" class="flex flex-col gap-3 text-xs">
    <header>
      <h3 class="text-ink text-sm font-semibold">Device</h3>
      <p class="text-ink-muted mt-1 leading-relaxed">
        Pick a pictogram, then click on the plan to place it. Wall devices snap to the nearest wall;
        ceiling and free devices drop at the cursor. Esc returns here.
      </p>
    </header>

    <input
      ref="searchInput"
      v-model="query"
      type="search"
      placeholder="Search devices…"
      aria-label="Search devices"
      class="border-line focus:border-accent w-full rounded-md border px-2 py-1.5 outline-none"
    />

    <div v-if="recentResults.length > 0" aria-label="Recent devices">
      <h4 class="text-ink-muted mb-1.5 font-semibold uppercase tracking-wide">Recent</h4>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="type in recentResults"
          :key="`mru-${type}`"
          type="button"
          :aria-pressed="type === armedType"
          class="border-line hover:border-accent flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors"
          :class="type === armedType ? 'border-accent bg-accent-soft text-accent' : 'text-ink'"
          @click="pick(type)"
        >
          <DeviceGlyph :type="type" :size="26" />
          <span class="text-ink-muted text-center leading-tight">{{
            DEVICE_CATALOG[type].label
          }}</span>
        </button>
      </div>
    </div>

    <div aria-label="All devices">
      <h4 class="text-ink-muted mb-1.5 font-semibold uppercase tracking-wide">All</h4>
      <div v-if="groupedResults.length > 0" class="flex flex-col gap-3">
        <section
          v-for="section in groupedResults"
          :key="section.group.id"
          :aria-label="section.group.label"
        >
          <h5 class="text-ink-faint mb-1.5 font-semibold uppercase tracking-wide">
            {{ section.group.label }}
          </h5>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="type in section.types"
              :key="type"
              type="button"
              :aria-pressed="type === armedType"
              :title="DEVICE_CATALOG[type].legendFr"
              class="border-line hover:border-accent flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors"
              :class="type === armedType ? 'border-accent bg-accent-soft text-accent' : 'text-ink'"
              @click="pick(type)"
            >
              <DeviceGlyph :type="type" :size="26" />
              <span class="text-ink-muted text-center leading-tight">{{
                DEVICE_CATALOG[type].label
              }}</span>
            </button>
          </div>
        </section>
      </div>
      <p v-else class="text-ink-muted">No devices match “{{ query }}”.</p>
    </div>
  </section>
</template>
