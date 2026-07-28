import { describe, expect, it } from 'vitest'

import {
  TOOLS,
  armedDeviceTypeFor,
  isRestorableToolId,
  startupToolFor,
} from '@/components/editor/tools'
import { makeDevice, makeDocument, makeUnderlay, makeWall } from '../helpers/planFactory'

describe('startupToolFor', () => {
  it('arms the wall tool on a plan with no walls, whatever tool was saved', () => {
    expect(startupToolFor(makeDocument())).toBe('wall')
    expect(startupToolFor(makeDocument({ active_tool: 'device' }))).toBe('wall')
  })

  it('arms the calibrate tool when an underlay exists but no walls do (photo-first plan)', () => {
    // Nothing marks an underlay as calibrated, so "underlay AND no walls" is
    // the uncalibrated heuristic (spec P5/U2) — whatever tool was saved.
    const document = makeDocument({ underlay: makeUnderlay(), active_tool: 'select' })
    expect(startupToolFor(document)).toBe('calibrate')
  })

  it('restores the saved tool over an underlay once tracing has started', () => {
    const document = makeDocument({
      underlay: makeUnderlay(),
      walls: [makeWall()],
      active_tool: 'device',
    })
    expect(startupToolFor(document)).toBe('device')
  })

  it('restores the saved tool once the plan has walls', () => {
    const document = makeDocument({ walls: [makeWall()], active_tool: 'device' })
    expect(startupToolFor(document)).toBe('device')
  })

  it('falls back to select when the saved tool is missing or unknown', () => {
    const walls = [makeWall()]
    expect(startupToolFor(makeDocument({ walls, active_tool: null }))).toBe('select')
    expect(startupToolFor(makeDocument({ walls, active_tool: 'teleport' }))).toBe('select')
  })

  it('restores the tape measure, now that it is an enabled tool (spec S9)', () => {
    const document = makeDocument({ walls: [makeWall()], active_tool: 'measure' })
    expect(startupToolFor(document)).toBe('measure')
  })
})

describe('isRestorableToolId', () => {
  it('accepts enabled tool ids and rejects everything else', () => {
    expect(isRestorableToolId('wall')).toBe(true)
    expect(isRestorableToolId('select')).toBe(true)
    expect(isRestorableToolId('measure')).toBe(true)
    expect(isRestorableToolId('teleport')).toBe(false)
    expect(isRestorableToolId(null)).toBe(false)
  })
})

describe('TOOLS', () => {
  it('offers the tape measure as an enabled tool on M with the ruler icon (spec S9)', () => {
    const measure = TOOLS.find((tool) => tool.id === 'measure')

    expect(measure).toMatchObject({ name: 'Tape measure', shortcut: 'm', enabled: true })
    // Every declared tool now ships, so nothing in the rail is a dead slot.
    expect(TOOLS.every((tool) => tool.enabled)).toBe(true)
  })
})

describe('armedDeviceTypeFor', () => {
  it('arms the panel when the plan has no devices yet, whatever the MRU holds', () => {
    expect(armedDeviceTypeFor([], [])).toBe('panel')
    expect(armedDeviceTypeFor([], ['outlet', 'ceiling_light'])).toBe('panel')
  })

  it('arms the most-recently-used type once the plan has devices', () => {
    const devices = [makeDevice()]
    expect(armedDeviceTypeFor(devices, ['ceiling_light', 'outlet'])).toBe('ceiling_light')
  })

  it('falls back to the picker when the plan has devices but no MRU history', () => {
    expect(armedDeviceTypeFor([makeDevice()], [])).toBeNull()
  })
})
