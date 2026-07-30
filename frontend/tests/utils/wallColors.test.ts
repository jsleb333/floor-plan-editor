import { describe, expect, it } from 'vitest'

import {
  EXTERIOR_WALL_COLOR,
  INTERIOR_WALL_COLOR,
  defaultWallColor,
  wallColor,
  wallRoleOf,
} from '@/utils/wallColors'

import { makeWall } from '../helpers/planFactory'

/** The seeded preset list: 12" exterior, 4½" and 3½" interior (spec §5.9 tier 2). */
const PRESETS = [12, 4.5, 3.5]

describe('wallRoleOf', () => {
  it('reads the exterior preset, and anything thicker, as the building shell', () => {
    expect(wallRoleOf(12, PRESETS)).toBe('exterior')
    expect(wallRoleOf(16, PRESETS)).toBe('exterior')
  })

  it('reads anything thinner than the exterior preset as a partition', () => {
    expect(wallRoleOf(3.5, PRESETS)).toBe('interior')
    expect(wallRoleOf(4.5, PRESETS)).toBe('interior')
    expect(wallRoleOf(6, PRESETS)).toBe('interior')
  })

  it('has no shell to speak of when the plan offers fewer than two presets', () => {
    expect(wallRoleOf(12, [12])).toBe('interior')
    expect(wallRoleOf(12, [])).toBe('interior')
  })
})

describe('defaultWallColor', () => {
  it('gives the shell black and a partition grey (spec S1f)', () => {
    expect(defaultWallColor(12, PRESETS)).toBe(EXTERIOR_WALL_COLOR)
    expect(defaultWallColor(3.5, PRESETS)).toBe(INTERIOR_WALL_COLOR)
  })
})

describe('wallColor', () => {
  it('takes the role default while the wall carries no override', () => {
    expect(wallColor(makeWall({ thickness_in: 12 }), PRESETS)).toBe(EXTERIOR_WALL_COLOR)
    expect(wallColor(makeWall(), PRESETS)).toBe(INTERIOR_WALL_COLOR)
  })

  it('lets an explicit colour win over the role default', () => {
    expect(wallColor(makeWall({ thickness_in: 12, color: '#b91c1c' }), PRESETS)).toBe('#b91c1c')
  })

  it('re-derives the default when the plan changes what counts as exterior', () => {
    const wall = makeWall({ thickness_in: 6 })
    expect(wallColor(wall, PRESETS)).toBe(INTERIOR_WALL_COLOR)
    expect(wallColor(wall, [6, 3.5])).toBe(EXTERIOR_WALL_COLOR)
  })
})
