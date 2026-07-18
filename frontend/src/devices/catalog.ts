import type { Device, DeviceType } from '@/types/plan'

/** How a device attaches to the plan (spec §5.4). */
export type DeviceMount = 'wall' | 'ceiling' | 'free'

/** One row of the device catalog (spec §5.4, D5), mirroring the backend registry. */
export interface DeviceCatalogEntry {
  /** English UI label shown in the picker and Inspector. */
  label: string
  /** French legend name from the spec table (the hand-drawn plan's legend). */
  legendFr: string
  /** How the device attaches: on a wall, on the ceiling, or free-standing. */
  mount: DeviceMount
  /** Nominal voltage; `null` for no-load control/data devices and the panel. */
  voltage_v: number | null
  /** Default electrical load in watts (before plan-level or per-device overrides). */
  default_load_w: number
  /** Extra terms the picker search matches beyond the label (spec §6.1). */
  searchTerms: readonly string[]
}

/** The ordered list of every device type — drives the picker layout (spec D5). */
export const DEVICE_TYPES: readonly DeviceType[] = [
  'outlet',
  'outlet_gfci',
  'switch',
  'switch_3way',
  'ceiling_light',
  'wall_light',
  'baseboard_heater',
  'thermostat',
  'water_heater',
  'air_exchanger',
  'central_vacuum',
  'vacuum_inlet',
  'smoke_detector',
  'network_jack',
  'panel',
]

/**
 * Data-driven device-type registry (spec D5): every placeable pictogram is one
 * row, and the editor reads mount/voltage/default-load/labels from here so new
 * types need no editor-logic changes. Values mirror the backend `DEVICE_CATALOG`.
 */
export const DEVICE_CATALOG: Record<DeviceType, DeviceCatalogEntry> = {
  outlet: {
    label: 'Outlet',
    legendFr: 'Prise électrique',
    mount: 'wall',
    voltage_v: 120,
    default_load_w: 180,
    searchTerms: ['receptacle', 'duplex', 'plug', 'prise'],
  },
  outlet_gfci: {
    label: 'GFCI outlet',
    legendFr: 'Prise DDFT',
    mount: 'wall',
    voltage_v: 120,
    default_load_w: 180,
    searchTerms: ['gfci', 'ground fault', 'ddft', 'prise', 'receptacle'],
  },
  switch: {
    label: 'Switch',
    legendFr: 'Interrupteur simple',
    mount: 'wall',
    voltage_v: null,
    default_load_w: 0,
    searchTerms: ['single pole', 'interrupteur'],
  },
  switch_3way: {
    label: '3-way switch',
    legendFr: 'Interrupteur 3-way',
    mount: 'wall',
    voltage_v: null,
    default_load_w: 0,
    searchTerms: ['three way', '3 way', 'interrupteur'],
  },
  ceiling_light: {
    label: 'Ceiling light',
    legendFr: 'Luminaire plafond',
    mount: 'ceiling',
    voltage_v: 120,
    default_load_w: 15,
    searchTerms: ['luminaire', 'fixture', 'lamp'],
  },
  wall_light: {
    label: 'Wall light',
    legendFr: 'Luminaire mural',
    mount: 'wall',
    voltage_v: 120,
    default_load_w: 15,
    searchTerms: ['sconce', 'luminaire', 'fixture', 'lamp'],
  },
  baseboard_heater: {
    label: 'Baseboard heater',
    legendFr: 'Plinthe électrique',
    mount: 'wall',
    voltage_v: 240,
    default_load_w: 1000,
    searchTerms: ['plinthe', 'heat', 'heating', 'convector'],
  },
  thermostat: {
    label: 'Thermostat',
    legendFr: 'Thermostat',
    mount: 'wall',
    voltage_v: 240,
    default_load_w: 0,
    searchTerms: ['stat', 'temperature'],
  },
  water_heater: {
    label: 'Water heater',
    legendFr: 'Chauffe-eau (WH)',
    mount: 'free',
    voltage_v: 240,
    default_load_w: 3800,
    searchTerms: ['wh', 'chauffe-eau', 'tank', 'boiler'],
  },
  air_exchanger: {
    label: 'Air exchanger',
    legendFr: "Échangeur d'air (EA)",
    mount: 'free',
    voltage_v: 120,
    default_load_w: 150,
    searchTerms: ['ea', 'hrv', 'echangeur', 'ventilation'],
  },
  central_vacuum: {
    label: 'Central vacuum',
    legendFr: 'Aspirateur central (VAC)',
    mount: 'free',
    voltage_v: 120,
    default_load_w: 1400,
    searchTerms: ['vac', 'aspirateur', 'vacuum unit'],
  },
  vacuum_inlet: {
    label: 'Vacuum inlet',
    legendFr: 'Prise aspirateur',
    mount: 'wall',
    voltage_v: null,
    default_load_w: 0,
    searchTerms: ['vac', 'aspirateur', 'inlet', 'hose'],
  },
  smoke_detector: {
    label: 'Smoke detector',
    legendFr: 'Détecteur de fumée (SD)',
    mount: 'ceiling',
    voltage_v: 120,
    default_load_w: 5,
    searchTerms: ['sd', 'alarm', 'detecteur', 'fumee', 'fire'],
  },
  network_jack: {
    label: 'Network jack',
    legendFr: 'Câble réseau',
    mount: 'wall',
    voltage_v: null,
    default_load_w: 0,
    searchTerms: ['ethernet', 'rj45', 'data', 'reseau', 'lan'],
  },
  panel: {
    label: 'Electrical panel',
    legendFr: 'Panneau électrique',
    mount: 'wall',
    voltage_v: null,
    default_load_w: 0,
    searchTerms: ['breaker', 'panneau', 'load center', 'distribution'],
  },
}

