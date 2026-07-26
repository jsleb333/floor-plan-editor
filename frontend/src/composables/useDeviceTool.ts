import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import { DEFAULT_BASEBOARD_LENGTH_IN, catalogEntry } from '@/devices/catalog'
import type { Device, DeviceType, Point, Wall } from '@/types/plan'
import {
  deviceWallGaps,
  projectDeviceOntoWalls,
  wallSegmentSpan,
  type DeviceGaps,
} from '@/utils/geometry'
import { formatFeetInches, parseFeetInches } from '@/utils/units'

import { GRID_STEP_IN } from './useSnapping'
import type { SnapSettings } from './useSnapping'
import { isBufferKey } from './useWallTool'

/** Capture radius (screen px) for hovering a host wall (matches the opening tool). */
const PLACEMENT_RADIUS_PX = 16
/** Placeholder id of the preview device (never committed). */
const PREVIEW_ID = 'device-preview'

/**
 * Per-type draft applied to the next placed device (spec E8/§6.1): edited
 * live in the Device tool options while a type is armed. Fields left unset
 * (`null`) fall back to `baseDevice`'s hardcoded defaults, never to another
 * type's draft — the map this lives in is keyed by `DeviceType` precisely so
 * a water heater's load override can never leak onto the next outlet.
 */
export interface DeviceDraft {
  label: string | null
  load_w: number | null
  length_in: number | null
}

export interface UseDeviceToolOptions {
  /** The armed device type, or `null` when the picker is shown (spec §6.1). */
  armedType: Ref<DeviceType | null>
  /** Existing walls to host wall-mounted devices. */
  walls: Ref<readonly Wall[]>
  /** Current screen pixels per world inch, to convert the capture radius. */
  pixelsPerInch: Ref<number>
  /** Shared snap toggles (grid used for free/ceiling placement). */
  snapSettings: SnapSettings
  /** Receives each placed device; the caller dispatches the store command. */
  commit: (device: Device) => void
  /**
   * Last-used per-type draft (label/load/baseboard length), owned by the
   * page like the armed type itself (spec E8) and edited by
   * `DeviceToolOptions`. A type absent from the map places with the plain
   * catalog defaults.
   */
  drafts: Ref<Partial<Record<DeviceType, DeviceDraft>>>
  /** Display precision for the dimension chips (spec §5.9 tier 2); 1/8" when omitted. */
  displayPrecisionIn?: Ref<number> | ComputedRef<number>
}

/** One temporary-dimension chip shown during placement (spec S2a). */
export interface DeviceToolChip {
  side: 'left' | 'right'
  distanceIn: number
  label: string
  from: Point
  to: Point
  /** The chip a typed value applies to (Tab switches, spec S2a). */
  active: boolean
}

export interface UseDeviceToolReturn {
  /** The device the next click would place, derived from the cursor + armed type. */
  preview: ComputedRef<Device | null>
  /** Live along-wall temporary dimensions for a wall-mounted preview (spec S2a). */
  chips: ComputedRef<DeviceToolChip[]>
  inputBuffer: Ref<string>
  setCursor: (point: Point | null) => void
  onClick: (world: Point) => void
  /**
   * Routes a key press; returns true when consumed. Escape disarms to the
   * picker, Tab switches the active dimension side, and digits/Enter drive the
   * typed-exact-position buffer (spec S2a).
   */
  handleKey: (key: string) => boolean
  /** Clears the cursor and typed buffer (on tool switch / disarm). */
  deactivate: () => void
}

/**
 * Device placement tool (specs D1, S2a, §6.1). While a type is armed, the
 * cursor previews a device: wall-mounted types snap onto the nearest wall face
 * (the cursor's side of the wall picks the attachment face) with live
 * temporary dimensions to the nearest crossing walls/corners; ceiling and
 * free types place at the grid-snapped cursor. Clicking commits and the tool
 * stays armed for repeat placement; typing a length repositions exactly.
 *
 * Headless by design: all inputs are injected and interaction arrives via
 * methods, so the machine is testable without a DOM.
 */
