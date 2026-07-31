import { ref } from 'vue'
import type { Ref } from 'vue'

import { uploadAsset } from '@/persistence/assets'
import { assetUrl } from '@/persistence/rest/restAssetsAdapter'
import { useEditorStore } from '@/stores/editor'
import { loadImageSize } from '@/utils/imageSize'
import { DEFAULT_UNDERLAY_OPACITY, initialUnderlayTransform } from '@/utils/underlay'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png']

export interface UseUnderlayImportReturn {
  /** True while the image is uploading and being installed. */
  uploading: Ref<boolean>
  /** User-facing failure message of the last import attempt, else null. */
  error: Ref<string | null>
  /** Uploads `file` and installs it as the plan's underlay (spec U1). */
  importFile: (file: File) => Promise<void>
}

/**
 * The underlay import flow (spec U1), shared by the underlay panel and the
 * empty-state hint: validates the file type, uploads it as an asset, measures
 * it and installs it as the plan's underlay centred on the current viewport.
 */
export function useUnderlayImport(): UseUnderlayImportReturn {
  const editorStore = useEditorStore()

  const uploading = ref(false)
  const error = ref<string | null>(null)

  async function importFile(file: File): Promise<void> {
    error.value = null
    if (!ACCEPTED_TYPES.includes(file.type)) {
      error.value = 'Only JPEG and PNG images are supported.'
      return
    }
    uploading.value = true
    try {
      const asset = await uploadAsset(file)
      const size = await loadImageSize(assetUrl(asset.id))
      const centre = editorStore.document?.viewport.center ?? { x: 0, y: 0 }
      editorStore.mutate({
        type: 'setUnderlay',
        underlay: {
          image_ref: asset.id,
          transform: initialUnderlayTransform(size, centre),
          opacity: DEFAULT_UNDERLAY_OPACITY,
          locked: false,
          visible: true,
        },
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Upload failed'
    } finally {
      uploading.value = false
    }
  }

  return { uploading, error, importFile }
}