/** Default along-wall length of a baseboard heater in inches (spec §5.4, D2). */
export const DEFAULT_BASEBOARD_LENGTH_IN = 36

/** Wattage presets offered for baseboard heaters (spec §5.9 tier 3). */
export const BASEBOARD_WATTAGE_PRESETS: readonly number[] = [500, 750, 1000, 1250, 1500, 2000]

/** The catalog entry for a device type. */
export function catalogEntry(type: DeviceType): DeviceCatalogEntry {
  return DEVICE_CATALOG[type]
}

/**
 * The effective default load for a type in watts: the plan-level override
 * (spec §5.9 tier 2) when present, otherwise the catalog default. The source
 * lets the Inspector hint where the value comes from.
 */
export function effectiveDefaultLoad(
  type: DeviceType,
  catalogDefaults: Record<string, number> | undefined,
): { value: number; source: 'plan' | 'catalog' } {
  const override = catalogDefaults?.[type]
  if (override !== undefined && Number.isFinite(override)) {
    return { value: override, source: 'plan' }
  }
  return { value: DEVICE_CATALOG[type].default_load_w, source: 'catalog' }
}

/**
 * The effective load of a placed device in watts: its per-instance override
 * when set, else the effective default for its type (spec D2, §5.9).
 */
export function effectiveDeviceLoad(
  device: Device,
  catalogDefaults: Record<string, number> | undefined,
): number {
  if (device.load_w !== null && Number.isFinite(device.load_w)) return device.load_w
  return effectiveDefaultLoad(device.type, catalogDefaults).value
}

/**
 * Filters and ranks device types for the picker (spec §6.1). An empty query
 * returns every type in catalog order; otherwise types whose label, French
 * legend or search terms contain the query (case-insensitive), label matches
 * first.
 */
export function searchDeviceTypes(query: string): DeviceType[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '') return [...DEVICE_TYPES]
  const scored: { type: DeviceType; rank: number }[] = []
  for (const type of DEVICE_TYPES) {
    const entry = DEVICE_CATALOG[type]
    if (entry.label.toLowerCase().includes(trimmed)) {
      scored.push({ type, rank: 0 })
    } else if (
      entry.legendFr.toLowerCase().includes(trimmed) ||
      entry.searchTerms.some((term) => term.includes(trimmed))
    ) {
      scored.push({ type, rank: 1 })
    }
  }
  scored.sort((a, b) => a.rank - b.rank)
  return scored.map((item) => item.type)
}
