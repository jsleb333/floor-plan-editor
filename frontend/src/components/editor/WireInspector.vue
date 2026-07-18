<script setup lang="ts">
import { Spline, Trash2 } from 'lucide-vue-next'
import { computed } from 'vue'

import { catalogEntry } from '@/devices/catalog'
import type { Circuit, Device, Wall, Wire } from '@/types/plan'
import { autoCurveControlPoints, wireEndpoint } from '@/utils/geometry'

const props = defineProps<{
  wire: Wire
  /** All circuits, for the reassignment select. */
  circuits: readonly Circuit[]
  /** All devices, to describe the wire's endpoints. */
  devices: readonly Device[]
  /** All walls, to resolve attached-device centres for the straighten action. */
  walls: readonly Wall[]
}>()

const emit = defineEmits<{
  'update-wire': [wire: Wire]
  'delete-selection': []
}>()

function deviceById(id: string): Device | undefined {
  return props.devices.find((device) => device.id === id)
}

function endpointLabel(deviceId: string): string {
  const device = deviceById(deviceId)
  if (!device) return 'missing device'
  return device.label || catalogEntry(device.type).label
}

const fromLabel = computed(() => endpointLabel(props.wire.from_device_id))
const toLabel = computed(() => endpointLabel(props.wire.to_device_id))

const circuit = computed<Circuit | undefined>(() =>
  props.circuits.find((candidate) => candidate.id === props.wire.circuit_id),
)

function reassign(event: Event): void {
  if (event.target instanceof HTMLSelectElement) {
    emit('update-wire', { ...props.wire, circuit_id: event.target.value })
  }
}

function straighten(): void {
  const from = wireEndpoint(deviceById(props.wire.from_device_id), props.walls)
  const to = wireEndpoint(deviceById(props.wire.to_device_id), props.walls)
  if (!from || !to) return
  emit('update-wire', { ...props.wire, control_points: autoCurveControlPoints(from, to) })
}
</script>

<template>
  <section aria-label="Wire inspector" class="flex flex-col gap-4 text-xs">
    <header class="flex items-center gap-2">
      <span
        class="h-4 w-4 shrink-0 rounded"
        :style="{ backgroundColor: circuit?.color ?? '#64748b' }"
        aria-hidden="true"
      />
      <div>
        <h3 class="text-ink text-sm font-semibold">Wire</h3>
        <p class="text-ink-muted">{{ circuit?.name ?? 'Unassigned circuit' }}</p>
      </div>
    </header>

    <label class="block">
      <span class="text-ink font-semibold">Circuit</span>
      <select
        :value="wire.circuit_id"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Wire circuit"
        @change="reassign"
      >
        <option v-for="candidate in circuits" :key="candidate.id" :value="candidate.id">
          {{ candidate.name }}
        </option>
      </select>
    </label>

    <div aria-label="Endpoints">
      <h4 class="text-ink mb-1 font-semibold">Endpoints</h4>
      <dl class="text-ink-muted grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt>From</dt>
        <dd class="text-ink truncate">{{ fromLabel }}</dd>
        <dt>To</dt>
        <dd class="text-ink truncate">{{ toLabel }}</dd>
      </dl>
    </div>

    <button
      type="button"
      class="border-line text-ink-muted hover:text-ink hover:bg-canvas flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="straighten"
    >
      <Spline :size="13" aria-hidden="true" />
      Straighten curve
    </button>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-selection')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete wire
    </button>
  </section>
</template>
