/**
 * Shared 2D geometry module for the floor-plan editor (spec §10.1).
 *
 * The single source of derived wall geometry: the editor renderer and the SVG
 * export both call it, so what is drawn is exactly what exports (spec §4.1).
 * Pure functions only — no Vue, no DOM, no side effects.
 *
 * Coordinate convention: x grows RIGHT, y grows DOWN (SVG screen space),
 * units are inches, angles in radians from the +x axis toward +y. "Left of
 * travel" `a -> b` is the side where `cross(sub(b, a), sub(p, a))` is
 * NEGATIVE; `perpendicular` rotates toward that left side. See `vec.ts`.
 */

export {
  EPSILON,
  add,
  angleOf,
  cross,
  dirFromAngle,
  distance,
  dot,
  length,
  lerp,
  normalize,
  perpendicular,
  scale,
  sideOf,
  sub,
  type Side,
} from './vec'
export {
  lineIntersection,
  projectPointOnPolyline,
  projectPointOnSegment,
  segmentIntersection,
  type PolylineProjection,
  type SegmentProjection,
} from './lines'
export {
  ALIGNMENT_LINE_DIRECTIONS,
  ALLOWED_DIRECTIONS,
  snapAngleDeg,
  snapDirection,
} from './angles'
export { alignFree, alignOnRay, type StartAlignment } from './startAlignment'
export {
  offsetPolyline,
  wallFaceOffsets,
  wallOutline,
  type WallGeometryInput,
  type WallReference,
} from './wallOutline'
export { alignedClose, autoSquareClose, type SquareClose } from './closeLoop'
export {
  boundsIntersect,
  boundsOfPoints,
  boundsOfRings,
  pointInPolygon,
  pointInRings,
  type Bounds,
} from './polygons'
export {
  segmentCountOf,
  setSegmentLength,
  type ChainEditInput,
  type ChainEditResult,
} from './chainEdit'
export { constrainedVertexPosition } from './vertexDrag'
export {
  clampOpeningT,
  doorSymbol,
  openingJambs,
  openingWorldRect,
  projectOntoWalls,
  wallSegmentCount,
  wallSegmentSpan,
  windowSymbol,
  type DoorSymbol,
  type WallPlacement,
  type WallSegmentSpan,
} from './openings'
export {
  arrowHeadStrokes,
  stairsArrow,
  stairsCenter,
  stairsCorners,
  stairsFrame,
  stairsTreads,
  type StairsFrame,
} from './stairs'
export {
  dimensionHitTest,
  dimensionLayout,
  dimensionOffsetFor,
  labelBounds,
  labelFontSizeIn,
  type DimensionLayout,
} from './annotations'
export { trimEndpointToHostFace } from './junctionTrim'
export {
  parallelFaceGaps,
  type FaceGap,
  type GapSubject,
  type ParallelFaceGaps,
} from './tempDimensions'
export {
  BASEBOARD_DEPTH_IN,
  DEVICE_MIN_SCREEN_PX,
  DEVICE_NOMINAL_IN,
  deviceScreenScale,
  deviceWallGaps,
  deviceWorldPlacement,
  projectDeviceOntoWalls,
  type DeviceGap,
  type DeviceGaps,
  type DevicePlacement,
} from './devices'
export {
  AUTO_CURVE_FACTOR,
  WIRE_HIT_SAMPLES,
  autoCurveControlPoints,
  sampleWirePoints,
  wireEndpoint,
  wireHitDistance,
  wirePathData,
} from './wires'
