import { describe, expect, it } from 'vitest'

import { trimEndpointToHostFace } from '@/utils/geometry'
import type { WallGeometryInput } from '@/utils/geometry'
import { expectPointsClose } from './helpers'

/** Horizontal host on the x axis, 12" thick, centered: faces at y = -6 and y = +6. */
const HOST: WallGeometryInput = {
  vertices: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ],
  thicknessIn: 12,
  reference: 'center',
}

describe('trimEndpointToHostFace', () => {
  it('trims an end junction back to the near face of the host', () => {
    const trimmed = trimEndpointToHostFace(
      [
        { x: 50, y: 40 },
        { x: 50, y: 0 },
      ],
      'end',
      HOST,
    )
    expectPointsClose(trimmed, [
      { x: 50, y: 40 },
      { x: 50, y: 6 },
    ])
  })

  it('trims a start junction the same way', () => {
    const trimmed = trimEndpointToHostFace(
      [
        { x: 50, y: 0 },
        { x: 50, y: 40 },
      ],
      'start',
      HOST,
    )
    expectPointsClose(trimmed, [
      { x: 50, y: 6 },
      { x: 50, y: 40 },
    ])
  })

  it('picks the face on the approaching side', () => {
    const trimmed = trimEndpointToHostFace(
      [
        { x: 50, y: -40 },
        { x: 50, y: 0 },
      ],
      'end',
      HOST,
    )
    expectPointsClose(trimmed, [
      { x: 50, y: -40 },
      { x: 50, y: -6 },
    ])
  })

  it('extends an endpoint that stops just short of the face', () => {
    const trimmed = trimEndpointToHostFace(
      [
        { x: 50, y: 40 },
        { x: 50, y: 10 },
      ],
      'end',
      HOST,
    )
    expectPointsClose(trimmed, [
      { x: 50, y: 40 },
      { x: 50, y: 6 },
    ])
  })

  it('leaves the endpoint alone when the junction is stale (host far away)', () => {
    const trimmed = trimEndpointToHostFace(
      [
        { x: 50, y: 400 },
        { x: 50, y: 300 },
      ],
      'end',
      HOST,
    )
    expectPointsClose(trimmed, [
      { x: 50, y: 400 },
      { x: 50, y: 300 },
    ])
  })

  it('leaves the endpoint alone when the wall is parallel to the host', () => {
    const trimmed = trimEndpointToHostFace(
      [
        { x: 0, y: 30 },
        { x: 100, y: 30 },
      ],
      'end',
      HOST,
    )
    expectPointsClose(trimmed, [
      { x: 0, y: 30 },
      { x: 100, y: 30 },
    ])
  })

  it('handles degenerate inputs without throwing', () => {
    expect(trimEndpointToHostFace([{ x: 1, y: 2 }], 'end', HOST)).toEqual([{ x: 1, y: 2 }])
  })
})
