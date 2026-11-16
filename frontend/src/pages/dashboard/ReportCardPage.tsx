import {
  ArrowLeft,
  Download,
  Eye,
  FileText,
  Printer,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import {
  fetchReportPreview,
  fetchStoredReportPdf,
  getReportCard,
} from '../../reports/api'
import { ReleaseStatusNotice } from '../../reports/components'
import { formatBytes } from '../../reports/files'
import {
  RELEASE_STATUS_SHORT_LABELS,
  releaseTone,
} from '../../reports/labels'
import { releaseAllowsPreview } from '../../reports/release-logic'
import type { ReportCardDetail } from '../../reports/types'
import { formatDate, formatDateTime } from '../../lib/format'
import { useSchool } from '../../schools/use-school'

export default function ReportCardPage() {
  const { schoolId } = useSchool()
  const { cardId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedVersion = Number(searchParams.get('version') ?? '')

  const [detail, setDetail] = useState<ReportCardDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<number | null>(null)
  const [printing, setPrinting] = useState<number | null>(null)

  const selectedVersion =
    Number.isInteger(requestedVersion) && requestedVersion > 0
      ? requestedVersion
      : (detail?.card.currentVersion ?? null)
  const selectedRecord =
    detail?.versions.find(
      (version) => version.version === selectedVersion,
    ) ?? null
  const selectedReleased = releaseAllowsPreview(selectedRecord?.releaseStatus)

  const loadCard = useCallback(async () => {
    if (!schoolId || !cardId) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const response = await getReportCard(schoolId, cardId)
      setDetail(response)
      setError(null)
    } catch (cause) {
      setDetail(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load this report card.',
      )
    } finally {
      setLoading(false)
    }
  }, [cardId, schoolId])

  const loadPreview = useCallback(async () => {
    if (
      !schoolId ||
      !cardId ||
      selectedVersion === null ||
      !releaseAllowsPreview(selectedRecord?.releaseStatus)
    ) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      setPreviewUrl(null)
      setPreviewError(null)
      return
    }

    try {
      setPreviewLoading(true)
      setPreviewError(null)
      const blob = await fetchReportPreview(
        schoolId,
        cardId,
        selectedVersion,
      )
      const url = URL.createObjectURL(blob)

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }

      previewUrlRef.current = url
      setPreviewUrl(url)
    } catch (cause) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      setPreviewUrl(null)
      setPreviewError(
        cause instanceof Error
          ? cause.message
          : 'Could not render the report preview.',
      )
    } finally {
      setPreviewLoading(false)
    }
  }, [cardId, schoolId, selectedRecord, selectedVersion])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCard()
  }, [loadCard])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPreview()
  }, [loadPreview])

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    },
    [],
  )

  async function downloadVersion(version: number) {
    if (!schoolId || !cardId) return

    const record = detail?.versions.find((item) => item.version === version)

    if (!releaseAllowsPreview(record?.releaseStatus)) {
      setPreviewError(
        'This report has not been released by the platform administrator.',
      )
      return
    }

    try {
      setDownloading(version)
      setPreviewError(null)
      const blob = await fetchStoredReportPdf(schoolId, cardId, version)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${detail?.card.admissionNumber ?? 'report'}-v${version}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setPreviewError(
        cause instanceof Error
          ? cause.message
          : 'Could not download the stored report PDF.',
      )
    } finally {
      setDownloading(null)
    }
  }

  async function printVersion(version: number) {
    if (!schoolId || !cardId) return

    const record = detail?.versions.find((item) => item.version === version)

    if (!releaseAllowsPreview(record?.releaseStatus)) {
      setPreviewError(
        'This report has not been released by the platform administrator.',
      )
      return
    }

    try {
      setPrinting(version)
      setPreviewError(null)
      const blob = await fetchStoredReportPdf(schoolId, cardId, version)
      const url = URL.createObjectURL(blob)
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)

      if (!opened) {
        setPreviewError('Allow pop-ups to open the report for printing.')
      }
    } catch (cause) {
      setPreviewError(
        cause instanceof Error
          ? cause.message
          : 'Could not open the stored report PDF for printing.',
      )
    } finally {
      setPrinting(null)
    }
  }

  if (loading) {
    return <LoadingPanel label="Loading report card…" />
  }

  if (error || !detail) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report card preview" />
        <ErrorNotice
          message={error ?? 'Report card not found.'}
          onRetry={() => void loadCard()}
        />
        <Link
          to="/dashboard/reports"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gradely-navy hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to report cards
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report card preview"
        description="A private, server-authorized preview. The backend only streams PDF bytes after a platform super administrator releases the batch; no public pupil, parent or permanent storage URL exists."
        actions={
          <>
            <Link
              to="/dashboard/reports"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-gradely-text shadow-sm transition-colors hover:bg-gradely-light"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              All reports
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadCard()}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={printing === selectedVersion}
              disabled={selectedVersion === null || !selectedReleased}
              onClick={() =>
                selectedVersion !== null
                  ? void printVersion(selectedVersion)
                  : undefined
              }
            >
              <Printer aria-hidden="true" className="size-4" />
              Print
            </Button>
            <Button
              size="sm"
              loading={downloading === selectedVersion}
              disabled={selectedVersion === null || !selectedReleased}
              onClick={() =>
                selectedVersion !== null
                  ? void downloadVersion(selectedVersion)
                  : undefined
              }
            >
              <Download aria-hidden="true" className="size-4" />
              Download released PDF
            </Button>
          </>
        }
      />

      <ReleaseStatusNotice
        status={selectedRecord?.releaseStatus}
        description={
          selectedRecord
            ? undefined
            : 'No report version is selected. Generate a report before requesting release.'
        }
      />

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-gradely-text">
              {detail.card.pupilName}
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              {detail.card.admissionNumber} · {detail.card.className} ·{' '}
              {detail.versions.length} saved version
              {detail.versions.length === 1 ? '' : 's'}
            </p>
            {detail.input ? (
              <p className="mt-1 text-xs text-gradely-muted">
                Attendance {detail.input.daysAttended ?? 'N/A'} /{' '}
                {detail.input.daysOpened ?? 'N/A'} · Closing{' '}
                {formatDate(detail.input.closingDate)} · Reopening{' '}
                {formatDate(detail.input.reopeningDate)}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gradely-muted">
                No authorized report input is currently stored.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">
              <ShieldCheck aria-hidden="true" className="mr-1 size-3.5" />
              Private preview
            </Badge>
            {selectedRecord?.releaseStatus ? (
              <Badge tone={releaseTone(selectedRecord.releaseStatus)}>
                {RELEASE_STATUS_SHORT_LABELS[selectedRecord.releaseStatus]}
              </Badge>
            ) : null}
            <Badge tone="neutral">Current v{detail.card.currentVersion}</Badge>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="p-0 sm:p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <div className="flex items-center gap-2">
              <FileText
                aria-hidden="true"
                className="size-4 text-gradely-muted"
              />
              <span className="text-sm font-bold text-gradely-text">
                {selectedVersion === null
                  ? 'No version'
                  : `Version ${selectedVersion}`}
              </span>
              {selectedRecord ? (
                <span className="text-xs text-gradely-muted">
                  {selectedRecord.pageCount} page
                  {selectedRecord.pageCount === 1 ? '' : 's'} ·{' '}
                  {formatBytes(selectedRecord.byteSize)}
                </span>
              ) : null}
            </div>
            {previewLoading ? (
              <span className="text-xs font-semibold text-gradely-muted">
                Rendering preview…
              </span>
            ) : null}
          </div>

          {!selectedRecord ? (
            <div className="p-5">
              <p className="text-sm text-gradely-muted">
                No PDF preview is available for this version.
              </p>
            </div>
          ) : !selectedReleased ? (
            <div className="p-5">
              <div className="rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-4">
                <p className="text-sm font-bold text-[#6b4a00]">
                  Preview locked until platform release
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[#7a5400]">
                  This version is still private. The backend will not return
                  PDF bytes until a platform super administrator explicitly
                  releases the batch. Paid billing and approval alone do not
                  unlock it.
                </p>
              </div>
            </div>
          ) : previewError ? (
            <div className="p-5">
              <ErrorNotice
                message={previewError}
                onRetry={() => void loadPreview()}
              />
            </div>
          ) : previewLoading && !previewUrl ? (
            <div className="p-5">
              <LoadingPanel label="Rendering private PDF preview…" />
            </div>
          ) : previewUrl ? (
            <iframe
              key={previewUrl}
              title={`Report card preview for ${detail.card.pupilName}`}
              src={previewUrl}
              className="h-[78vh] min-h-[620px] w-full rounded-b-2xl border-0 bg-slate-100"
            />
          ) : (
            <div className="p-5">
              <p className="text-sm text-gradely-muted">
                No PDF preview is available for this version.
              </p>
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="text-base font-bold text-gradely-text">
            Immutable versions
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
            Each generation creates an immutable version with a stored
            checksum. A version can only be previewed or downloaded after its
            batch is explicitly released; the backend then verifies the stored
            checksum before streaming private bytes.
          </p>

          <div className="mt-4 space-y-2">
            {detail.versions.map((version) => {
              const selected = version.version === selectedVersion
              const versionReleased = releaseAllowsPreview(
                version.releaseStatus,
              )

              return (
                <div
                  key={version.id}
                  className={`rounded-xl border p-3 ${
                    selected
                      ? 'border-gradely-navy bg-gradely-navy/5'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-gradely-text">
                        Version {version.version}
                      </p>
                      <p className="mt-0.5 text-xs text-gradely-muted">
                        {formatDateTime(version.generatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={selected ? 'info' : 'neutral'}>
                        {version.pageCount}p
                      </Badge>
                      {version.releaseStatus ? (
                        <Badge tone={releaseTone(version.releaseStatus)}>
                          {RELEASE_STATUS_SHORT_LABELS[version.releaseStatus]}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-gradely-muted">
                    {version.checksum.slice(0, 24)}…
                  </p>
                  <p className="mt-1 text-xs text-gradely-muted">
                    {version.generatedByName ?? 'Unknown staff member'} ·{' '}
                    {formatBytes(version.byteSize)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!versionReleased}
                      onClick={() =>
                        setSearchParams({ version: String(version.version) })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-gradely-text hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Eye aria-hidden="true" className="size-3.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      disabled={
                        !versionReleased || downloading === version.version
                      }
                      onClick={() => void downloadVersion(version.version)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-gradely-text hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download aria-hidden="true" className="size-3.5" />
                      Released PDF
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </div>
  )
}
