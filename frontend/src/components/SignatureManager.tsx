import {
  Eraser,
  ImagePlus,
  Loader2,
  PenLine,
  Save,
  Trash2,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ApiError, apiAssetUrl } from '../lib/api'
import {
  prepareSignature,
  validateSignatureFile,
  type PreparedSignature,
} from '../lib/images'
import {
  removeSchoolSignature,
  updateSchoolSignatureDetails,
  uploadSchoolSignature,
} from '../schools/api'
import type { SchoolSignature } from '../schools/types'
import FormField from './FormField'
import { Button, ConfirmDialog } from './ui'

interface SignatureManagerProps {
  schoolId: string
  signature: SchoolSignature
  onChanged: (signature: SchoolSignature) => void
}

const DRAW_WIDTH = 900
const DRAW_HEIGHT = 300

export default function SignatureManager({
  schoolId,
  signature,
  onChanged,
}: SignatureManagerProps) {
  const [name, setName] = useState(signature.name ?? '')
  const [designation, setDesignation] = useState(signature.designation ?? '')
  const [pending, setPending] = useState<PreparedSignature | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [drawingOpen, setDrawingOpen] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    // The saved signature is the source of truth after an upload/removal.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(signature.name ?? '')
    setDesignation(signature.designation ?? '')
  }, [signature.name, signature.designation, signature.updatedAt])

  useEffect(() => {
    return () => {
      if (pending) {
        URL.revokeObjectURL(pending.previewUrl)
      }
    }
  }, [pending])

  function replacePending(next: PreparedSignature | null) {
    setPending((current) => {
      if (current) {
        URL.revokeObjectURL(current.previewUrl)
      }
      return next
    })
  }

  async function chooseFile(file: File | null) {
    if (!file) return

    const validation = validateSignatureFile(file)

    if (validation) {
      setError(validation)
      return
    }

    try {
      const prepared = await prepareSignature(file, file.name)
      replacePending(prepared)
      setFileName(file.name)
      setError(null)
      setSuccess(null)
      setDrawingOpen(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not prepare the signature image.',
      )
    }
  }

  function canvasPoint(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function startStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) return

    setDrawing(true)
    lastPoint.current = canvasPoint(event)
    context.beginPath()
    context.moveTo(lastPoint.current.x, lastPoint.current.y)
  }

  function continueStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing) return

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const point = canvasPoint(event)

    if (!context || !lastPoint.current) return

    context.lineTo(point.x, point.y)
    context.stroke()
    lastPoint.current = point
  }

  function endStroke() {
    setDrawing(false)
    lastPoint.current = null
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) return

    context.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function applyDrawing() {
    const canvas = canvasRef.current

    if (!canvas) return

    try {
      const prepared = await prepareSignature(canvas, 'drawn-signature.png')
      replacePending(prepared)
      setFileName('Drawn signature')
      setDrawingOpen(false)
      setError(null)
      setSuccess(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not prepare the drawn signature.',
      )
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const response = pending
        ? await uploadSchoolSignature(
            schoolId,
            {
              mimeType: pending.mimeType,
              base64: pending.base64,
              originalName: pending.originalName,
            },
            {
              name: name.trim() === '' ? null : name.trim(),
              designation:
                designation.trim() === '' ? null : designation.trim(),
            },
          )
        : await updateSchoolSignatureDetails(schoolId, {
            name: name.trim() === '' ? null : name.trim(),
            designation:
              designation.trim() === '' ? null : designation.trim(),
          })

      onChanged(response.signature)
      replacePending(null)
      setFileName(null)
      setSuccess(
        pending
          ? 'Signature saved. New reports use it; historical reports keep their snapshotted signature.'
          : 'Printed name and designation saved.',
      )
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not save the signature.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await removeSchoolSignature(schoolId)
      onChanged(response.signature)
      replacePending(null)
      setFileName(null)
      setName('')
      setDesignation('')
      setRemoveOpen(false)
      setSuccess('Signature removed. New reports print a blank signature area.')
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not remove the signature.',
      )
    } finally {
      setBusy(false)
    }
  }

  const hasSignature = signature.hasSignature && signature.url
  const previewUrl = pending?.previewUrl ?? (hasSignature ? apiAssetUrl(signature.url!) : null)

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-gradely-text">
          School administrator signature
        </h2>
        <p className="mt-1 text-sm text-gradely-muted">
          Upload a scan or draw your signature. It is stored privately and
          printed above your name on terminal reports. Leave it blank to print a
          signature line without an image.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-gradely-light sm:w-64">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Current administrator signature"
              crossOrigin={
                previewUrl === apiAssetUrl(signature.url ?? '')
                  ? 'use-credentials'
                  : undefined
              }
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="px-4 text-center text-xs text-gradely-muted">
              No signature uploaded
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor="signatureFile"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-gradely-text hover:bg-gradely-light"
            >
              <ImagePlus aria-hidden="true" className="size-4" />
              {hasSignature ? 'Replace signature' : 'Upload signature'}
            </label>
            <input
              id="signatureFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                void chooseFile(event.target.files?.[0] ?? null)
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setDrawingOpen((current) => !current)
                setError(null)
                setSuccess(null)
              }}
            >
              <PenLine aria-hidden="true" className="size-4" />
              {drawingOpen ? 'Close draw pad' : 'Draw signature'}
            </Button>
            {hasSignature && !pending ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRemoveOpen(true)}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Remove
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-gradely-muted">
            {pending
              ? `${fileName ?? 'Selected image'} is ready. PNG, JPEG or WebP up to 1 MB before compression.`
              : 'A transparent PNG works best. Uploads are compressed in the browser.'}
          </p>
        </div>
      </div>

      {drawingOpen ? (
        <div className="space-y-3 rounded-xl border border-slate-300 bg-white p-3">
          <canvas
            ref={canvasRef}
            width={DRAW_WIDTH}
            height={DRAW_HEIGHT}
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            className="h-40 w-full touch-none rounded-lg border border-slate-200 bg-white"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void applyDrawing()}>
              Use drawing
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={clearCanvas}
            >
              <Eraser aria-hidden="true" className="size-4" />
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Printed name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder="e.g. Grace Mensah"
          hint="Printed beneath the signature line."
        />
        <FormField
          label="Designation"
          value={designation}
          onChange={(event) => setDesignation(event.target.value)}
          maxLength={80}
          placeholder="e.g. Headmistress"
          hint="Printed beneath the name, e.g. Headmaster, Headmistress or Principal."
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm font-medium text-[#137026]">
          {success}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" loading={busy} onClick={() => void save()}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
          Save signature details
        </Button>
      </div>

      <ConfirmDialog
        open={removeOpen}
        title="Remove signature?"
        description="New reports will print a blank signature area. Historical reports keep the signature they were generated with."
        confirmLabel="Remove signature"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoveOpen(false)}
      />
    </section>
  )
}
