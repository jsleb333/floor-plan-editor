const INCHES_PER_FOOT = 12
const DEFAULT_RESOLUTION = 1 / 8

const FEET_INCHES_PATTERN =
  /^(-)?\s*(?:(\d+(?:\.\d+)?)\s*(?:'|ft)\s*)?(?:(?:(\d+(?:\.\d+)?)\s+)?(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d+)?))?\s*(?:"|in)?\s*$/i

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

/**
 * Formats a length in inches as feet and fractional inches, e.g. `12'5 1/8"`.
 *
 * The value is rounded to the nearest `resolution` (default 1/8"), the
 * fraction is reduced (2/8 -> 1/4), and values under one foot omit the feet
 * part (`5 1/2"`). Negative lengths are prefixed with `-`.
 *
 * @param inches Length in inches (the canonical drawing unit).
 * @param resolution Rounding step in inches: 1, 1/2, 1/4 or 1/8 (default).
 */
export function formatFeetInches(inches: number, resolution: number = DEFAULT_RESOLUTION): string {
  const denominator = Math.max(1, Math.round(1 / resolution))
  const totalUnits = Math.round(Math.abs(inches) * denominator)
  const sign = inches < 0 && totalUnits > 0 ? '-' : ''
  const feet = Math.floor(totalUnits / (INCHES_PER_FOOT * denominator))
  const remainderUnits = totalUnits - feet * INCHES_PER_FOOT * denominator
  const wholeInches = Math.floor(remainderUnits / denominator)
  const numerator = remainderUnits - wholeInches * denominator
  const divisor = numerator > 0 ? greatestCommonDivisor(numerator, denominator) : 1
  const fraction = numerator > 0 ? `${numerator / divisor}/${denominator / divisor}` : ''

  if (feet === 0) {
    if (wholeInches === 0 && fraction) return `${sign}${fraction}"`
    return `${sign}${wholeInches}${fraction ? ` ${fraction}` : ''}"`
  }
  return `${sign}${feet}'${wholeInches}${fraction ? ` ${fraction}` : ''}"`
}

/**
 * Formats a length as inches only, e.g. `32"`, `4 1/2"`, `1/8"`.
 *
 * Same rounding and fraction-reduction rules as `formatFeetInches`, but never
 * carries into feet — for values conventionally quoted in inches (wall
 * thicknesses, opening widths).
 *
 * @param inches Length in inches (the canonical drawing unit).
 * @param resolution Rounding step in inches: 1, 1/2, 1/4 or 1/8 (default).
 */
export function formatInches(inches: number, resolution: number = DEFAULT_RESOLUTION): string {
  const denominator = Math.max(1, Math.round(1 / resolution))
  const totalUnits = Math.round(Math.abs(inches) * denominator)
  const sign = inches < 0 && totalUnits > 0 ? '-' : ''
  const whole = Math.floor(totalUnits / denominator)
  const numerator = totalUnits - whole * denominator
  if (numerator === 0) return `${sign}${whole}"`
  const divisor = greatestCommonDivisor(numerator, denominator)
  const fraction = `${numerator / divisor}/${denominator / divisor}`
  return whole > 0 ? `${sign}${whole} ${fraction}"` : `${sign}${fraction}"`
}

/**
 * Parses a feet-and-inches expression into inches, or `null` when invalid.
 *
 * Accepted forms (case-insensitive, `"`/`in` and whitespace optional):
 * `12'5`, `12' 5 1/2`, `12'5 1/8"`, `12.5'`, `150`, `5 1/2"`, `1/2`, `-3'`.
 * A bare number is interpreted as inches.
 */
export function parseFeetInches(text: string): number | null {
  const match = FEET_INCHES_PATTERN.exec(text.trim())
  if (!match) return null
  const [, sign, feetText, wholeText, numeratorText, denominatorText, plainText] = match
  if (!feetText && !numeratorText && !plainText) return null

  let inches = 0
  if (feetText) {
    inches += Number.parseFloat(feetText) * INCHES_PER_FOOT
  }
  if (numeratorText && denominatorText) {
    const denominator = Number.parseFloat(denominatorText)
    if (denominator === 0) return null
    inches +=
      (wholeText ? Number.parseFloat(wholeText) : 0) +
      Number.parseFloat(numeratorText) / denominator
  } else if (plainText) {
    inches += Number.parseFloat(plainText)
  }
  return sign ? -inches : inches
}
