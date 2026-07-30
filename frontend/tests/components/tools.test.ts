import { describe, expect, it } from 'vitest'

import {
  MODES,
  TOOLS,
  armedDeviceTypeFor,
  isModeId,
  isRestorableToolId,
  modeForTool,
  startupStateFor,
  startupToolFor,
  toolsForMode,
} from '@/components/editor/tools'
import type { ModeId } from '@/components/editor/tools'
import { makeDevice, makeDocument, makeUnderlay, makeWall } from '../helpers/planFactory'

describe('toolsForMode', () => {
  it('scopes the rail to each mode, keeping the shared tools in all of them (spec E10)', () => {
    const ids = (mode: ModeId): string[] => toolsForMode(mode).map((tool) => tool.id)

    expect(ids('structure')).toEqual([
      'select',
      'wall',
      'door',
      'window',
      'stairs',
      'label',
      'dimension',
      'measure',
      'calibrate',
    ])
    expect(ids('electrical')).toEqual(['select', 'label', 'device', 'wire'])
    expect(ids('inspector')).toEqual(['select', 'label', 'dimension', 'measure'])
  })

  it('lists every tool in at least one mode, so none is unreachable', () => {
    const reachable = new Set(MODES.flatMap((mode) => toolsForMode(mode.id).map((t) => t.id)))
    const orphans = TOOLS.filter((tool) => !reachable.has(tool.id)).map((tool) => tool.id)
    expect(orphans).toEqual([])
  })
})

describe('modeForTool', () => {
  it('resolves the mode a chord lands in: the tool first declared mode', () => {
    expect(modeForTool('wall')).toBe('structure')
    expect(modeForTool('device')).toBe('electrical')
    expect(modeForTool('wire')).toBe('electrical')
    expect(modeForTool('measure')).toBe('structure')
    // Shared tools land in the first mode they declare.
    expect(modeForTool('select')).toBe('structure')
    expect(modeForTool('dimension')).toBe('structure')
  })
})

describe('isModeId', () => {
  it('accepts mode ids and rejects everything else', () => {
    expect(isModeId('structure')).toBe(true)
    expect(isModeId('electrical')).toBe(true)
    expect(isModeId('inspector')).toBe(true)
    expect(isModeId('plumbing')).toBe(false)
    expect(isModeId(null)).toBe(false)
  })
})

describe('mode shortcut invariants (spec E10)', () => {
  it('gives every tool of a mode a distinct letter, so no letter is ambiguous in-mode', () => {
    for (const mode of MODES) {
      const shortcuts = toolsForMode(mode.id).map((tool) => tool.shortcut)
      expect(
        new Set(shortcuts).size,
        `duplicate tool letter in ${mode.id}: ${shortcuts.join()}`,
      ).toBe(shortcuts.length)
    }
  })

  it('keeps every mode reachable: no mode letter collides with a tool letter of another mode', () => {
    for (const mode of MODES) {
      for (const other of MODES) {
        if (other.id === mode.id) continue
        const shadowing = toolsForMode(other.id).filter((tool) => tool.shortcut === mode.shortcut)
        expect(
          shadowing.map((tool) => tool.id),
          `${mode.name} (${mode.shortcut}) is unreachable from ${other.name}`,
        ).toEqual([])
      }
    }
  })
})

describe('startupStateFor', () => {
  it('opens an empty plan in Structure with the wall tool, whatever was saved (spec E9)', () => {
    expect(startupStateFor(makeDocument())).toEqual({ mode: 'structure', tool: 'wall' })
    expect(
      startupStateFor(makeDocument({ active_mode: 'electrical', active_tool: 'device' })),
    ).toEqual({ mode: 'structure', tool: 'wall' })
  })

  it('opens a photo-first plan in Structure with the calibrate tool (spec P5/U2)', () => {
    const document = makeDocument({ underlay: makeUnderlay(), active_mode: 'inspector' })
    expect(startupStateFor(document)).toEqual({ mode: 'structure', tool: 'calibrate' })
  })

  it('restores the saved mode and tool once the plan has walls (spec P4)', () => {
    const document = makeDocument({
      walls: [makeWall()],
      active_mode: 'electrical',
      active_tool: 'wire',
    })
    expect(startupStateFor(document)).toEqual({ mode: 'electrical', tool: 'wire' })
  })

  it('resolves the mode from the tool when the saved tool is not in the saved mode', () => {
    const document = makeDocument({
      walls: [makeWall()],
      active_mode: 'structure',
      active_tool: 'device',
    })
    expect(startupStateFor(document)).toEqual({ mode: 'electrical', tool: 'device' })
  })

  it('resolves the mode from the tool for a session saved before modes existed', () => {
    const document = makeDocument({ walls: [makeWall()], active_mode: null, active_tool: 'wire' })
    expect(startupStateFor(document)).toEqual({ mode: 'electrical', tool: 'wire' })
  })

  it('falls back to Structure / Select on missing or unknown saved values', () => {
    const walls = [makeWall()]
    expect(startupStateFor(makeDocument({ walls }))).toEqual({ mode: 'structure', tool: 'select' })
    expect(
      startupStateFor(makeDocument({ walls, active_mode: 'plumbing', active_tool: 'teleport' })),
    ).toEqual({ mode: 'structure', tool: 'select' })
    // A garbage mode with a good tool still restores the tool, mode derived from it.
    expect(
      startupStateFor(makeDocument({ walls, active_mode: 'plumbing', active_tool: 'device' })),
    ).toEqual({ mode: 'electrical', tool: 'device' })
    // A stored mode+tool pair restores as saved now that the tape measure is
    // an enabled tool available in inspector mode (spec S9).
    expect(
      startupStateFor(makeDocument({ walls, active_mode: 'inspector', active_tool: 'measure' })),
    ).toEqual({ mode: 'inspector', tool: 'measure' })
    // A good mode with a garbage tool keeps the mode and arms Select.
    expect(
      startupStateFor(makeDocument({ walls, active_mode: 'inspector', active_tool: 'teleport' })),
    ).toEqual({ mode: 'inspector', tool: 'select' })
  })
})

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
