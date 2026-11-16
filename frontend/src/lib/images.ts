/**
 * Browser-side image preparation for pupil photographs and administrator
 * signatures. Images are resized/compressed before upload so the server never
 * receives a multi-megabyte camera original, and so the private storage object
 * stays small. The server still validates MIME type, magic bytes and size.
 */

export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

export const MAX_PUPIL_PHOTO_BYTES = 5 * 1024 * 1024
export const MAX_SIGNATURE_BYTES = 1024 * 1024
export const SUPPORTED_IMAGE_TYPES: readonly SupportedImageMime[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
]

export interface PreparedImage {
  base64: string
  mimeType: SupportedImageMime
  originalName: string | null
  /** Local object URL for preview only; revoke with URL.revokeObjectURL. */
  previewUrl: string
  width: number
  height: number
}

export type PreparedPupilPhoto = PreparedImage
export type PreparedSignature = PreparedImage

export type CropFocus = 'top' | 'center' | 'bottom'

const PUPIL_PHOTO_WIDTH = 480
const PUPIL_PHOTO_HEIGHT = 600
const SIGNATURE_MAX_WIDTH = 900
const SIGNATURE_MAX_HEIGHT = 360

export function isSupportedImageMime(
  value: string,
): value is SupportedImageMime {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(value)
}

export function validatePupilPhotoFile(file: File | null): string | null {
  if (!file) {
    return 'Choose a photograph to upload'
  }

  if (!isSupportedImageMime(file.type)) {
    return 'The photograph must be a PNG, JPEG or WebP image'
  }

  if (file.size > MAX_PUPIL_PHOTO_BYTES) {
    return 'The photograph must be 5 MB or smaller'
  }

  return null
}

export function validateSignatureFile(file: File | null): string | null {
  if (!file) {
    return 'Choose a signature image to upload'
  }

  if (!isSupportedImageMime(file.type)) {
    return 'The signature must be a PNG, JPEG or WebP image'
  }

  if (file.size > MAX_SIGNATURE_BYTES) {
    return 'The signature must be 1 MB or smaller'
  }

  return null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000

  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + chunk),
    )
  }

  return btoa(binary)
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: SupportedImageMime,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('The browser could not prepare the image'))
        }
      },
      mimeType,
      quality,
    )
  })
}

async function blobToPrepared(
  blob: Blob,
  mimeType: SupportedImageMime,
  originalName: string | null,
  width: number,
  height: number,
): Promise<PreparedImage> {
  const bytes = new Uint8Array(await blob.arrayBuffer())

  return {
    base64: bytesToBase64(bytes),
    mimeType,
    originalName,
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
  }
}

type DrawableSource =
  | ImageBitmap
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The selected image could not be read'))
    }
    image.src = url
  })
}

async function loadDrawable(source: Blob | File): Promise<DrawableSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source, {
        imageOrientation: 'from-image',
      })
    } catch {
      // Older Safari builds do not support imageOrientation; fall back to an
      // <img> element, which still applies EXIF orientation in current Safari.
    }
  }

  return imageFromBlob(source)
}

function drawableSize(source: DrawableSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth,
      height: source.videoHeight,
    }
  }

  return {
    width: source.width,
    height: source.height,
  }
}

function drawCover(
  context: CanvasRenderingContext2D,
  source: DrawableSource,
  targetWidth: number,
  targetHeight: number,
  zoom: number,
  focus: CropFocus,
): void {
  const { width, height } = drawableSize(source)

  if (width === 0 || height === 0) {
    throw new Error('The selected image has no readable dimensions')
  }

  const scale = Math.max(targetWidth / width, targetHeight / height) * zoom
  const drawWidth = width * scale
  const drawHeight = height * scale
  const excessX = targetWidth - drawWidth
  const excessY = targetHeight - drawHeight
  const focusY = focus === 'top' ? 0 : focus === 'bottom' ? 1 : 0.5

  context.drawImage(
    source,
    excessX / 2,
    excessY * focusY,
    drawWidth,
    drawHeight,
  )
}

/**
 * Crops a camera/upload image to a 4:5 portrait with an optional vertical focus
 * and zoom, then compresses it as JPEG. A white background is painted first so
 * transparent PNGs do not turn black in a JPEG.
 */
export async function preparePupilPhoto(
  source: Blob | File,
  options: {
    focus?: CropFocus
    zoom?: number
    originalName?: string | null
  } = {},
): Promise<PreparedPupilPhoto> {
  const drawable = await loadDrawable(source)
  const canvas = document.createElement('canvas')
  canvas.width = PUPIL_PHOTO_WIDTH
  canvas.height = PUPIL_PHOTO_HEIGHT

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('This browser cannot prepare photographs')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingQuality = 'high'
  drawCover(
    context,
    drawable,
    canvas.width,
    canvas.height,
    Math.max(1, Math.min(2, options.zoom ?? 1)),
    options.focus ?? 'center',
  )

  if (drawable instanceof ImageBitmap) {
    drawable.close()
  }

  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.86)

  return blobToPrepared(
    blob,
    'image/jpeg',
    options.originalName ?? (source instanceof File ? source.name : null),
    canvas.width,
    canvas.height,
  )
}

/** Captures the current video frame as a JPEG blob, ready for cropping. */
export function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = drawableSize(video)

  if (width === 0 || height === 0) {
    return Promise.reject(new Error('The camera is not ready yet'))
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (!context) {
    return Promise.reject(new Error('This browser cannot capture a photo'))
  }

  context.drawImage(video, 0, 0, width, height)

  return canvasToBlob(canvas, 'image/jpeg', 0.9)
}

/**
 * Pads a scanned/drawn signature into a fixed transparent PNG canvas without
 * cropping it. The PDF then scales the whole signature proportionately.
 */
export async function prepareSignature(
  source: Blob | File | HTMLCanvasElement,
  originalName: string | null = null,
): Promise<PreparedSignature> {
  const drawable: DrawableSource =
    source instanceof HTMLCanvasElement ? source : await loadDrawable(source)
  const { width, height } = drawableSize(drawable)

  if (width === 0 || height === 0) {
    throw new Error('The signature has no readable dimensions')
  }

  const scale = Math.min(
    SIGNATURE_MAX_WIDTH / width,
    SIGNATURE_MAX_HEIGHT / height,
  )
  const drawWidth = Math.max(1, Math.round(width * scale))
  const drawHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = SIGNATURE_MAX_WIDTH
  canvas.height = SIGNATURE_MAX_HEIGHT

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('This browser cannot prepare the signature')
  }

  context.imageSmoothingQuality = 'high'
  context.drawImage(
    drawable,
    (SIGNATURE_MAX_WIDTH - drawWidth) / 2,
    (SIGNATURE_MAX_HEIGHT - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )

  if (drawable instanceof ImageBitmap) {
    drawable.close()
  }

  const blob = await canvasToBlob(canvas, 'image/png', 1)

  return blobToPrepared(blob, 'image/png', originalName, canvas.width, canvas.height)
}
