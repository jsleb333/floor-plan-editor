/**
 * The wall network: explicit connectivity between walls, and the one derived
 * geometry every consumer reads (`docs/WALL_NETWORK.md`).
 *
 * Replaces the implicit "same chain mitres, one-way T record trims at paint
 * time" arrangement. Pure — no Vue, no DOM — like the rest of `utils/geometry/`.
 */

export { COINCIDENCE_TOLERANCE_IN, deriveJoints } from './coincidence'
export { solveConstraints, violations, type ConstraintSolution } from './constraintSolver'
export {
  flushSpinePoint,
  sharedSide,
  spineToSurface,
  surfaceAnchor,
  type FlushPlacement,
  type SurfaceAnchor,
} from './flushPlacement'
export {
  capOf,
  endFrame,
  geometryInputOf,
  wallGeometry,
  type EndFrame,
  type WallGeometry,
} from './endFrame'
export {
  emptyResolution,
  hostSpineSegment,
  resolveJoint,
  type EndResolution,
  type JointGap,
  type Resolution,
  type ResolverContext,
} from './joinResolver'
export {
  resolveWallNetwork,
  type FaceSegment,
  type NetworkAnchor,
  type NetworkAnchorKind,
  type ResolvedEnd,
  type ResolvedNetwork,
  type ResolvedWall,
} from './networkGeometry'
export { buildWallGraph, endKey, isEndRef, wallIdsOf, type WallGraph } from './wallGraph'