export function useDeviceTool(options: UseDeviceToolOptions): UseDeviceToolReturn {
  const { armedType, walls, pixelsPerInch, snapSettings, commit, drafts } = options

  const cursor: ShallowRef<Point | null> = shallowRef(null)
  const inputBuffer = ref('')
  const activeSide = ref<'left' | 'right'>('left')

  function thresholdIn(): number {
    return PLACEMENT_RADIUS_PX / Math.max(pixelsPerInch.value, Number.EPSILON)
  }

  function wallById(id: string): Wall | null {
    return walls.value.find((wall) => wall.id === id) ?? null
  }

  function baseDevice(type: DeviceType): Omit<Device, 'attachment' | 'position'> {
    const draft = drafts.value[type]
    return {
      id: PREVIEW_ID,
      type,
      rotation_deg: 0,
      label: draft?.label ?? null,
      load_w: draft?.load_w ?? null,
      length_in:
        draft?.length_in ?? (type === 'baseboard_heater' ? DEFAULT_BASEBOARD_LENGTH_IN : null),
      notes: null,
    }
  }

  function deviceAt(world: Point): Device | null {
    const type = armedType.value
    if (!type) return null
    const base = baseDevice(type)
    if (catalogEntry(type).mount === 'wall') {
      const placement = projectDeviceOntoWalls(world, walls.value, thresholdIn())
      if (!placement) return null
      return {
        ...base,
        attachment: {
          wall_id: placement.wallId,
          segment_index: placement.segmentIndex,
          t: placement.tIn,
          side: placement.side,
        },
        position: null,
      }
    }
    let point = { ...world }
    if (snapSettings.grid.value) {
      point = {
        x: Math.round(point.x / GRID_STEP_IN) * GRID_STEP_IN,
        y: Math.round(point.y / GRID_STEP_IN) * GRID_STEP_IN,
      }
    }
    return { ...base, attachment: null, position: point }
  }

  const preview = computed<Device | null>(() => (cursor.value ? deviceAt(cursor.value) : null))

  function gapsFor(device: Device): DeviceGaps | null {
    if (!device.attachment) return null
    const host = wallById(device.attachment.wall_id)
    if (!host) return null
    return deviceWallGaps(
      host,
      device.attachment.segment_index,
      device.attachment.t,
      device.attachment.side,
      walls.value,
    )
  }

  function effectiveSide(gaps: DeviceGaps): 'left' | 'right' {
    if (gaps[activeSide.value]) return activeSide.value
    return activeSide.value === 'left' ? 'right' : 'left'
  }

  const chips = computed<DeviceToolChip[]>(() => {
    const device = preview.value
    if (!device) return []
    const gaps = gapsFor(device)
    if (!gaps) return []
    const active = effectiveSide(gaps)
    const result: DeviceToolChip[] = []
    for (const gap of [gaps.left, gaps.right]) {
      if (!gap) continue
      result.push({
        side: gap.side,
        distanceIn: gap.distanceIn,
        label: formatFeetInches(gap.distanceIn, options.displayPrecisionIn?.value),
        from: gap.from,
        to: gap.to,
        active: gap.side === active,
      })
    }
    return result
  })

  function setCursor(point: Point | null): void {
    cursor.value = point ? { ...point } : null
  }

  function onClick(world: Point): void {
    const device = deviceAt(world)
    if (!device) return
    commit({ ...device, id: crypto.randomUUID() })
  }

  function applyTyped(): void {
    const typed = parseFeetInches(inputBuffer.value)
    inputBuffer.value = ''
    if (typed === null || typed < 0) return
    const device = preview.value
    if (!device?.attachment) return
    const gaps = gapsFor(device)
    if (!gaps) return
    const side = effectiveSide(gaps)
    const gap = gaps[side]
    if (!gap) return
    const host = wallById(device.attachment.wall_id)
    const span = host ? wallSegmentSpan(host, device.attachment.segment_index) : null
    if (!span) return
    const rawT = side === 'left' ? gap.featureT + typed : gap.featureT - typed
    const t = Math.max(0, Math.min(rawT, span.lengthIn))
    commit({ ...device, id: crypto.randomUUID(), attachment: { ...device.attachment, t } })
  }

  function handleKey(key: string): boolean {
    if (key === 'Escape') {
      if (armedType.value === null) return false
      armedType.value = null
      inputBuffer.value = ''
      return true
    }
    if (armedType.value === null) return false
    if (key === 'Tab') {
      activeSide.value = activeSide.value === 'left' ? 'right' : 'left'
      return true
    }
    // The typed buffer only applies to wall-mounted previews (spec S2a).
    if (!preview.value?.attachment) return false
    if (key === 'Enter') {
      if (inputBuffer.value === '') return false
      applyTyped()
      return true
    }
    if (key === 'Backspace') {
      if (inputBuffer.value === '') return false
      inputBuffer.value = inputBuffer.value.slice(0, -1)
      return true
    }
    if (isBufferKey(key)) {
      if (key === ' ' && inputBuffer.value === '') return false
      inputBuffer.value += key
      return true
    }
    return false
  }

  function deactivate(): void {
    cursor.value = null
    inputBuffer.value = ''
    activeSide.value = 'left'
  }

  return { preview, chips, inputBuffer, setCursor, onClick, handleKey, deactivate }
}
