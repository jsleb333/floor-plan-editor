import type { DeviceType } from '@/types/plan'

/**
 * Vector primitives for the device pictograms (spec §5.4, §10.1). Each type is
 * described as a small list of stroke-based shapes drawn on a nominal 12×12 box
 * with the origin at (6, 6); the wall runs along the local x axis and the
 * "room" side of the symbol points toward local −y, so local y > 6 points
 * INTO the wall body. Rendered once as SVG `<symbol>`s (`DevicePictogram.vue`)
 * and instanced via `<use>` on the canvas.
 *
 * Because the box is centred on the wall face by default, a symbol whose ink
 * extends well past y = 6 (e.g. a switch's stem) would otherwise poke through
 * the far side of a thin partition. Each wall-mounted type may therefore
 * declare a BASELINE — the local y that should land exactly on the wall face,
 * read via `pictogramBaselineY` — and `deviceWorldPlacement` shifts the whole
 * symbol outward, into the room, by `baselineY - PICTOGRAM_CENTER` inches so
 * that y lands on the face instead of the box centre. A baseline of
 * `PICTOGRAM_CENTER` (the default for any type with no entry below) means
 * "unchanged, centred on the face" — the correct behaviour for ceiling/free
 * pictograms and any wall symbol already centred on its ink.
 */

/** One drawable shape of a pictogram, in the 12×12 symbol coordinate box. */
export type PictogramShape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline'; points: readonly [number, number][]; closed?: boolean }
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: boolean }
  | { kind: 'text'; x: number; y: number; text: string; size: number }

/** SVG viewBox of every pictogram symbol (origin centred in a 12×12 box). */
export const PICTOGRAM_VIEWBOX = '0 0 12 12'

/** The `<symbol>` id for a device type; matched by `<use href>` on the canvas. */
export function pictogramSymbolId(type: DeviceType): string {
  return `pict-${type}`
}

/** Centre of the 12×12 symbol box, on both axes — also the default baseline. */
export const PICTOGRAM_CENTER = 6

