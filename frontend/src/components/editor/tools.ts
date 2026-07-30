import {
  Blinds,
  BrickWall,
  ChartNoAxesColumnIncreasing,
  ClipboardList,
  Crosshair,
  DoorOpen,
  House,
  MousePointer2,
  PlugZap,
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

/** The workspace modes, each a phase of the real workflow (spec E10). */
export type ModeId = 'structure' | 'electrical' | 'inspector'

export interface ModeDefinition {
  id: ModeId
  name: string
  /** Single-key shortcut, lowercase; chains into the mode's tool letters (spec E10). */
  shortcut: string
  icon: Component
}

/** Modes in tool-rail / mode-pill order (spec E10, §6.1). */
export const MODES: readonly ModeDefinition[] = [
  { id: 'structure', name: 'Structure', shortcut: 's', icon: House },
  { id: 'electrical', name: 'Electrical', shortcut: 'e', icon: PlugZap },
  { id: 'inspector', name: 'Inspector', shortcut: 'i', icon: ClipboardList },
]

export interface ToolDefinition {
  id: ToolId
  name: string
  /**
   * Single-key shortcut, lowercase. Scoped to the tool's modes, so the same
   * letter may name a different tool in another mode (spec E10).
   */
  shortcut: string
  icon: Component
  /** Disabled tools arrive in later milestones. */
  enabled: boolean
  /**
   * Modes the tool belongs to, most-natural first — membership is
   * many-to-many and the first entry is the mode a chord lands in when the
   * tool is armed from elsewhere (spec E10).
   */
  modes: readonly ModeId[]
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'select',
    name: 'Select',
    shortcut: 'v',
    icon: MousePointer2,
    enabled: true,
    modes: ['structure', 'electrical', 'inspector'],
  },
  { id: 'wall', name: 'Wall', shortcut: 'w', icon: BrickWall, enabled: true, modes: ['structure'] },
  { id: 'door', name: 'Door', shortcut: 'd', icon: DoorOpen, enabled: true, modes: ['structure'] },
  {
    id: 'window',
    name: 'Window',
    shortcut: 'n',
    icon: Blinds,
    enabled: true,
    modes: ['structure'],
  },
  {
    id: 'stairs',
    name: 'Stairs',
    shortcut: 's',
    icon: ChartNoAxesColumnIncreasing,
    enabled: true,
    modes: ['structure'],
  },
  {
    id: 'label',
    name: 'Label',
    shortcut: 't',
    icon: Type,
    enabled: true,
    modes: ['structure', 'electrical', 'inspector'],
  },
  {
    id: 'dimension',
    name: 'Dimension',
    shortcut: 'x',
    icon: RulerDimensionLine,
    enabled: true,
    modes: ['structure', 'inspector'],
  },
  { id: 'device', name: 'Device', shortcut: 'd', icon: Zap, enabled: true, modes: ['electrical'] },
  { id: 'wire', name: 'Wire', shortcut: 'w', icon: Spline, enabled: true, modes: ['electrical'] },
  {
    id: 'measure',
    name: 'Tape measure',
    shortcut: 'm',
    icon: Ruler,
    enabled: true,
    modes: ['structure', 'inspector'],
  },
  {
    id: 'calibrate',
    name: 'Calibrate',
    shortcut: 'c',
    icon: Crosshair,
    enabled: true,
    modes: ['structure'],
  },
]

/** The tools the rail shows in `mode`, in declaration order (spec E10, §6.1). */
export function toolsForMode(mode: ModeId): readonly ToolDefinition[] {
  return TOOLS.filter((tool) => tool.modes.includes(mode))
}

/** The mode a tool lands in when armed from elsewhere: its first declared mode (spec E10). */
export function modeForTool(toolId: ToolId): ModeId {
  return TOOLS.find((tool) => tool.id === toolId)?.modes[0] ?? 'structure'
}

/** Whether `value` names a mode a saved session may restore (spec P4/E10). */
export function isModeId(value: string | null): value is ModeId {
  return MODES.some((mode) => mode.id === value)
}

/** Whether `value` names an enabled tool a saved session may restore (spec P4). */
export function isRestorableToolId(value: string | null): value is ToolId {
  return TOOLS.some((tool) => tool.id === value && tool.enabled)
}

/** The mode and tool a plan opens in (spec E9). */
export interface StartupState {
  mode: ModeId
  tool: ToolId
}

/**
 * The mode and tool to arm when a plan opens (spec E9, content-aware
 * startup): a plan with no walls lands in Structure mode with the wall tool
 * armed — the empty state's one job is getting the first wall drawn — unless
 * it carries an underlay, in which case the calibrate tool is armed so a
 * photo-first plan opens ready to calibrate (spec P5/U2). Nothing in the
 * document marks an underlay as calibrated — import seeds a default scale and
 * calibration merely rescales it — so "underlay present AND no walls yet" is
 * the heuristic for "still uncalibrated": once tracing starts, walls exist
 * and the saved session's mode and tool are restored instead (spec P4),
 * defaulting to Structure / Select on missing or unknown values. A restored
 * tool that is not a member of the restored mode wins — the mode is resolved
 * from the tool (spec E9/E10) — so a session saved before modes existed still
 * opens on the tool it left armed.
 */
export function startupStateFor(document: PlanDocument): StartupState {
  if (document.walls.length === 0) {
    return { mode: 'structure', tool: document.underlay ? 'calibrate' : 'wall' }
  }
  const savedMode = isModeId(document.active_mode) ? document.active_mode : null
  const savedTool = document.active_tool
  if (!isRestorableToolId(savedTool)) return { mode: savedMode ?? 'structure', tool: 'select' }
  if (savedMode && toolsForMode(savedMode).some((tool) => tool.id === savedTool)) {
    return { mode: savedMode, tool: savedTool }
  }
  return { mode: modeForTool(savedTool), tool: savedTool }
}

/** The tool a plan opens with (spec E9) — see `startupStateFor`. */
export function startupToolFor(document: PlanDocument): ToolId {
  return startupStateFor(document).tool
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
