import { defineStore } from 'pinia'
import { ref } from 'vue'

import { DEVICE_CATALOG } from '@/devices/catalog'
import type { DeviceType } from '@/types/plan'

/** localStorage key for the most-recently-used device types (spec §6.1). */
const STORAGE_KEY = 'floorplan.device-mru'
/** How many recent types the picker floats to the top. */
const MRU_LIMIT = 6

function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && value in DEVICE_CATALOG
}

function loadMru(): DeviceType[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDeviceType).slice(0, MRU_LIMIT)
  } catch {
    return []
  }
}

/**
 * Most-recently-used device types for the picker (spec §6.1, App-preferences
 * tier §5.9): the last-picked types float to the top and persist across
 * sessions in the browser's localStorage.
 */
export const useDeviceMruStore = defineStore('device-mru', () => {
  const recent = ref<DeviceType[]>(loadMru())

  /** Records a picked type as most-recent, de-duplicated and capped. */
  function record(type: DeviceType): void {
    recent.value = [type, ...recent.value.filter((entry) => entry !== type)].slice(0, MRU_LIMIT)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.value))
    } catch {
      // Ignore storage failures (private mode / quota); MRU is a convenience.
    }
  }

  return { recent, record }
})
