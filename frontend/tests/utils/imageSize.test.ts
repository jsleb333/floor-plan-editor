import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadImageSize, measureImageFile } from '@/utils/imageSize'

const DECODED = { width: 640, height: 480 }
const OBJECT_URL = 'blob:measured'

let decodeFails = false
const decodedUrls: string[] = []

/** jsdom decodes nothing, so stand in for the browser decoder off a settable `src`. */
class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(url: string) {
    decodedUrls.push(url)
    queueMicrotask(() => {
      if (decodeFails) {
        this.onerror?.()
        return
      }
      this.naturalWidth = DECODED.width
      this.naturalHeight = DECODED.height
      this.onload?.()
    })
  }
}

describe('imageSize', () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>(() => OBJECT_URL)
  const revokeObjectURL = vi.fn<(url: string) => void>()

  beforeEach(() => {
    decodeFails = false
    decodedUrls.length = 0
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.stubGlobal('Image', FakeImage)
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  describe('loadImageSize', () => {
    it('resolves the natural pixel size of the decoded image', async () => {
      await expect(loadImageSize('/api/assets/a1')).resolves.toEqual(DECODED)
      expect(decodedUrls).toEqual(['/api/assets/a1'])
    })

    it('rejects when the image cannot be decoded', async () => {
      decodeFails = true
      await expect(loadImageSize('/api/assets/a1')).rejects.toThrow(/underlay image/)
    })
  })

  describe('measureImageFile', () => {
    it('measures the file through a temporary object URL and revokes it', async () => {
      const file = new File(['bytes'], 'plan.png', { type: 'image/png' })

      await expect(measureImageFile(file)).resolves.toEqual(DECODED)

      expect(createObjectURL).toHaveBeenCalledWith(file)
      expect(decodedUrls).toEqual([OBJECT_URL])
      expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
    })

    it('revokes the object URL even when the file does not decode', async () => {
      decodeFails = true
      const file = new File(['bytes'], 'plan.png', { type: 'image/png' })

      await expect(measureImageFile(file)).rejects.toThrow(/underlay image/)

      expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
    })
  })
})
