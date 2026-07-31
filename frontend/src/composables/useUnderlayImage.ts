import { nextTick, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

import { resolveAssetUrl } from '@/persistence/assets'
import type { AssetUrlHandle } from '@/persistence/ports'
import { loadImageSize } from '@/utils/imageSize'
import type { ImageSize } from '@/utils/imageSize'

/** Shown when the resolved URL does not decode as an image. */
const LOAD_ERROR = 'Failed to load the underlay image'

export interface UseUnderlayImageReturn {
  /** The bound `<image href>`; `''` until the URL resolves AND the image decodes. */
  href: Ref<string>
  /** Natural pixel size, published in the same tick as `href`. */
  size: Ref<ImageSize | null>
  /** User-facing failure message of the last resolve attempt, else null. */
  error: Ref<string | null>
}

/**
 * Resolves the plan underlay's asset id to a bound URL and its natural pixel
 * size, and owns that URL's lifetime.
 *
 * The REST backend hands out a permanent path, but a browser (IndexedDB)
 * backend hands out an object URL that leaks for the session unless released,
 * so exactly one owner may hold it: this composable. It releases the previous
 * handle only after Vue has patched the new `href` into the DOM (revoking a URL
 * an `<image>` still points at renders a broken frame), releases its own handle
 * when a newer image id wins the race, and releases the last one on scope
 * dispose.
 *
 * @param imageRef The underlay's asset id, or null when the plan has no underlay.
 */
export function useUnderlayImage(imageRef: Readonly<Ref<string | null>>): UseUnderlayImageReturn {
  const href = ref('')
  const size = ref<ImageSize | null>(null)
  const error = ref<string | null>(null)

  let handle: AssetUrlHandle | null = null
  let token = 0

  /**
   * Releases the currently held handle once Vue has patched the just-published
   * `href`/`size` into the DOM. Every path that stops binding a URL goes through
   * here, so the DOM never references a revoked URL — whether the URL is being
   * replaced by a newer one or cleared because the plan lost its underlay.
   */
  async function releaseAfterPatch(replacement: AssetUrlHandle | null = null): Promise<void> {
    const previous = handle
    handle = replacement
    await nextTick()
    previous?.release()
  }

  watch(
    imageRef,
    async (id) => {
      const mine = ++token
      if (id === null) {
        href.value = ''
        size.value = null
        error.value = null
        await releaseAfterPatch()
        return
      }

      const next = await resolveAssetUrl(id)
      if (token !== mine) {
        next.release()
        return
      }

      let measured: ImageSize
      try {
        measured = await loadImageSize(next.url)
      } catch {
        next.release()
        if (token !== mine) return
        href.value = ''
        size.value = null
        error.value = LOAD_ERROR
        await releaseAfterPatch()
        return
      }
      if (token !== mine) {
        next.release()
        return
      }

      href.value = next.url
      size.value = measured
      error.value = null
      await releaseAfterPatch(next)
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    token += 1
    handle?.release()
    handle = null
  })

  return { href, size, error }
}