/** Vector primitives per device type — the data-driven pictogram registry (spec D5). */
export const DEVICE_PICTOGRAMS: Record<DeviceType, readonly PictogramShape[]> = {
  outlet: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: PICTOGRAM_CENTER, r: 3.6 },
    { kind: 'line', x1: 4.8, y1: 4, x2: 4.8, y2: 8 },
    { kind: 'line', x1: 7.2, y1: 4, x2: 7.2, y2: 8 },
  ],
  outlet_gfci: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: PICTOGRAM_CENTER, r: 3.6 },
    { kind: 'line', x1: 5, y1: 7.2, x2: 5, y2: 9 },
    { kind: 'line', x1: 7, y1: 7.2, x2: 7, y2: 9 },
    { kind: 'text', x: PICTOGRAM_CENTER, y: 4.9, text: 'G', size: 4 },
  ],
  switch: [
    { kind: 'text', x: PICTOGRAM_CENTER, y: 5, text: 'S', size: 6 },
    { kind: 'line', x1: PICTOGRAM_CENTER, y1: 8.4, x2: PICTOGRAM_CENTER, y2: 11.5 },
  ],
  switch_3way: [
    { kind: 'text', x: PICTOGRAM_CENTER, y: 5, text: 'S₃', size: 5 },
    { kind: 'line', x1: PICTOGRAM_CENTER, y1: 8.4, x2: PICTOGRAM_CENTER, y2: 11.5 },
  ],
  ceiling_light: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: PICTOGRAM_CENTER, r: 4 },
    { kind: 'line', x1: 3.17, y1: 3.17, x2: 8.83, y2: 8.83 },
    { kind: 'line', x1: 3.17, y1: 8.83, x2: 8.83, y2: 3.17 },
  ],
  wall_light: [
    { kind: 'path', d: 'M 2.2 9 A 3.8 3.8 0 0 1 9.8 9' },
    { kind: 'line', x1: 2.2, y1: 9, x2: 9.8, y2: 9 },
    { kind: 'line', x1: 4, y1: 6.6, x2: 8, y2: 8.6 },
    { kind: 'line', x1: 8, y1: 6.6, x2: 4, y2: 8.6 },
  ],
  baseboard_heater: [
    { kind: 'rect', x: 1, y: 4.6, w: 10, h: 2.8 },
    { kind: 'line', x1: 1, y1: 6, x2: 11, y2: 6 },
  ],
  thermostat: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: PICTOGRAM_CENTER, r: 3.6 },
    { kind: 'text', x: PICTOGRAM_CENTER, y: PICTOGRAM_CENTER, text: 'T', size: 4.4 },
  ],
  water_heater: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: PICTOGRAM_CENTER, r: 4.4 },
    { kind: 'text', x: PICTOGRAM_CENTER, y: PICTOGRAM_CENTER, text: 'WH', size: 3.6 },
  ],
  air_exchanger: [
    { kind: 'rect', x: 1.6, y: 1.6, w: 8.8, h: 8.8 },
    { kind: 'text', x: PICTOGRAM_CENTER, y: PICTOGRAM_CENTER, text: 'EA', size: 3.6 },
  ],
  central_vacuum: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: PICTOGRAM_CENTER, r: 4.6 },
    { kind: 'text', x: PICTOGRAM_CENTER, y: PICTOGRAM_CENTER, text: 'VAC', size: 3 },
  ],
  vacuum_inlet: [
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: 4.8, r: 2.6 },
    { kind: 'circle', cx: PICTOGRAM_CENTER, cy: 4.8, r: 0.8, fill: true },
    { kind: 'line', x1: PICTOGRAM_CENTER, y1: 7.4, x2: PICTOGRAM_CENTER, y2: 11.5 },
  ],
  smoke_detector: [
    {
      kind: 'polyline',
      points: [
        [PICTOGRAM_CENTER, 1.4],
        [10.6, PICTOGRAM_CENTER],
        [PICTOGRAM_CENTER, 10.6],
        [1.4, PICTOGRAM_CENTER],
      ],
      closed: true,
    },
    { kind: 'text', x: PICTOGRAM_CENTER, y: PICTOGRAM_CENTER, text: 'SD', size: 3.2 },
  ],
  network_jack: [
    { kind: 'rect', x: 2.4, y: 2.4, w: 7.2, h: 7.2 },
    { kind: 'rect', x: 4.4, y: 4.4, w: 3.2, h: 3.2, fill: true },
  ],
  panel: [
    { kind: 'rect', x: 0.6, y: 3, w: 10.8, h: 6 },
    { kind: 'line', x1: 2.4, y1: 9, x2: 5.4, y2: 3 },
    { kind: 'line', x1: 5.4, y1: 9, x2: 8.4, y2: 3 },
    { kind: 'line', x1: 8.4, y1: 9, x2: 11.4, y2: 3 },
    { kind: 'line', x1: 0.6, y1: 6, x2: 3, y2: 3 },
  ],
  // The two feeds are deliberate mirror images: one slab line crossed by one
  // shaft, the arrowhead alone naming the direction (away from the wall face
  // for `feed_up`, into it for `feed_down`).
  feed_up: [
    { kind: 'line', x1: 1.2, y1: PICTOGRAM_CENTER, x2: 10.8, y2: PICTOGRAM_CENTER },
    { kind: 'line', x1: PICTOGRAM_CENTER, y1: 10.4, x2: PICTOGRAM_CENTER, y2: 1.6 },
    {
      kind: 'polyline',
      points: [
        [4.1, 3.9],
        [PICTOGRAM_CENTER, 1.6],
        [7.9, 3.9],
      ],
    },
  ],
  feed_down: [
    { kind: 'line', x1: 1.2, y1: PICTOGRAM_CENTER, x2: 10.8, y2: PICTOGRAM_CENTER },
    { kind: 'line', x1: PICTOGRAM_CENTER, y1: 1.6, x2: PICTOGRAM_CENTER, y2: 10.4 },
    {
      kind: 'polyline',
      points: [
        [4.1, 8.1],
        [PICTOGRAM_CENTER, 10.4],
        [7.9, 8.1],
      ],
    },
  ],
}

/**
 * Local y that lands on the wall face, per type — only listed for wall-mounted
 * pictograms whose ink is not already centred on the face (see the module
 * docstring). Absent entries fall back to `PICTOGRAM_CENTER` via
 * `pictogramBaselineY`, which also correctly leaves ceiling/free pictograms
 * (never wall-anchored) and `baseboard_heater` (drawn as its own oriented
 * rectangle, not this box) unshifted.
 */
const PICTOGRAM_BASELINE_Y: Partial<Record<DeviceType, number>> = {
  outlet_gfci: 9,
  switch: 11.5,
  switch_3way: 11.5,
  wall_light: 9,
  thermostat: 9.6,
  vacuum_inlet: 11.5,
  network_jack: 9.6,
  panel: 9,
  feed_up: 10.4,
  feed_down: 10.4,
}

/**
 * The local y (in the 12×12 symbol box) that should sit exactly on the wall
 * face for a wall-mounted device of `type`. `PICTOGRAM_CENTER` when `type` has
 * no baseline recorded above, meaning the pictogram is already centred on the
 * face and needs no outward shift.
 */
export function pictogramBaselineY(type: DeviceType): number {
  return PICTOGRAM_BASELINE_Y[type] ?? PICTOGRAM_CENTER
}
