/**
 * The two languages an exported plan can be labelled in (spec X5): English and
 * Québec French — the language a residential plan is actually read in here.
 *
 * Only the editor's OWN words are translated. Everything the user authored
 * (circuit names, room labels) is emitted verbatim in both languages, and
 * device names come from the catalog, which already carries the French legend
 * name of every pictogram alongside its English label.
 */
export type ExportLanguage = 'en' | 'fr'

/** Every word the export puts on paper that the editor, not the user, chose. */
export interface ExportStrings {
  legendTitle: string
  circuits: string
  devices: string
  walls: string
  exteriorWall: string
  interiorWall: string
  /** Kind label replacing the rating on a circuit that carries no load (spec C3). */
  dataCircuit: string
  lowVoltageCircuit: string
}

export const EXPORT_STRINGS: Record<ExportLanguage, ExportStrings> = {
  en: {
    legendTitle: 'Legend',
    circuits: 'Circuits',
    devices: 'Devices',
    walls: 'Walls',
    exteriorWall: 'Exterior wall',
    interiorWall: 'Interior wall',
    dataCircuit: 'Data',
    lowVoltageCircuit: 'Low voltage',
  },
  fr: {
    legendTitle: 'Légende',
    circuits: 'Circuits',
    devices: 'Appareils',
    walls: 'Murs',
    exteriorWall: 'Mur extérieur',
    interiorWall: 'Mur intérieur',
    dataCircuit: 'Données',
    lowVoltageCircuit: 'Basse tension',
  },
}

/** Display name of `language`, for the export dialog's own picker. */
export const EXPORT_LANGUAGE_LABELS: Record<ExportLanguage, string> = {
  en: 'English',
  fr: 'Français',
}

/** Every offered language, in picker order. */
export const EXPORT_LANGUAGES: readonly ExportLanguage[] = ['en', 'fr']

/**
 * The language to preselect in the export dialog: French for a French browser
 * (the common case for a Québec plan), English otherwise.
 */
export function preferredExportLanguage(locales: readonly string[]): ExportLanguage {
  return locales.some((locale) => locale.toLowerCase().startsWith('fr')) ? 'fr' : 'en'
}
