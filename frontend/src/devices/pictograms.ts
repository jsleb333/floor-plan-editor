import type { DeviceType } from '@/types/plan'

/**
 * Vector primitives for the device pictograms (spec §5.4, §10.1). Each type is
 * described as a small list of stroke-based shapes drawn on a nominal 12×12 box
 * with the origin at (6, 6); the wall runs along the local x axis and the
 * "room" side of the symbol points toward local −y. Rendered once as SVG
 * `<symbol>`s (`DevicePictogram.vue`) and instanced via `<use>` on the canvas.
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

const CENTER = 6

/** Vector primitives per device type — the data-driven pictogram registry (spec D5). */
export const DEVICE_PICTOGRAMS: Record<DeviceType, readonly PictogramShape[]> = {
  outlet: [
    { kind: 'circle', cx: CENTER, cy: CENTER, r: 3.6 },
    { kind: 'line', x1: 4.8, y1: 4, x2: 4.8, y2: 8 },
    { kind: 'line', x1: 7.2, y1: 4, x2: 7.2, y2: 8 },
  ],
  outlet_gfci: [
    { kind: 'circle', cx: CENTER, cy: CENTER, r: 3.6 },
    { kind: 'line', x1: 5, y1: 7.2, x2: 5, y2: 9 },
    { kind: 'line', x1: 7, y1: 7.2, x2: 7, y2: 9 },
    { kind: 'text', x: CENTER, y: 4.9, text: 'G', size: 4 },
  ],
  switch: [
    { kind: 'text', x: CENTER, y: 5, text: 'S', size: 6 },
    { kind: 'line', x1: CENTER, y1: 8.4, x2: CENTER, y2: 11.5 },
  ],
  switch_3way: [
    { kind: 'text', x: CENTER, y: 5, text: 'S₃', size: 5 },
    { kind: 'line', x1: CENTER, y1: 8.4, x2: CENTER, y2: 11.5 },
  ],
  ceiling_light: [
    { kind: 'circle', cx: CENTER, cy: CENTER, r: 4 },
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
    { kind: 'circle', cx: CENTER, cy: CENTER, r: 3.6 },
    { kind: 'text', x: CENTER, y: CENTER, text: 'T', size: 4.4 },
  ],
  water_heater: [
    { kind: 'circle', cx: CENTER, cy: CENTER, r: 4.4 },
    { kind: 'text', x: CENTER, y: CENTER, text: 'WH', size: 3.6 },
  ],
  air_exchanger: [
    { kind: 'rect', x: 1.6, y: 1.6, w: 8.8, h: 8.8 },
    { kind: 'text', x: CENTER, y: CENTER, text: 'EA', size: 3.6 },
  ],
  central_vacuum: [
    { kind: 'circle', cx: CENTER, cy: CENTER, r: 4.6 },
    { kind: 'text', x: CENTER, y: CENTER, text: 'VAC', size: 3 },
  ],
  vacuum_inlet: [
    { kind: 'circle', cx: CENTER, cy: 4.8, r: 2.6 },
    { kind: 'circle', cx: CENTER, cy: 4.8, r: 0.8, fill: true },
    { kind: 'line', x1: CENTER, y1: 7.4, x2: CENTER, y2: 11.5 },
  ],
  smoke_detector: [
    {
      kind: 'polyline',
      points: [
        [CENTER, 1.4],
        [10.6, CENTER],
        [CENTER, 10.6],
        [1.4, CENTER],
      ],
      closed: true,
    },
    { kind: 'text', x: CENTER, y: CENTER, text: 'SD', size: 3.2 },
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
}
