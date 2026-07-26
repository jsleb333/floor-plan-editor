import { describe, expect, it } from 'vitest'

import { formatFeetInches, formatInches, parseFeetInches } from '@/utils/units'

describe('formatFeetInches', () => {
  it('formats whole feet and inches', () => {
    expect(formatFeetInches(150)).toBe(`12'6"`)
    expect(formatFeetInches(144)).toBe(`12'0"`)
    expect(formatFeetInches(13)).toBe(`1'1"`)
  })

  it('formats reduced eighth fractions', () => {
    expect(formatFeetInches(149.125)).toBe(`12'5 1/8"`)
    expect(formatFeetInches(149.25)).toBe(`12'5 1/4"`)
    expect(formatFeetInches(149.5)).toBe(`12'5 1/2"`)
    expect(formatFeetInches(149.625)).toBe(`12'5 5/8"`)
    expect(formatFeetInches(149.75)).toBe(`12'5 3/4"`)
  })

  it('formats the zero-inch fraction style from the spec (9\'0 1/8")', () => {
    expect(formatFeetInches(108.125)).toBe(`9'0 1/8"`)
  })

  it('omits the feet part below one foot', () => {
    expect(formatFeetInches(5.5)).toBe(`5 1/2"`)
    expect(formatFeetInches(11)).toBe(`11"`)
    expect(formatFeetInches(0)).toBe(`0"`)
  })

  it('formats a bare fraction below one inch', () => {
    expect(formatFeetInches(0.125)).toBe(`1/8"`)
    expect(formatFeetInches(0.5)).toBe(`1/2"`)
  })

  it('prefixes negative lengths with a minus sign', () => {
    expect(formatFeetInches(-149.125)).toBe(`-12'5 1/8"`)
    expect(formatFeetInches(-5.5)).toBe(`-5 1/2"`)
    expect(formatFeetInches(-0.25)).toBe(`-1/4"`)
  })

  it('does not emit a minus sign when the value rounds to zero', () => {
    expect(formatFeetInches(-0.01)).toBe(`0"`)
  })

  it('rounds to the nearest eighth by default', () => {
    expect(formatFeetInches(149.1)).toBe(`12'5 1/8"`)
    expect(formatFeetInches(149.05)).toBe(`12'5"`)
  })

  it('carries rounding across the foot boundary', () => {
    expect(formatFeetInches(143.99)).toBe(`12'0"`)
    expect(formatFeetInches(11.97)).toBe(`1'0"`)
  })

  it('respects a coarser resolution', () => {
    expect(formatFeetInches(149.6, 1)).toBe(`12'6"`)
    expect(formatFeetInches(149.3, 1 / 2)).toBe(`12'5 1/2"`)
    expect(formatFeetInches(149.2, 1 / 4)).toBe(`12'5 1/4"`)
  })
})

describe('formatInches', () => {
  it('never carries into feet', () => {
    expect(formatInches(32)).toBe(`32"`)
    expect(formatInches(150)).toBe(`150"`)
    expect(formatInches(0)).toBe(`0"`)
  })

  it('formats reduced eighth fractions', () => {
    expect(formatInches(4.5)).toBe(`4 1/2"`)
    expect(formatInches(0.125)).toBe(`1/8"`)
    expect(formatInches(30.25)).toBe(`30 1/4"`)
  })

  it('prefixes negative lengths with a minus sign', () => {
    expect(formatInches(-4.5)).toBe(`-4 1/2"`)
    expect(formatInches(-0.01)).toBe(`0"`)
  })

  it('respects a coarser resolution', () => {
    expect(formatInches(30.6, 1)).toBe(`31"`)
    expect(formatInches(30.3, 1 / 2)).toBe(`30 1/2"`)
  })
})

describe('parseFeetInches', () => {
  it('parses feet with trailing inches', () => {
    expect(parseFeetInches(`12'5`)).toBe(149)
    expect(parseFeetInches(`12'5"`)).toBe(149)
    expect(parseFeetInches(`0'5`)).toBe(5)
  })

  it('parses feet, inches and a fraction with flexible spacing', () => {
    expect(parseFeetInches(`12' 5 1/2`)).toBe(149.5)
    expect(parseFeetInches(`12'5 1/8"`)).toBe(149.125)
  })

  it('parses a bare number as inches', () => {
    expect(parseFeetInches('150')).toBe(150)
    expect(parseFeetInches('12.5')).toBe(12.5)
  })

  it('parses decimal feet', () => {
    expect(parseFeetInches(`12.5'`)).toBe(150)
    expect(parseFeetInches('12.5 ft')).toBe(150)
  })

  it('parses feet alone', () => {
    expect(parseFeetInches(`12'`)).toBe(144)
  })

  it('parses inches-only fractions', () => {
    expect(parseFeetInches(`5 1/2"`)).toBe(5.5)
    expect(parseFeetInches('1/2')).toBe(0.5)
    expect(parseFeetInches('5 in')).toBe(5)
  })

  it('parses negative lengths', () => {
    expect(parseFeetInches(`-3'`)).toBe(-36)
    expect(parseFeetInches(`-12'5`)).toBe(-149)
    expect(parseFeetInches('-1/2')).toBe(-0.5)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseFeetInches(`  12' 6  `)).toBe(150)
  })

  it('returns null for invalid input', () => {
    expect(parseFeetInches('')).toBeNull()
    expect(parseFeetInches('abc')).toBeNull()
    expect(parseFeetInches(`'`)).toBeNull()
    expect(parseFeetInches('1/0')).toBeNull()
    expect(parseFeetInches('12x5')).toBeNull()
  })

  it('round-trips formatted values exactly', () => {
    const values = [0, 0.125, 5.5, 11, 144, 149.125, 149.625, 300.875, -149.125, -0.25]
    for (const value of values) {
      expect(parseFeetInches(formatFeetInches(value))).toBe(value)
    }
  })
})
