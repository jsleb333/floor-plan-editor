import type { PlanDocument } from '@/types/plan'

/**
 * Canonical keys of `PlanDocument.preset_lists` (spec §5.9 tier 2). Mirrors
 * the backend constants of the same name (`backend/constants.py`) — a key
 * absent from the document's map falls back to that list's built-in
 * defaults, so adding a new list never needs a schema change.
 */
export const PRESET_LIST_NAMES = {
  doorWidth: 'door_width',
  windowWidth: 'window_width',
  stairsWidth: 'stairs_width',
} as const

export type PresetListName = (typeof PRESET_LIST_NAMES)[keyof typeof PRESET_LIST_NAMES]

/** Two preset values within this many inches of each other are the same entry. */
export const PRESET_VALUE_TOLERANCE_IN = 1e-9

/** Preset lists are capped at this many entries; the farthest-from-new one is dropped past it. */
export const MAX_PRESET_LIST_SIZE = 10

const BUILTIN_PRESETS_IN: Record<PresetListName, readonly number[]> = {
  [PRESET_LIST_NAMES.doorWidth]: [24, 28, 30, 32, 36],
  [PRESET_LIST_NAMES.windowWidth]: [24, 36, 48, 60, 72],
  [PRESET_LIST_NAMES.stairsWidth]: [30, 36, 42, 48],
}

/**
 * Resolves the effective preset list `name` for `document`: the plan's own
 * grown list when present, else the built-in defaults. A `document` of
 * `null`/`undefined` (not yet loaded) also falls back to the defaults.
 */
export function resolve(
  name: PresetListName,
  document: Pick<PlanDocument, 'preset_lists'> | null | undefined,
): readonly number[] {
  return document?.preset_lists[name] ?? BUILTIN_PRESETS_IN[name]
}

/**
 * Returns `list` with `value` inserted, ascending and de-duplicated within
 * `PRESET_VALUE_TOLERANCE_IN` (a value already present, within tolerance, is
 * a no-op — the existing entry is kept as-is). Past `MAX_PRESET_LIST_SIZE`
 * entries, the value farthest from the newly added `value` is dropped, so
 * the user's own recent pick survives over stale ones. Never mutates `list`.
 */
export function withValue(list: readonly number[], value: number): number[] {
  const alreadyPresent = list.some(
    (existing) => Math.abs(existing - value) < PRESET_VALUE_TOLERANCE_IN,
  )
  const next = alreadyPresent ? [...list] : [...list, value].sort((a, b) => a - b)
  if (next.length <= MAX_PRESET_LIST_SIZE) return next

  let farthestIndex = 0
  let farthestDistance = -Infinity
  next.forEach((entry, index) => {
    const distance = Math.abs(entry - value)
    if (distance > farthestDistance) {
      farthestDistance = distance
      farthestIndex = index
    }
  })
  next.splice(farthestIndex, 1)
  return next
}
