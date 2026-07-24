import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useUnderlayRotation } from '@/composables/useUnderlayRotation'
import type { Underlay } from '@/types/plan'
import type { ImageSize } from '@/utils/imageSize'
import { underlayToWorld } from '@/utils/underlay'

const SIZE: ImageSize = { width: 200, height: 120 }

function makeUnderlay(): Underlay {
  return {
    image_ref: 'a1',
    transform: { origin: { x: 100, y: 50 }, rotation_deg: 30, scale: 0.5 },
    opacity: 0.4,
    locked: false,
    visible: true,
  }
}

function setup(underlayValue: Underlay | null, size: ImageSize | null = SIZE) {
  const underlay = ref(underlayValue)
  const imageSize = ref<ImageSize | null>(size)
  const commit = vi.fn<(next: Underlay) => void>()
  const rotation = useUnderlayRotation({ underlay, imageSize, commit })
  return { underlay, imageSize, commit, rotation }
}

describe('useUnderlayRotation', () => {
  it('commits the typed angle about the image centre and clears the draft', () => {
    const initial = makeUnderlay()
    const { commit, rotation } = setup(initial)
    const centrePixel = { x: SIZE.width / 2, y: SIZE.height / 2 }
    const centreBefore = underlayToWorld(initial.transform, centrePixel)

    rotation.draft.value = '75'
    rotation.apply()

    expect(commit).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0][0]
    expect(committed.transform.rotation_deg).toBe(75)
    expect(committed.transform.scale).toBe(initial.transform.scale)
    // The picture pivots in place: its centre stays fixed in world space.
    const centreAfter = underlayToWorld(committed.transform, centrePixel)
    expect(centreAfter.x).toBeCloseTo(centreBefore.x, 6)
    expect(centreAfter.y).toBeCloseTo(centreBefore.y, 6)
    expect(rotation.draft.value).toBe('')
    expect(rotation.error.value).toBe(false)
  })

  it('normalizes the typed angle into (-180, 180]', () => {
    const { commit, rotation } = setup(makeUnderlay())
    rotation.draft.value = '270'
    rotation.apply()
    expect(commit.mock.calls[0][0].transform.rotation_deg).toBe(-90)
  })

  it('rotates about the origin when the natural image size is unknown', () => {
    const initial = makeUnderlay()
    const { commit, rotation } = setup(initial, null)
    rotation.draft.value = '90'
    rotation.apply()
    const committed = commit.mock.calls[0][0]
    expect(committed.transform.rotation_deg).toBe(90)
    expect(committed.transform.origin).toEqual(initial.transform.origin)
  })

  it('flags a non-numeric draft without committing and keeps the draft editable', () => {
    const { commit, rotation } = setup(makeUnderlay())
    rotation.draft.value = 'quarter turn'
    rotation.apply()
    expect(rotation.error.value).toBe(true)
    expect(rotation.draft.value).toBe('quarter turn')
    expect(commit).not.toHaveBeenCalled()
  })

  it('does nothing on an empty draft or without an underlay', () => {
    const empty = setup(makeUnderlay())
    empty.rotation.apply()
    expect(empty.commit).not.toHaveBeenCalled()

    const missing = setup(null)
    missing.rotation.draft.value = '45'
    missing.rotation.apply()
    expect(missing.commit).not.toHaveBeenCalled()
  })

  it('resets the draft and error when the underlay image changes', async () => {
    const { underlay, rotation } = setup(makeUnderlay())
    rotation.draft.value = 'oops'
    rotation.apply()
    expect(rotation.error.value).toBe(true)

    underlay.value = { ...makeUnderlay(), image_ref: 'a2' }
    await nextTick()

    expect(rotation.draft.value).toBe('')
    expect(rotation.error.value).toBe(false)
  })
})
