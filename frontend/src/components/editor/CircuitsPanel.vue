<script setup lang="ts">
import { Eye, EyeOff, Plus, Trash2, TriangleAlert } from 'lucide-vue-next'
import { computed } from 'vue'

import { useCircuitValidation } from '@/composables/useCircuitValidation'
import { catalogEntry } from '@/devices/catalog'
import { useEditorStore } from '@/stores/editor'
import { useLayersStore } from '@/stores/layers'
import type { Circuit, CircuitLoad } from '@/types/plan'

/** Breaker ratings offered when creating or editing a circuit (spec C1). */
const BREAKER_RATINGS: readonly number[] = [15, 20, 30, 40]
const NEW_CIRCUIT_BREAKER_A = 15
const NEW_CIRCUIT_VOLTAGE_V = 120

const editorStore = useEditorStore()
const layersStore = useLayersStore()
const { validation, loadByCircuit } = useCircuitValidation()

const circuits = computed<readonly Circuit[]>(() => {
  void editorStore.documentVersion
  return editorStore.document?.circuits ?? []
})

const unassignedDevices = computed(() => {
  void editorStore.documentVersion
  const devices = editorStore.document?.devices ?? []
  const ids = new Set(validation.value.unassigned_device_ids)
  return devices.filter((device) => ids.has(device.id))
})

function loadFor(circuitId: string): CircuitLoad | undefined {
  return loadByCircuit.value.get(circuitId)
}

/** Bar fill fraction (0..1) from the circuit's amps against its breaker. */
function fillFraction(load: CircuitLoad | undefined): number {
  if (!load || load.amps === null || load.breaker_a <= 0) return 0
  return Math.min(1, load.amps / load.breaker_a)
}

function barClass(load: CircuitLoad | undefined): string {
  if (!load) return 'bg-ink-faint'
  if (load.status === 'over') return 'bg-danger'
  if (load.status === 'warning') return 'bg-amber-500'
  return 'bg-emerald-500'
}

function loadLabel(load: CircuitLoad | undefined, circuit: Circuit): string {
  if (!load || load.amps === null) return 'no load'
  return `${Math.round(load.load_w)} W · ${load.amps.toFixed(1)} / ${circuit.breaker_a} A`
}

function update(circuit: Circuit, patch: Partial<Circuit>): void {
  editorStore.mutate({
    type: 'updateCircuit',
    circuitId: circuit.id,
    circuit: { ...circuit, ...patch },
  })
}

function onNameInput(circuit: Circuit, event: Event): void {
  if (event.target instanceof HTMLInputElement) update(circuit, { name: event.target.value })
}

function onColorInput(circuit: Circuit, event: Event): void {
  if (event.target instanceof HTMLInputElement) update(circuit, { color: event.target.value })
}

function onBreakerChange(circuit: Circuit, event: Event): void {
  if (event.target instanceof HTMLSelectElement) {
    update(circuit, { breaker_a: Number.parseInt(event.target.value, 10) })
  }
}

function onKindChange(circuit: Circuit, event: Event): void {
  if (event.target instanceof HTMLSelectElement) {
    update(circuit, { kind: event.target.value as Circuit['kind'] })
  }
}

function createCircuit(): void {
  const id = crypto.randomUUID()
  const count = circuits.value.length
  editorStore.mutate({
    type: 'addCircuit',
    circuit: {
      id,
      name: `Circuit ${count + 1}`,
      color: editorStore.nextCircuitColor(),
      breaker_a: NEW_CIRCUIT_BREAKER_A,
      voltage_v: NEW_CIRCUIT_VOLTAGE_V,
      kind: 'power',
    },
  })
  editorStore.setActiveCircuit(id)
}

function removeCircuit(circuit: Circuit): void {
  editorStore.mutate({ type: 'removeCircuit', circuitId: circuit.id })
}

function selectRow(circuit: Circuit): void {
  editorStore.toggleIsolatedCircuit(circuit.id)
}

function selectDevice(deviceId: string): void {
  editorStore.select([{ kind: 'device', id: deviceId }])
}

function deviceLabel(type: string): string {
  return catalogEntry(type as Parameters<typeof catalogEntry>[0]).label
}
</script>

