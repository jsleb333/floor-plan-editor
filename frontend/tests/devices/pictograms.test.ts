import { describe, expect, it } from 'vitest'

import { DEVICE_TYPES } from '@/devices/catalog'
import {
  DEVICE_PICTOGRAMS,
  PICTOGRAM_CENTER,
  pictogramBaselineY,
  pictogramInkMaxY,
} from '@/devices/pictograms'
import type { PictogramShape } from '@/devices/pictograms'

describe('pictogramBaselineY', () => {
  it('derives the wall-facing edge from the shapes themselves for every wall-mounted symbolic type', () => {
    // Expected values are the ink extents the shapes in DEVICE_PICTOGRAMS
    // actually draw, computed by hand — NOT a hand-maintained table the
    // shapes could silently drift away from (spec §5.4).
    expect(pictogramBaselineY('outlet')).toBeCloseTo(9.6, 9)
    expect(pictogramBaselineY('outlet_gfci')).toBeCloseTo(9.6, 9)
    expect(pictogramBaselineY('switch')).toBeCloseTo(11.5, 9)
    expect(pictogramBaselineY('switch_3way')).toBeCloseTo(11.5, 9)
    expect(pictogramBaselineY('wall_light')).toBeCloseTo(9, 9)
    expect(pictogramBaselineY('thermostat')).toBeCloseTo(9.6, 9)
    expect(pictogramBaselineY('vacuum_inlet')).toBeCloseTo(11.5, 9)
    expect(pictogramBaselineY('network_jack')).toBeCloseTo(9.6, 9)
    expect(pictogramBaselineY('panel')).toBeCloseTo(9, 9)
    expect(pictogramBaselineY('feed_up')).toBeCloseTo(10.4, 9)
    expect(pictogramBaselineY('feed_down')).toBeCloseTo(10.4, 9)
  })

  it('never returns less than PICTOGRAM_CENTER for any registered type', () => {
    for (const type of DEVICE_TYPES) {
      expect(pictogramBaselineY(type)).toBeGreaterThanOrEqual(PICTOGRAM_CENTER)
    }
  })
})

describe('pictogramInkMaxY', () => {
  it('reads the maximum ink y straight off circle/line/polyline/rect/text shapes', () => {
    const shapes: PictogramShape[] = [
      { kind: 'circle', cx: 6, cy: 6, r: 3.6 },
      { kind: 'line', x1: 4.8, y1: 4, x2: 4.8, y2: 8 },
      {
        kind: 'polyline',
        points: [
          [1, 2],
          [3, 9],
        ],
      },
      { kind: 'rect', x: 1, y: 4.6, w: 10, h: 2.8 },
      { kind: 'text', x: 6, y: 6, text: 'T', size: 4.4 },
    ]
    // Greatest of: 9.6 (circle), 8 (line), 9 (polyline), 7.4 (rect), 8.2 (text).
    expect(pictogramInkMaxY(shapes)).toBeCloseTo(9.6, 9)
  })

  it('is NOT clamped — unlike pictogramBaselineY, ink entirely above the centre reports its true (sub-centre) extent', () => {
    // A hypothetical symbol drawn entirely on the room side of the centre:
    // `pictogramInkMaxY` reports the true, unclamped extent (3), below
    // PICTOGRAM_CENTER — it is `pictogramBaselineY`'s job to clamp that so
    // such a symbol is never pulled INTO the wall.
    const aboveCentreOnly: PictogramShape[] = [
      { kind: 'circle', cx: PICTOGRAM_CENTER, cy: 2, r: 1 },
    ]
    expect(pictogramInkMaxY(aboveCentreOnly)).toBe(3)
    expect(pictogramInkMaxY(aboveCentreOnly)).toBeLessThan(PICTOGRAM_CENTER)
  })
})

describe('DEVICE_PICTOGRAMS path shapes', () => {
  it('authors inkMaxY on every path shape, so a future path cannot silently under-report its ink extent', () => {
    for (const type of DEVICE_TYPES) {
      for (const shape of DEVICE_PICTOGRAMS[type]) {
        if (shape.kind === 'path') {
          expect(shape.inkMaxY, `${type} has a path shape without inkMaxY: ${shape.d}`).not.toBe(
            undefined,
          )
        }
      }
    }
  })
})
