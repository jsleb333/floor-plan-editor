import { describe, expect, it } from 'vitest'

import { EXPORT_APP_ID, exportPlanJson, importPlanJson } from '@/export/jsonExport'
import type { PlanExportEnvelope } from '@/export/jsonExport'

import { makeCircuit, makeDevice, makeDocument, makeWall, makeWire } from '../helpers/planFactory'

async function fileFromBlob(blob: Blob, name: string): Promise<File> {
  return new File([await blob.text()], name, { type: 'application/json' })
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
  })

  it('accepts a bare document and names it from the file', async () => {
    const document = makeDocument()
    const file = new File([JSON.stringify(document)], 'My Plan.json', { type: 'application/json' })
    const imported = await importPlanJson(file)
    expect(imported.name).toBe('My Plan')
    expect(imported.document).toEqual(document)
  })

  it('rejects non-JSON files', async () => {
    const file = new File(['not json{'], 'x.json', { type: 'application/json' })
    await expect(importPlanJson(file)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects JSON that is not a plan document', async () => {
    const file = new File([JSON.stringify({ hello: 'world' })], 'x.json')
    await expect(importPlanJson(file)).rejects.toThrow(/floor-plan document/)
  })
})
