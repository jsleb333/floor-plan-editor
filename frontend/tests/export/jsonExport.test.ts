import { describe, expect, it } from 'vitest'

import { EXPORT_APP_ID, exportPlanJson, importPlanJson } from '@/export/jsonExport'
import type { PlanExportEnvelope } from '@/export/jsonExport'
import { CURRENT_SCHEMA_VERSION, UnsupportedSchemaVersionError } from '@/schema/planDocumentSchema'

import { makeCircuit, makeDevice, makeDocument, makeWall, makeWire } from '../helpers/planFactory'

async function fileFromBlob(blob: Blob, name: string): Promise<File> {
  return new File([await blob.text()], name, { type: 'application/json' })
}

function jsonFile(content: unknown, name = 'plan.json'): File {
  return new File([JSON.stringify(content)], name, { type: 'application/json' })
}

describe('exportPlanJson', () => {
  it('wraps the document in the app envelope with the caller-supplied timestamp', async () => {
    const document = makeDocument({ walls: [makeWall()] })
    const blob = exportPlanJson({ name: 'Basement', document }, '2026-07-12T10:00:00.000Z')
    const envelope = JSON.parse(await blob.text()) as PlanExportEnvelope
    expect(envelope.app).toBe(EXPORT_APP_ID)
    expect(envelope.exported_at).toBe('2026-07-12T10:00:00.000Z')
    expect(envelope.name).toBe('Basement')
    expect(envelope.document).toEqual(document)
  })
})

describe('importPlanJson', () => {
  it('round-trips an exported file to an identical document (spec X1)', async () => {
    const document = makeDocument({
      walls: [makeWall()],
      devices: [makeDevice()],
      circuits: [makeCircuit()],
      wires: [makeWire()],
    })
    const blob = exportPlanJson({ name: 'Basement', document }, new Date().toISOString())
    const imported = await importPlanJson(await fileFromBlob(blob, 'basement.json'))
    expect(imported.name).toBe('Basement')
    expect(imported.document).toEqual(document)
    expect(imported.issues).toEqual([])
    expect(imported.migratedFrom).toBeNull()
  })

  it('accepts a bare document and names it from the file', async () => {
    const document = makeDocument()
    const imported = await importPlanJson(jsonFile(document, 'My Plan.json'))
    expect(imported.name).toBe('My Plan')
    expect(imported.document).toEqual(document)
    expect(imported.migratedFrom).toBeNull()
  })

  it('rejects non-JSON files', async () => {
    const file = new File(['not json{'], 'x.json', { type: 'application/json' })
    await expect(importPlanJson(file)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects JSON that is not a plan document', async () => {
    const file = new File([JSON.stringify({ hello: 'world' })], 'x.json')
    await expect(importPlanJson(file)).rejects.toThrow(/floor-plan document/)
  })

  it('migrates an older file forward and reports the version it came from', async () => {
    const file = jsonFile({
      schema_version: 5,
      viewport: { center: { x: 0, y: 0 }, zoom: 1 },
      walls: [
        {
          id: 'w1',
          vertices: [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
          ],
          thickness_in: 4,
        },
      ],
    })

    const imported = await importPlanJson(file)

    expect(imported.migratedFrom).toBe(5)
    expect(imported.document.schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(imported.document.walls[0]).toMatchObject({ id: 'w1', color: null })
    expect(imported.issues).toEqual([])
  })

  it('accepts a legacy file that carries no schema version at all', async () => {
    const imported = await importPlanJson(jsonFile({ walls: [], labels: [] }))

    expect(imported.migratedFrom).toBe(1)
    expect(imported.document.schema_version).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('repairs what it can and reports each repair instead of failing the import', async () => {
    const file = jsonFile({
      schema_version: CURRENT_SCHEMA_VERSION,
      viewport: { center: { x: 0, y: 0 }, zoom: 1 },
      walls: [
        {
          id: 'w1',
          vertices: [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
          ],
          thickness_in: 0,
        },
      ],
      devices: [{ id: 'd1', type: 'toaster', position: { x: 0, y: 0 } }],
    })

    const imported = await importPlanJson(file)

    expect(imported.document.walls[0].thickness_in).toBe(3.5)
    expect(imported.document.devices).toEqual([])
    expect(imported.issues).toHaveLength(1)
    expect(imported.issues[0]).toMatchObject({ path: 'devices.0.type' })
  })

  it('refuses a file written by a newer build of the app', async () => {
    const file = jsonFile({
      schema_version: CURRENT_SCHEMA_VERSION + 1,
      viewport: { center: { x: 0, y: 0 }, zoom: 1 },
    })

    await expect(importPlanJson(file)).rejects.toThrow(UnsupportedSchemaVersionError)
  })

  it('reads the document out of the envelope even when the envelope names nothing', async () => {
    const document = makeDocument()
    const file = jsonFile(
      { app: EXPORT_APP_ID, exported_at: 'now', name: '  ', document },
      'Kitchen.json',
    )

    const imported = await importPlanJson(file)

    expect(imported.name).toBe('Kitchen')
    expect(imported.document).toEqual(document)
  })
})
