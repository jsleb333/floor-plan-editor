import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { defineComponent, effectScope, h, ref } from 'vue'
import type { Ref } from 'vue'

import type { AssetUrlHandle } from '@/persistence/ports'
import type { ImageSize } from '@/utils/imageSize'

vi.mock('@/persistence/assets', () => ({
  uploadAsset: vi.fn(),
  resolveAssetUrl: vi.fn(),
  readAssetBlob: vi.fn(),
}))

vi.mock('@/utils/imageSize', () => ({
  loadImageSize: vi.fn(),
  measureImageFile: vi.fn(),
}))

import { useUnderlayImage } from '@/composables/useUnderlayImage'
import type { UseUnderlayImageReturn } from '@/composables/useUnderlayImage'
import { resolveAssetUrl } from '@/persistence/assets'
import { loadImageSize } from '@/utils/imageSize'

const resolveAssetUrlMock = vi.mocked(resolveAssetUrl)
const loadImageSizeMock = vi.mocked(loadImageSize)

const SIZE_A: ImageSize = { width: 120, height: 80 }
const SIZE_B: ImageSize = { width: 640, height: 480 }

/** A handle whose `release` is observable, standing in for an object-URL handle. */
interface SpiedHandle extends AssetUrlHandle {
  release: Mock<() => void>
}

interface Deferred<T> {
  promise: Promise<T>
  settle: (value: T) => void
}

/** A promise settled by the test, to park the composable mid-resolve or mid-measure. */
function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function makeHandle(url: string): SpiedHandle {
  return { url, release: vi.fn<() => void>() }
}

function setup(initial: string | null): {
  imageRef: Ref<string | null>
  image: UseUnderlayImageReturn
  dispose: () => void
} {
  const imageRef = ref<string | null>(initial)
  const scope = effectScope()
  const image = scope.run(() => useUnderlayImage(imageRef))
  if (!image) throw new Error('the effect scope did not run')
  return { imageRef, image, dispose: () => scope.stop() }
}

