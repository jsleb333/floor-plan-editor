/** Intrinsic pixel dimensions of a raster image. */
export interface ImageSize {
  width: number
  height: number
}

/** Loads an image off-DOM and resolves its natural pixel size, rejecting on load failure. */
export function loadImageSize(url: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Failed to load the underlay image'))
    image.src = url
  })
}

/** Natural pixel size of a local file, measured through a temporary object URL. */
export async function measureImageFile(file: File): Promise<ImageSize> {
  const url = URL.createObjectURL(file)
  try {
    return await loadImageSize(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
