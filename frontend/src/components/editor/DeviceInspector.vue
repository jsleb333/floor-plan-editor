<script setup lang="ts">
import { Link2, Trash2, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import DeviceGlyph from '@/components/editor/DeviceGlyph.vue'
import {
  BASEBOARD_WATTAGE_PRESETS,
  catalogEntry,
  effectiveDefaultLoad,
  effectiveDeviceLoad,
} from '@/devices/catalog'
import { useDisplayPrecision } from '@/composables/useDisplayPrecision'
import type { ControlLink, Device, Wall } from '@/types/plan'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

const props = defineProps<{
  /** The selected devices (one for full editing, many for the bulk summary). */
  devices: readonly Device[]
  /** All walls, to describe a device's host attachment. */
  walls: readonly Wall[]
  /** Plan-level per-type default loads (spec §5.9 tier 2). */
  catalogDefaults: Record<string, number>
  /** All devices, to name control-link targets (spec D6). */
  allDevices: readonly Device[]
  /** All control links, to list the selected switch's links (spec D6). */
  controlLinks: readonly ControlLink[]
  /** The switch whose control link is being armed (pick-target mode), else null. */
  armedControlLinkSwitchId: string | null
}>()

const emit = defineEmits<{
  /** Whole-device replacement — the page dispatches ONE updateDevice (one undo step). */
  'update-device': [device: Device]
  /** Replaces several devices at once — the page coalesces them into one undo step. */
  'bulk-update-devices': [devices: Device[]]
  'delete-selection': []
  /** Arms/cancels pick-target mode for a switch's control link (spec D6). */
  'arm-control-link': [switchId: string]
  /** Removes a control link (spec D6). */
  'remove-control-link': [linkId: string]
}>()

const precisionIn = useDisplayPrecision()

const labelDraft = ref('')
const lengthDraft = ref('')
const rotationDraft = ref('')
const notesDraft = ref('')
// Vue casts a `v-model` bound to `type="number"` to a number as soon as the
// text parses, so these two hold either; the type keeps callers honest.
const loadDraft = ref<string | number>('')
const bulkLoadDraft = ref<string | number>('')

const single = computed<Device | null>(() => (props.devices.length === 1 ? props.devices[0] : null))
const entry = computed(() => (single.value ? catalogEntry(single.value.type) : null))

const hostWall = computed<Wall | null>(() => {
  const device = single.value
  if (!device?.attachment) return null
  return props.walls.find((wall) => wall.id === device.attachment?.wall_id) ?? null
})

const defaultLoad = computed(() =>
  single.value ? effectiveDefaultLoad(single.value.type, props.catalogDefaults) : null,
)

const loadPlaceholder = computed(() => {
  const info = defaultLoad.value
  if (!info) return ''
  const prefix = info.source === 'plan' ? 'plan default' : 'default'
  return `${prefix} ${info.value} W`
})

const voltageLabel = computed(() => {
  const volts = entry.value?.voltage_v
  return volts === null || volts === undefined ? '—' : `${volts} V`
})

const baseboardAmps = computed(() => {
  const device = single.value
  if (!device || device.type !== 'baseboard_heater') return null
  const volts = entry.value?.voltage_v
  if (!volts) return null
  return effectiveDeviceLoad(device, props.catalogDefaults) / volts
})

const isSwitch = computed(
  () => single.value?.type === 'switch' || single.value?.type === 'switch_3way',
)

const switchLinks = computed<ControlLink[]>(() => {
  const device = single.value
  if (!device) return []
  return props.controlLinks.filter((link) => link.switch_id === device.id)
})

const armed = computed(
  () => single.value !== null && props.armedControlLinkSwitchId === single.value.id,
)

function targetLabel(deviceId: string): string {
  const target = props.allDevices.find((device) => device.id === deviceId)
  if (!target) return 'missing device'
  return target.label || catalogEntry(target.type).label
}

function toggleLinkMode(): void {
  if (single.value) emit('arm-control-link', single.value.id)
}

const bulkType = computed(() => {
  if (props.devices.length < 2) return null
  const first = props.devices[0].type
  return props.devices.every((device) => device.type === first) ? first : null
})

function update(patch: Partial<Device>): void {
  if (!single.value) return
  emit('update-device', { ...single.value, ...patch })
}

function applyLabel(): void {
  const text = labelDraft.value.trim()
  update({ label: text === '' ? null : labelDraft.value })
}

function applyLoad(): void {
  const text = String(loadDraft.value).trim()
  if (text === '') {
    update({ load_w: null })
    return
  }
  const parsed = Number.parseFloat(text)
  if (Number.isFinite(parsed) && parsed >= 0) update({ load_w: parsed })
}

function applyLength(): void {
  const parsed = parseFeetInches(lengthDraft.value)
  if (parsed !== null && parsed > 0) {
    update({ length_in: parsed })
    lengthDraft.value = ''
  }
}

function applyRotation(): void {
  const parsed = Number.parseFloat(rotationDraft.value)
  if (Number.isFinite(parsed)) {
    update({ rotation_deg: parsed })
    rotationDraft.value = ''
  }
}

function applyNotes(): void {
  const text = notesDraft.value.trim()
  update({ notes: text === '' ? null : notesDraft.value })
}

function setWattage(watts: number): void {
  update({ load_w: watts })
}

function applyBulkLoad(): void {
  const text = String(bulkLoadDraft.value).trim()
  const parsed = text === '' ? null : Number.parseFloat(text)
  if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return
  emit(
    'bulk-update-devices',
    props.devices.map((device) => ({ ...device, load_w: parsed })),
  )
  bulkLoadDraft.value = ''
}

watch(
  single,
  (device) => {
    labelDraft.value = device?.label ?? ''
    loadDraft.value = device?.load_w === null || device === null ? '' : String(device.load_w)
    notesDraft.value = device?.notes ?? ''
    lengthDraft.value = ''
    rotationDraft.value = ''
  },
  { immediate: true },
)
</script>

<template>
  <section v-if="single && entry" aria-label="Device inspector" class="flex flex-col gap-4 text-xs">
    <header class="flex items-center gap-2">
      <span class="text-ink"><DeviceGlyph :type="single.type" :size="30" /></span>
      <div>
        <h3 class="text-ink text-sm font-semibold">{{ entry.label }}</h3>
        <p class="text-ink-muted">{{ entry.legendFr }} · {{ voltageLabel }}</p>
      </div>
    </header>

    <label class="block">
      <span class="text-ink font-semibold">Label</span>
      <input
        v-model="labelDraft"
        type="text"
        placeholder="Optional label"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Device label"
        @keydown.enter.prevent="applyLabel"
        @blur="applyLabel"
      />
    </label>

    <label class="block">
      <span class="text-ink font-semibold">Load override</span>
      <div class="mt-1 flex items-center gap-2">
        <input
          v-model="loadDraft"
          type="number"
          min="0"
          :placeholder="loadPlaceholder"
          class="border-line focus:border-accent w-full rounded-md border px-2 py-1 outline-none"
          aria-label="Load override in watts"
          @keydown.enter.prevent="applyLoad"
          @blur="applyLoad"
        />
        <span class="text-ink-muted">W</span>
      </div>
      <p class="text-ink-faint mt-1">Leave blank to use the {{ loadPlaceholder }}.</p>
    </label>

    <div v-if="single.type === 'baseboard_heater'" aria-label="Baseboard properties">
      <h4 class="text-ink mb-1 font-semibold">Baseboard</h4>
      <label class="block">
        <span class="text-ink-muted">Length</span>
        <input
          v-model="lengthDraft"
          type="text"
          :placeholder="formatFeetInches(single.length_in ?? 0, precisionIn)"
          class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
          aria-label="Baseboard length in feet and inches"
          @keydown.enter.prevent="applyLength"
          @blur="applyLength"
        />
      </label>
      <div class="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Wattage presets">
        <button
          v-for="watts in BASEBOARD_WATTAGE_PRESETS"
          :key="watts"
          type="button"
          :aria-pressed="single.load_w === watts"
          class="rounded-md border px-2 py-1 transition-colors"
          :class="
            single.load_w === watts
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-muted hover:text-ink'
          "
          @click="setWattage(watts)"
        >
          {{ watts }} W
        </button>
      </div>
      <p v-if="baseboardAmps !== null" class="text-ink-muted mt-2 tabular-nums">
        {{ baseboardAmps.toFixed(1) }} A at {{ voltageLabel }}
      </p>
    </div>

    <div v-if="single.attachment && hostWall" aria-label="Attachment">
      <h4 class="text-ink mb-1 font-semibold">Attachment</h4>
      <dl class="text-ink-muted grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
        <dt>Host wall</dt>
        <dd class="text-ink truncate">{{ hostWall.id }}</dd>
        <dt>Face</dt>
        <dd class="text-ink capitalize">{{ single.attachment.side }}</dd>
        <dt>Segment</dt>
        <dd class="text-ink">{{ single.attachment.segment_index + 1 }}</dd>
        <dt>Offset</dt>
        <dd class="text-ink">{{ formatFeetInches(single.attachment.t, precisionIn) }}</dd>
      </dl>
    </div>

    <label v-if="single.position" class="block">
      <span class="text-ink font-semibold">Rotation</span>
      <input
        v-model="rotationDraft"
        type="text"
        :placeholder="`${single.rotation_deg}°`"
        class="border-line focus:border-accent mt-1 w-full rounded-md border px-2 py-1 outline-none"
        aria-label="Device rotation in degrees"
        @keydown.enter.prevent="applyRotation"
        @blur="applyRotation"
      />
    </label>

    <div v-if="isSwitch" aria-label="Control links">
      <h4 class="text-ink mb-1 font-semibold">Controls</h4>
      <ul v-if="switchLinks.length > 0" class="mb-2 flex flex-col gap-1">
        <li
          v-for="link in switchLinks"
          :key="link.id"
          class="border-line flex items-center gap-1.5 rounded-md border px-2 py-1"
        >
          <span class="text-ink flex-1 truncate">
            {{ targetLabel(link.target_id) }}
            <span v-if="link.kind === 'three_way_pair'" class="text-ink-faint">(3-way)</span>
          </span>
          <button
            type="button"
            class="text-ink-faint hover:text-danger rounded p-0.5 transition-colors"
            :aria-label="`Remove control link`"
            @click="emit('remove-control-link', link.id)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
        :class="
          armed
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line text-ink-muted hover:text-ink hover:border-accent'
        "
        :aria-pressed="armed"
        @click="toggleLinkMode"
      >
        <Link2 :size="13" aria-hidden="true" />
        {{ armed ? 'Click a device to link… (Esc cancels)' : 'Link to device…' }}
      </button>
    </div>

    <label class="block">
      <span class="text-ink font-semibold">Notes</span>
      <textarea
        v-model="notesDraft"
        rows="2"
        placeholder="Optional notes"
        class="border-line focus:border-accent mt-1 w-full resize-y rounded-md border px-2 py-1 outline-none"
        aria-label="Device notes"
        @blur="applyNotes"
      />
    </label>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-selection')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete {{ entry.label.toLowerCase() }}
    </button>
  </section>

  <section v-else aria-label="Device selection summary" class="flex flex-col gap-3 text-xs">
    <h3 class="text-ink text-sm font-semibold">Devices</h3>
    <p class="text-ink-muted">{{ devices.length }} devices selected.</p>

    <label v-if="bulkType" class="block">
      <span class="text-ink font-semibold">Set load for all</span>
      <div class="mt-1 flex items-center gap-2">
        <input
          v-model="bulkLoadDraft"
          type="number"
          min="0"
          placeholder="watts (blank = default)"
          class="border-line focus:border-accent w-full rounded-md border px-2 py-1 outline-none"
          aria-label="Bulk load override in watts"
          @keydown.enter.prevent="applyBulkLoad"
        />
        <span class="text-ink-muted">W</span>
      </div>
    </label>

    <button
      type="button"
      class="border-danger/40 text-danger hover:bg-danger-soft flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors"
      @click="emit('delete-selection')"
    >
      <Trash2 :size="13" aria-hidden="true" />
      Delete selection
    </button>
  </section>
</template>