describe('useUnderlayImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes href and size together, never a URL without its size', async () => {
    const handle = makeHandle('blob:a')
    resolveAssetUrlMock.mockResolvedValue(handle)
    const measure = deferred<ImageSize>()
    loadImageSizeMock.mockReturnValue(measure.promise)

    const { image } = setup('a')
    await flushPromises()

    expect(resolveAssetUrlMock).toHaveBeenCalledWith('a')
    expect(loadImageSizeMock).toHaveBeenCalledWith('blob:a')
    expect(image.href.value).toBe('')
    expect(image.size.value).toBeNull()

    measure.settle(SIZE_A)
    await flushPromises()

    expect(image.href.value).toBe('blob:a')
    expect(image.size.value).toEqual(SIZE_A)
    expect(image.error.value).toBeNull()
    expect(handle.release).not.toHaveBeenCalled()
  })

  it('releases the previous handle only after the new href is bound', async () => {
    const first = makeHandle('blob:a')
    const second = makeHandle('blob:b')
    resolveAssetUrlMock.mockImplementation((id) => Promise.resolve(id === 'a' ? first : second))
    loadImageSizeMock.mockImplementation((url) =>
      Promise.resolve(url === 'blob:a' ? SIZE_A : SIZE_B),
    )

    const { imageRef, image } = setup('a')
    await flushPromises()
    expect(image.href.value).toBe('blob:a')

    const hrefsWhenReleased: string[] = []
    first.release.mockImplementation(() => hrefsWhenReleased.push(image.href.value))

    imageRef.value = 'b'
    await flushPromises()

    expect(image.href.value).toBe('blob:b')
    expect(image.size.value).toEqual(SIZE_B)
    expect(first.release).toHaveBeenCalledTimes(1)
    expect(hrefsWhenReleased).toEqual(['blob:b'])
    expect(second.release).not.toHaveBeenCalled()
  })

  it('patches the new URL into the DOM before revoking the previous one', async () => {
    const first = makeHandle('blob:a')
    const second = makeHandle('blob:b')
    resolveAssetUrlMock.mockImplementation((id) => Promise.resolve(id === 'a' ? first : second))
    loadImageSizeMock.mockImplementation((url) =>
      Promise.resolve(url === 'blob:a' ? SIZE_A : SIZE_B),
    )

    const imageRef = ref<string | null>('a')
    const host = defineComponent({
      setup() {
        const { href } = useUnderlayImage(imageRef)
        return () => h('img', { src: href.value })
      },
    })
    const wrapper = mount(host)
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:a')

    const boundWhenReleased: (string | undefined)[] = []
    first.release.mockImplementation(() =>
      boundWhenReleased.push(wrapper.get('img').attributes('src')),
    )

    imageRef.value = 'b'
    await flushPromises()

    expect(boundWhenReleased).toEqual(['blob:b'])

    wrapper.unmount()

    expect(second.release).toHaveBeenCalledTimes(1)
  })

  it('releases its own handle, not the winning one, when a newer id resolves first', async () => {
    const first = makeHandle('blob:a')
    const second = makeHandle('blob:b')
    const firstResolve = deferred<AssetUrlHandle>()
    resolveAssetUrlMock.mockImplementation((id) =>
      id === 'a' ? firstResolve.promise : Promise.resolve(second),
    )
    loadImageSizeMock.mockResolvedValue(SIZE_B)

    const { imageRef, image } = setup('a')
    await flushPromises()

    imageRef.value = 'b'
    await flushPromises()
    expect(image.href.value).toBe('blob:b')

    firstResolve.settle(first)
    await flushPromises()

    expect(first.release).toHaveBeenCalledTimes(1)
    expect(second.release).not.toHaveBeenCalled()
    expect(image.href.value).toBe('blob:b')
    expect(image.size.value).toEqual(SIZE_B)
  })

  it('releases its own handle when a newer id wins while it is being measured', async () => {
    const first = makeHandle('blob:a')
    const second = makeHandle('blob:b')
    resolveAssetUrlMock.mockImplementation((id) => Promise.resolve(id === 'a' ? first : second))
    const firstMeasure = deferred<ImageSize>()
    loadImageSizeMock.mockImplementation((url) =>
      url === 'blob:a' ? firstMeasure.promise : Promise.resolve(SIZE_B),
    )

    const { imageRef, image } = setup('a')
    await flushPromises()
    expect(image.href.value).toBe('')

    imageRef.value = 'b'
    await flushPromises()
    expect(image.href.value).toBe('blob:b')

    firstMeasure.settle(SIZE_A)
    await flushPromises()

    expect(first.release).toHaveBeenCalledTimes(1)
    expect(second.release).not.toHaveBeenCalled()
    expect(image.href.value).toBe('blob:b')
    expect(image.size.value).toEqual(SIZE_B)
  })

  it('clears the binding and releases the handle when the underlay is removed', async () => {
    const handle = makeHandle('blob:a')
    resolveAssetUrlMock.mockResolvedValue(handle)
    loadImageSizeMock.mockResolvedValue(SIZE_A)

    const { imageRef, image } = setup('a')
    await flushPromises()
    expect(image.href.value).toBe('blob:a')

    imageRef.value = null
    await flushPromises()

    expect(image.href.value).toBe('')
    expect(image.size.value).toBeNull()
    expect(image.error.value).toBeNull()
    expect(handle.release).toHaveBeenCalledTimes(1)
  })

  it('surfaces a measure failure, keeps nothing bound and releases the handle', async () => {
    const handle = makeHandle('blob:a')
    resolveAssetUrlMock.mockResolvedValue(handle)
    loadImageSizeMock.mockRejectedValue(new Error('decode failed'))

    const { image } = setup('a')
    await flushPromises()

    expect(image.href.value).toBe('')
    expect(image.size.value).toBeNull()
    expect(image.error.value).toBe('Failed to load the underlay image')
    expect(handle.release).toHaveBeenCalledTimes(1)
  })

  it('clears a previous failure once a later image loads', async () => {
    const second = makeHandle('blob:b')
    resolveAssetUrlMock.mockImplementation((id) =>
      Promise.resolve(id === 'a' ? makeHandle('blob:a') : second),
    )
    loadImageSizeMock.mockImplementation((url) =>
      url === 'blob:a' ? Promise.reject(new Error('decode failed')) : Promise.resolve(SIZE_B),
    )

    const { imageRef, image } = setup('a')
    await flushPromises()
    expect(image.error.value).not.toBeNull()

    imageRef.value = 'b'
    await flushPromises()

    expect(image.error.value).toBeNull()
    expect(image.href.value).toBe('blob:b')
    expect(second.release).not.toHaveBeenCalled()
  })

  it('releases the bound handle when the owning scope is disposed', async () => {
    const handle = makeHandle('blob:a')
    resolveAssetUrlMock.mockResolvedValue(handle)
    loadImageSizeMock.mockResolvedValue(SIZE_A)

    const { image, dispose } = setup('a')
    await flushPromises()
    expect(image.href.value).toBe('blob:a')

    dispose()

    expect(handle.release).toHaveBeenCalledTimes(1)
  })

  it('releases a handle that resolves after the scope is disposed, publishing nothing', async () => {
    const handle = makeHandle('blob:a')
    const resolve = deferred<AssetUrlHandle>()
    resolveAssetUrlMock.mockReturnValue(resolve.promise)
    loadImageSizeMock.mockResolvedValue(SIZE_A)

    const { image, dispose } = setup('a')
    await flushPromises()

    dispose()
    resolve.settle(handle)
    await flushPromises()

    expect(handle.release).toHaveBeenCalledTimes(1)
    expect(loadImageSizeMock).not.toHaveBeenCalled()
    expect(image.href.value).toBe('')
    expect(image.size.value).toBeNull()
  })
})
