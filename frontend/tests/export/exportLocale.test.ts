import { describe, expect, it } from 'vitest'

import { EXPORT_STRINGS, preferredExportLanguage } from '@/export/exportLocale'

describe('preferredExportLanguage', () => {
  it('offers French to a French browser, whatever the region', () => {
    expect(preferredExportLanguage(['fr-CA', 'en-CA'])).toBe('fr')
    expect(preferredExportLanguage(['FR'])).toBe('fr')
  })

  it('falls back to English for anything else, including no stated locale', () => {
    expect(preferredExportLanguage(['en-US'])).toBe('en')
    expect(preferredExportLanguage([])).toBe('en')
  })
})

describe('EXPORT_STRINGS', () => {
  it('says everything in both languages, with nothing left in English by accident', () => {
    const keys = Object.keys(EXPORT_STRINGS.en) as (keyof typeof EXPORT_STRINGS.en)[]

    expect(Object.keys(EXPORT_STRINGS.fr)).toEqual(keys)
    for (const key of keys) {
      expect(EXPORT_STRINGS.fr[key].length).toBeGreaterThan(0)
    }
    // "Circuits" is genuinely the same word; everything else is translated.
    const untranslated = keys.filter((key) => EXPORT_STRINGS.fr[key] === EXPORT_STRINGS.en[key])
    expect(untranslated).toEqual(['circuits'])
  })
})
