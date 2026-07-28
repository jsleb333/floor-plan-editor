import {
  Blinds,
  BrickWall,
  ChartNoAxesColumnIncreasing,
  Crosshair,
  DoorOpen,
  MousePointer2,
  Ruler,
  RulerDimensionLine,
  Spline,
  Type,
  Zap,
} from 'lucide-vue-next'
import type { Component } from 'vue'

import type { Device, DeviceType, PlanDocument } from '@/types/plan'

export type ToolId =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'stairs'
  | 'label'
  | 'dimension'
  | 'device'
  | 'wire'
  | 'measure'
  | 'calibrate'

export interface ToolDefinition {
  id: ToolId
  name: string
  /** Single-key shortcut, lowercase. */
  shortcut: string
  icon: Component
  /** Disabled tools arrive in later milestones. */
  enabled: boolean
}

export const TOOLS: readonly ToolDefinition[] = [
  { id: 'select', name: 'Select', shortcut: 'v', icon: MousePointer2, enabled: true },
  { id: 'wall', name: 'Wall', shortcut: 'w', icon: BrickWall, enabled: true },
  { id: 'door', name: 'Door', shortcut: 'd', icon: DoorOpen, enabled: true },
  { id: 'window', name: 'Window', shortcut: 'n', icon: Blinds, enabled: true },
  {
    id: 'stairs',
    name: 'Stairs',
    shortcut: 's',
    icon: ChartNoAxesColumnIncreasing,
    enabled: true,
  },
  { id: 'label', name: 'Label', shortcut: 't', icon: Type, enabled: true },
  { id: 'dimension', name: 'Dimension', shortcut: 'x', icon: RulerDimensionLine, enabled: true },
  { id: 'device', name: 'Device', shortcut: 'e', icon: Zap, enabled: true },
  { id: 'wire', name: 'Wire', shortcut: 'r', icon: Spline, enabled: true },
  { id: 'measure', name: 'Tape measure', shortcut: 'm', icon: Ruler, enabled: true },
  { id: 'calibrate', name: 'Calibrate', shortcut: 'c', icon: Crosshair, enabled: true },
]

/** Whether `value` names an enabled tool a saved session may restore (spec P4). */
export function isRestorableToolId(value: string | null): value is ToolId {
  return TOOLS.some((tool) => tool.id === value && tool.enabled)
}

/**
 * The tool to arm when a plan opens (spec E9, content-aware startup): a plan
 * with no walls arms the wall tool — the empty state's one job is getting the
 * first wall drawn — unless it carries an underlay, in which case the
 * calibrate tool is armed so a photo-first plan opens ready to calibrate
 * (spec P5/U2). Nothing in the document marks an underlay as calibrated —
 * import seeds a default scale and calibration merely rescales it — so
 * "underlay present AND no walls yet" is the heuristic for "still
 * uncalibrated": once tracing starts, walls exist and the saved session's
 * tool is restored instead (spec P4), defaulting to Select on missing or
 * unknown values.
 */
export function startupToolFor(document: PlanDocument): ToolId {
  if (document.walls.length === 0) return document.underlay ? 'calibrate' : 'wall'
  return isRestorableToolId(document.active_tool) ? document.active_tool : 'select'
}

/**
 * The device type to arm when the Device tool is entered (spec E8/§6.1,
 * content-aware default): a plan with no devices yet arms the **panel** —
 * an electrical layout has to start from its source before anything else
 * makes sense to place. A storey fed from another floor has no panel of its
 * own, so the picker's Sources group offers the inter-floor feeds right next
 * to it. Once the plan has devices, the most-recently-used
 * type from the MRU store floats up so repeat placement never requires
 * reopening the picker; with devices but no MRU history yet (e.g. a plan
 * imported from JSON on a fresh browser), the picker is offered instead
 * (`null`).
 */
export function armedDeviceTypeFor(
  devices: readonly Device[],
  mruTypes: readonly DeviceType[],
): DeviceType | null {
  if (devices.length === 0) return 'panel'
  return mruTypes[0] ?? null
}
