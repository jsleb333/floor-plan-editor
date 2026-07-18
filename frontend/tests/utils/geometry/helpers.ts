import { expect } from 'vitest'

import type { Point } from '@/types/plan'

const DIGITS = 9

/** Asserts that two points match to 9 decimal places (well below the module's epsilon-scale). */
export function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, DIGITS)
  expect(actual.y).toBeCloseTo(expected.y, DIGITS)
}

/** Asserts that two point lists match pairwise, in order. */
export function expectPointsClose(actual: Point[], expected: Point[]): void {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((point, index) => expectPointClose(actual[index], point))
}
