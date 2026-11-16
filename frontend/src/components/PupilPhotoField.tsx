import {
  Camera,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { apiAssetUrl } from '../lib/api'
import {
  captureVideoFrame,
  preparePupilPhoto,
  validatePupilPhotoFile,
  type CropFocus,
  type PreparedPupilPhoto,
} from '../lib/images'
import { Button } from './ui'

interface PupilPhotoFieldProps {
  pupilName: string
  /** Saved, privately streamed photograph URL. */
  currentUrl: string | null
  /** A prepared photograph waiting to be saved with the pupil. */
  pending: PreparedPupilPhoto | null
  onChange: (photo: PreparedPupilPhoto | null) => void
  /** Removes the saved photograph through the API. */
  onRemoveSaved: () => void
  disabled?: boolean
}

const FOCUS_OPTIONS: Array<{ value: CropFocus; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Centre' },
  { value: 'bottom', label: 'Bottom' },
]

export default function PupilPhotoField({
  pupilName,
  currentUrl,
  pending,
  onChange,
  onRemoveSaved,
  disabled = false,
}: PupilPhotoFieldProps) {
  const [raw, setRaw] = useState<{
    blob: Blob
    previewUrl: string
    originalName: string | null
  } | null>(null)
  const [focus, setFocus] = useState<CropFocus>('center')
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    return () => {
      if (raw) {
        URL.revokeObjectURL(raw.previewUrl)
      }
    }
  }, [raw])

  useEffect(() => {
    if (!cameraOpen) {
      return
    }

    let cancelled = false

    async function start() {
      setCameraError(null)
      setCameraReady(false)

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser does not expose a camera to web pages.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
          setCameraReady(true)
        }
      } catch {
        setCameraError(
          'Camera access was not available. Allow camera permission or upload a photograph instead.',
        )
      }
    }

    void start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [cameraOpen])

  function resetRaw() {
    if (raw) {
      URL.revokeObjectURL(raw.previewUrl)
    }
    setRaw(null)
    setFocus('center')
    setZoom(1)
    setError(null)
  }

  function chooseFile(file: File | null) {
    if (!file) return

    const validation = validatePupilPhotoFile(file)

    if (validation) {
      setError(validation)
      return
    }

    resetRaw()
    setRaw({
      blob: file,
      previewUrl: URL.createObjectURL(file),
      originalName: file.name,
    })
  }

  async function captureFrame() {
    if (!videoRef.current) return

    try {
      const blob = await captureVideoFrame(videoRef.current)
      resetRaw()
      setRaw({
        blob,
        previewUrl: URL.createObjectURL(blob),
        originalName: 'camera-photo.jpg',
      })
      setCameraOpen(false)
    } catch (cause) {
      setCameraError(
        cause instanceof Error ? cause.message : 'Could not capture a photo.',
      )
    }
  }

  async function applyCapturedPhoto() {
    if (!raw) return

    setPreparing(true)
    setError(null)

    try {
      const prepared = await preparePupilPhoto(raw.blob, {
        focus,
        zoom,
        originalName: raw.originalName,
      })
      onChange(prepared)
      resetRaw()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not prepare the photograph.',
      )
    } finally {
      setPreparing(false)
    }
  }

  const hasSavedPhoto = Boolean(currentUrl)
  const savedPhotoUrl = currentUrl ? apiAssetUrl(currentUrl) : null
  const previewUrl = raw?.previewUrl ?? pending?.previewUrl ?? savedPhotoUrl
  const objectPosition =
    focus === 'top' ? '50% 0%' : focus === 'bottom' ? '50% 100%' : '50% 50%'

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-gradely-text">
            Profile photograph
          </h3>
          <p className="mt-1 text-xs text-gradely-muted">
            Printed at the top-right of the terminal report. PNG, JPEG or WebP;
            the image is cropped to a portrait and compressed in your browser.
          </p>
        </div>
        <span className="rounded-full bg-gradely-light px-2.5 py-1 text-[11px] font-semibold text-gradely-muted">
          Private
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        <div className="relative w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-gradely-light">
          <div className="aspect-[4/5] w-full">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Photograph of ${pupilName || 'pupil'}`}
                crossOrigin={previewUrl === savedPhotoUrl ? 'use-credentials' : undefined}
                className="h-full w-full object-cover"
                style={
                  raw
                    ? {
                        objectPosition,
                        transform: `scale(${zoom})`,
                        transformOrigin: objectPosition,
                      }
                    : undefined
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <UserRound
                  aria-hidden="true"
                  className="size-9 text-gradely-muted"
                />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {cameraOpen ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-900">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
              {cameraError ? (
                <p role="alert" className="text-xs font-medium text-red-700">
                  {cameraError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!cameraReady}
                  onClick={() => void captureFrame()}
                >
                  <Camera aria-hidden="true" className="size-4" />
                  Capture photo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCameraOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : raw ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gradely-text">
                  Vertical framing
                  <select
                    value={focus}
                    onChange={(event) =>
                      setFocus(event.target.value as CropFocus)
                    }
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
                  >
                    {FOCUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-gradely-text">
                  Zoom {zoom.toFixed(1)}×
                  <input
                    type="range"
                    min={1}
                    max={2}
                    step={0.1}
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                    className="mt-3 w-full accent-gradely-blue"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={preparing}
                  onClick={() => void applyCapturedPhoto()}
                >
                  {preparing ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  ) : null}
                  Use photo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={resetRaw}
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Retake
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <label
                  htmlFor="pupilPhotoFile"
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-gradely-text hover:bg-gradely-light"
                >
                  <ImagePlus aria-hidden="true" className="size-4" />
                  {pending || hasSavedPhoto ? 'Replace photo' : 'Choose photo'}
                </label>
                <input
                  id="pupilPhotoFile"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={disabled}
                  onChange={(event) => {
                    chooseFile(event.target.files?.[0] ?? null)
                    event.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    setError(null)
                    setCameraOpen(true)
                  }}
                >
                  <Camera aria-hidden="true" className="size-4" />
                  Take photo
                </Button>
                {pending ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChange(null)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    Discard
                  </Button>
                ) : hasSavedPhoto ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={onRemoveSaved}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-gradely-muted">
                {pending
                  ? 'Ready to save. The photograph will be stored privately with this pupil record.'
                  : hasSavedPhoto
                    ? 'A photograph is saved. Reports generated from now on use the new image; historical reports keep the version they were released with.'
                    : 'No photograph yet. A neutral frame is printed on reports when this is left blank.'}
              </p>
            </div>
          )}

          {error ? (
            <p role="alert" className="mt-2 text-xs font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
