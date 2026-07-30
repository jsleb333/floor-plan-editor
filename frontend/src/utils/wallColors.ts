import type { Wall } from '@/types/plan'

/**
 * Wall colouring (spec S1f): every wall draws in one colour — body fill and
 * outline alike, the poché of a paper plan — taken from its own `color`
 * override when set, and otherwise derived from its ROLE in the plan.
 *
 * The role comes from the plan's thickness presets, whose first entry is the
 * exterior preset by convention (spec §5.9 tier 2, the same convention the
 * smart thickness flow S1d reads): a wall at least as thick as it is the
 * building shell and draws black; everything thinner is a partition and draws
 * grey. Deriving rather than storing means changing a wall's thickness (or the
 * plan's presets) re-colours it, and an explicit pick always wins.
 */

/** Default colour of an exterior wall — the building shell (spec S1f). */
export const EXTERIOR_WALL_COLOR = '#000000'
/** Default colour of an interior wall — a partition (spec S1f). */
export const INTERIOR_WALL_COLOR = '#808080'

/** Which default a wall takes when it carries no colour override. */
export type WallRole = 'exterior' | 'interior'

/**
 * Swatches offered by the wall colour control: the two role defaults, two
 * intermediate greys, and the two conventions of a renovation plan — red for
 * new construction, blue for what is coming down.
 */
export const WALL_COLOR_PALETTE: readonly string[] = [
  EXTERIOR_WALL_COLOR,
  '#404040',
  INTERIOR_WALL_COLOR,
  '#b3b3b3',
  '#b91c1c',
  '#2563eb',
]

const THICKNESS_TOLERANCE_IN = 1e-9

/**
 * The role a wall of `thicknessIn` plays in a plan whose thickness presets are
 * `presetsIn` (ordered outermost first): exterior when it is at least as thick
 * as the exterior preset, interior otherwise. A plan with fewer than two
 * presets draws no exterior/interior distinction, so everything is interior.
 */
export function wallRoleOf(thicknessIn: number, presetsIn: readonly number[]): WallRole {
  if (presetsIn.length < 2) return 'interior'
  return thicknessIn >= presetsIn[0] - THICKNESS_TOLERANCE_IN ? 'exterior' : 'interior'
}

/** The colour a wall of `thicknessIn` takes with no override (spec S1f). */
export function defaultWallColor(thicknessIn: number, presetsIn: readonly number[]): string {
  return wallRoleOf(thicknessIn, presetsIn) === 'exterior'
    ? EXTERIOR_WALL_COLOR
    : INTERIOR_WALL_COLOR
}

/** The colour a wall actually draws in: its override, else its role default. */
export function wallColor(wall: Wall, presetsIn: readonly number[]): string {
  return wall.color ?? defaultWallColor(wall.thickness_in, presetsIn)
}
