import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { Underlay } from '@/types/plan'
import type { ImageSize } from '@/utils/imageSize'
import { normalizeDegrees, rotatedAboutCenter } from '@/utils/underlay'

export interface UseUnderlayRotationOptions {
  /** The document's underlay, reactive to every mutation. */
  underlay: Readonly<Ref<Underlay | null>>
  /** Natural pixel size of the image; rotation pivots about its centre when known. */
  imageSize: Readonly<Ref<ImageSize | null>>
  /** Receives the rotated underlay; the caller dispatches ONE setUnderlay command. */
  commit: (underlay: Underlay) => void
}

export interface UseUnderlayRotationReturn {
  /** Typed degrees buffer backing the text input; cleared after a successful apply. */
  draft: Ref<string>
  /** True when the last applied draft was not a number. */
  error: Ref<boolean>
  /** Parses the draft and commits the rotation (wired to Enter / blur). */
  apply: () => void
}

/**
 * Draft-input machine for the underlay Rotation field (spec U3), shared by the
 * Inspector and the Layers panel so both entry points behave identically. The
 * typed angle is normalized into (-180, 180] and applied about the image
 * CENTRE so the picture pivots in place; without the natural size the origin
 * is the only anchor available.
 */
export function useUnderlayRotation(
  options: UseUnderlayRotationOptions,
): UseUnderlayRotationReturn {
  const { underlay, imageSize, commit } = options

  const draft = ref('')
  const error = ref(false)

  function apply(): void {
    const current = underlay.value
    if (!current || draft.value.trim() === '') {
      error.value = false
      return
    }
    const parsed = Number.parseFloat(draft.value)
    if (!Number.isFinite(parsed)) {
      error.value = true
      return
    }
    error.value = false
    draft.value = ''
    const degrees = normalizeDegrees(parsed)
    const transform = imageSize.value
      ? rotatedAboutCenter(current.transform, imageSize.value, degrees)
      : { ...current.transform, rotation_deg: degrees }
    commit({ ...current, transform })
  }

  watch(
    () => underlay.value?.image_ref,
    () => {
      draft.value = ''
      error.value = false
    },
  )

  return { draft, error, apply }
}
