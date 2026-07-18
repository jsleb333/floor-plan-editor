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
  { id: 'measure', name: 'Measure', shortcut: 'm', icon: Ruler, enabled: false },
  { id: 'calibrate', name: 'Calibrate', shortcut: 'c', icon: Crosshair, enabled: true },
]
