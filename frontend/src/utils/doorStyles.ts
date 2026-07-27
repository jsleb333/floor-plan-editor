import type { DoorStyle } from '@/types/plan'

/**
 * Which of a door's two side fields each style actually reads, and what to call
 * them in the UI (spec S4). `hinge` and `swing` mean different things per style —
 * the jamb a bifold stacks at, the face a slider bypasses on — so the stored
 * field names are relabelled instead of duplicated in the document.
 */
export interface DoorStyleControls {
  /** Visible label of the `hinge` field, or null when the style ignores it. */
  hinge: string | null
  /** Visible label of the `swing` field, or null when the style ignores it. */
  swing: string | null
}

/** The door styles offered by the door tool and the Inspector, in drafting order. */
export const DOOR_STYLE_OPTIONS: readonly { id: DoorStyle; label: string }[] = [
  { id: 'swing', label: 'Swing' },
  { id: 'double', label: 'Double' },
  { id: 'sliding', label: 'Sliding' },
  { id: 'bifold', label: 'Bifold' },
  { id: 'double_bifold', label: 'Double bifold' },
  { id: 'pocket', label: 'Pocket' },
]

const DOOR_STYLE_CONTROLS: Record<DoorStyle, DoorStyleControls> = {
  swing: { hinge: 'Hinge', swing: 'Swing' },
  double: { hinge: null, swing: 'Swing' },
  sliding: { hinge: 'Slide side', swing: null },
  bifold: { hinge: 'Stack side', swing: 'Fold side' },
  double_bifold: { hinge: null, swing: 'Fold side' },
  pocket: { hinge: 'Pocket side', swing: null },
}

/**
 * Width in inches a style is normally drawn at, for the styles that imply one
 * (spec S4): a four-panel `double_bifold` is a closet front, not a 30" doorway.
 * A style absent from this map takes whatever width the tool is armed with.
 */
const DOOR_STYLE_DEFAULT_WIDTH_IN: Partial<Record<DoorStyle, number>> = {
  double_bifold: 60,
}

/** The side fields `style` reads, defaulting to the swing door's for an unknown style. */
export function doorStyleControls(style: DoorStyle): DoorStyleControls {
  return DOOR_STYLE_CONTROLS[style] ?? DOOR_STYLE_CONTROLS.swing
}

/** The width `style` implies, or null when it accepts any width (spec S4). */
export function doorStyleDefaultWidthIn(style: DoorStyle): number | null {
  return DOOR_STYLE_DEFAULT_WIDTH_IN[style] ?? null
}

/** Whether `value` is one of the six door styles (guards restored/stored values). */
export function isDoorStyle(value: unknown): value is DoorStyle {
  return DOOR_STYLE_OPTIONS.some((option) => option.id === value)
}
