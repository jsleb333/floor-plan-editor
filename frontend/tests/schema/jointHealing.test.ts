import { describe, expect, it } from 'vitest'

import { healJoints } from '@/schema/jointHealing'
import { deriveJoints } from '@/utils/geometry'

import { makeDocument, makeWall } from '../helpers/planFactory'

/** 10' wall running east along y = 0, 3.5" thick: faces at y = -1.75 and y = +1.75. */
const HOST = makeWall({
  id: 'host',
  vertices: [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
  ],
})

/** A partition whose start sits ON the host's reference line, as a pre-v8 document stored it. */
const STUB_ON_SPINE = makeWall({
  id: 'stub',
  vertices: [
    { x: 60, y: 0 },
    { x: 60, y: 96 },
  ],
})

describe('healJoints', () => {
  it('leaves a document that already carries joints untouched', () => {
    const document = makeDocument({
      walls: [HOST, STUB_ON_SPINE],
      joints: deriveJoints([HOST, STUB_ON_SPINE]),
    })

    expect(healJoints(document)).toBe(document)
  })

  it('leaves a document with no walls untouched', () => {
    const document = makeDocument()

    expect(healJoints(document)).toBe(document)
  })

  it('derives the wall network a document arrived without', () => {
    const document = makeDocument({ walls: [HOST, STUB_ON_SPINE] })

    const healed = healJoints(document)

    expect(healed).not.toBe(document)
    expect(healed.joints).toEqual(deriveJoints([HOST, STUB_ON_SPINE]))
    expect(healed.joints.map((joint) => joint.kind)).toEqual(['tee'])
  })

  it('pulls a T endpoint stored on the host spine back onto the host face', () => {
    const document = makeDocument({ walls: [HOST, STUB_ON_SPINE] })

    const healed = healJoints(document)

    const stub = healed.walls.find((wall) => wall.id === 'stub')
    expect(stub?.vertices[0]).toEqual({ x: 60, y: 1.75 })
    expect(stub?.vertices[1]).toEqual({ x: 60, y: 96 })
    expect(healed.walls.find((wall) => wall.id === 'host')?.vertices).toEqual(HOST.vertices)
  })

  it('keeps every other field of the document as it was', () => {
    const document = makeDocument({
      walls: [HOST],
      labels: [{ id: 'lb-1', position: { x: 0, y: 0 }, text: 'Salon', size_in: 8 }],
      active_tool: 'wall',
    })

    const healed = healJoints(document)

    expect(healed.labels).toBe(document.labels)
    expect(healed.active_tool).toBe('wall')
    expect(healed.schema_version).toBe(document.schema_version)
  })
})
