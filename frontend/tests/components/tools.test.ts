import { describe, expect, it } from 'vitest'

import { isRestorableToolId, startupToolFor } from '@/components/editor/tools'
import { makeDocument, makeWall } from '../helpers/planFactory'

describe('startupToolFor', () => {
  it('arms the wall tool on a plan with no walls, whatever tool was saved', () => {
    expect(startupToolFor(makeDocument())).toBe('wall')
    expect(startupToolFor(makeDocument({ active_tool: 'device' }))).toBe('wall')
  })

  it('restores the saved tool once the plan has walls', () => {
    const document = makeDocument({ walls: [makeWall()], active_tool: 'device' })
    expect(startupToolFor(document)).toBe('device')
  })

  it('falls back to select when the saved tool is missing, unknown or disabled', () => {
    const walls = [makeWall()]
    expect(startupToolFor(makeDocument({ walls, active_tool: null }))).toBe('select')
    expect(startupToolFor(makeDocument({ walls, active_tool: 'teleport' }))).toBe('select')
    // 'measure' is a declared tool that is not enabled yet — it must not be restored.
    expect(startupToolFor(makeDocument({ walls, active_tool: 'measure' }))).toBe('select')
  })
})

describe('isRestorableToolId', () => {
  it('accepts enabled tool ids and rejects everything else', () => {
    expect(isRestorableToolId('wall')).toBe(true)
    expect(isRestorableToolId('select')).toBe(true)
    expect(isRestorableToolId('measure')).toBe(false)
    expect(isRestorableToolId('teleport')).toBe(false)
    expect(isRestorableToolId(null)).toBe(false)
  })
})