<template>
  <section aria-label="Circuits" class="flex flex-col gap-3 text-xs">
    <header class="flex items-center justify-between">
      <h3 class="text-ink text-sm font-semibold">Circuits</h3>
      <button
        type="button"
        class="border-line text-ink-muted hover:text-ink hover:border-accent flex items-center gap-1 rounded-md border px-2 py-1 transition-colors"
        @click="createCircuit"
      >
        <Plus :size="13" aria-hidden="true" />
        New circuit
      </button>
    </header>

    <p v-if="circuits.length === 0" class="text-ink-muted leading-relaxed">
      No circuits yet. Create one, then draw wires with the Wire tool (R) to connect a source — the
      panel, or a feed from another floor — to your devices.
    </p>

    <ul class="flex flex-col gap-2">
      <li
        v-for="circuit in circuits"
        :key="circuit.id"
        class="rounded-md border p-2 transition-colors"
        :class="
          editorStore.activeCircuitId === circuit.id
            ? 'border-accent bg-accent-soft'
            : 'border-line hover:border-accent/50'
        "
      >
        <div class="flex items-center gap-2">
          <label
            class="relative h-5 w-5 shrink-0 cursor-pointer rounded"
            :style="{ backgroundColor: circuit.color }"
            :aria-label="`${circuit.name} colour`"
          >
            <input
              type="color"
              :value="circuit.color"
              class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              @input="onColorInput(circuit, $event)"
            />
          </label>
          <button
            type="button"
            class="flex-1 truncate text-left"
            :aria-pressed="editorStore.isolatedCircuitId === circuit.id"
            @click="selectRow(circuit)"
          >
            <input
              :value="circuit.name"
              class="text-ink w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 font-medium focus:border-accent focus:bg-surface"
              :aria-label="`Circuit name`"
              @click.stop
              @input="onNameInput(circuit, $event)"
            />
          </button>
          <span
            v-if="editorStore.isolatedCircuitId === circuit.id"
            class="text-accent shrink-0 text-[10px] font-semibold uppercase"
          >
            Isolated
          </span>
          <button
            type="button"
            class="hover:bg-canvas rounded p-1 transition-colors"
            :class="layersStore.isCircuitWiresVisible(circuit.id) ? 'text-ink' : 'text-ink-faint'"
            :aria-pressed="layersStore.isCircuitWiresVisible(circuit.id)"
            :aria-label="
              layersStore.isCircuitWiresVisible(circuit.id)
                ? `Hide ${circuit.name} wires`
                : `Show ${circuit.name} wires`
            "
            @click="layersStore.toggleCircuitWires(circuit.id)"
          >
            <component
              :is="layersStore.isCircuitWiresVisible(circuit.id) ? Eye : EyeOff"
              :size="13"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="text-ink-faint hover:text-danger rounded p-1 transition-colors"
            :aria-label="`Delete ${circuit.name}`"
            @click="removeCircuit(circuit)"
          >
            <Trash2 :size="13" aria-hidden="true" />
          </button>
        </div>

        <div class="mt-2 flex items-center gap-1.5">
          <select
            :value="circuit.breaker_a"
            class="border-line focus:border-accent rounded border px-1 py-0.5 tabular-nums outline-none"
            aria-label="Breaker rating"
            @change="onBreakerChange(circuit, $event)"
          >
            <option v-for="rating in BREAKER_RATINGS" :key="rating" :value="rating">
              {{ rating }} A
            </option>
          </select>
          <div class="flex overflow-hidden rounded border" role="group" aria-label="Voltage">
            <button
              v-for="volts in [120, 240]"
              :key="volts"
              type="button"
              class="px-1.5 py-0.5 tabular-nums transition-colors"
              :class="
                circuit.voltage_v === volts
                  ? 'bg-accent text-white'
                  : 'text-ink-muted hover:text-ink'
              "
              @click="update(circuit, { voltage_v: volts as 120 | 240 })"
            >
              {{ volts }}
            </button>
          </div>
          <select
            :value="circuit.kind"
            class="border-line focus:border-accent ml-auto rounded border px-1 py-0.5 outline-none"
            aria-label="Circuit kind"
            @change="onKindChange(circuit, $event)"
          >
            <option value="power">power</option>
            <option value="data">data</option>
            <option value="low_voltage">low-V</option>
          </select>
        </div>

        <div class="mt-2 flex items-center gap-2">
          <div class="bg-line h-1.5 flex-1 overflow-hidden rounded-full">
            <div
              class="h-full rounded-full transition-all"
              :class="barClass(loadFor(circuit.id))"
              :style="{ width: `${fillFraction(loadFor(circuit.id)) * 100}%` }"
            />
          </div>
          <span class="text-ink-muted shrink-0 tabular-nums">
            {{ loadLabel(loadFor(circuit.id), circuit) }}
          </span>
        </div>

        <p
          v-if="(loadFor(circuit.id)?.floating_device_ids.length ?? 0) > 0"
          class="text-amber-600 mt-1 flex items-center gap-1"
        >
          <TriangleAlert :size="12" aria-hidden="true" />
          {{ loadFor(circuit.id)?.floating_device_ids.length }} floating (not reaching a source)
        </p>
      </li>
    </ul>

    <section
      v-if="unassignedDevices.length > 0"
      aria-label="Unassigned devices"
      class="border-line mt-1 border-t pt-3"
    >
      <h4 class="text-ink flex items-center gap-1 font-semibold">
        <TriangleAlert :size="12" class="text-amber-600" aria-hidden="true" />
        Unassigned ({{ unassignedDevices.length }})
      </h4>
      <p class="text-ink-faint mt-0.5">Powered devices not wired to any circuit.</p>
      <ul class="mt-1.5 flex flex-col gap-1">
        <li v-for="device in unassignedDevices" :key="device.id">
          <button
            type="button"
            class="text-ink-muted hover:text-ink hover:bg-canvas w-full truncate rounded px-1.5 py-1 text-left transition-colors"
            @click="selectDevice(device.id)"
          >
            {{ device.label || deviceLabel(device.type) }}
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>
