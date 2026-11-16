import {
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
} from '../../components/ui'
import {
  downloadPlatformExport,
  listPlatformExportDatasets,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'
import type { ExportDatasetDefinition } from '../../platform/types'

export default function PlatformExportsPage() {
  const { ensureReauth } = usePlatformReauth()
  const [datasets, setDatasets] = useState<ExportDatasetDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await listPlatformExportDatasets()
      setDatasets(result.datasets)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load export datasets.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function download(dataset: ExportDatasetDefinition) {
    setBusy(dataset.id)
    setError(null)
    setNotice(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.export,
      'Exports contain tenant and financial records. Confirm your identity to download this file.',
    )

    if (!token) {
      setBusy(null)
      return
    }

    try {
      const file = await downloadPlatformExport(dataset.id, token)
      const url = URL.createObjectURL(file.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download =
        file.fileName ?? `wise-grade-${dataset.id}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setNotice(`${dataset.label} export downloaded. The access was audited.`)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not download the export.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data exports"
        description="On-demand, privacy-minimized CSV extracts generated on the server. Files are never stored, every download is audited, and passwords, MFA secrets, storage keys and payment evidence are excluded."
      />

      <Panel>
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-gradely-light p-2 text-gradely-blue">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-bold text-gradely-text">
              Access control
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
              Only an authenticated platform administrator can download an
              export, and each download requires a fresh identity confirmation.
              Spreadsheet formula injection is neutralized. This is not a backup
              and restore mechanism.
            </p>
          </div>
        </div>
      </Panel>

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm text-[#137026]"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {notice}
        </div>
      ) : null}
      {loading && datasets.length === 0 ? (
        <LoadingPanel label="Loading export datasets…" />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {datasets.map((dataset) => (
          <Panel key={dataset.id}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                <FileSpreadsheet
                  aria-hidden="true"
                  className="size-5 text-gradely-blue"
                />
                {dataset.label}
              </h2>
              <Badge tone="info">CSV</Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-gradely-muted">
              {dataset.description}
            </p>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-gradely-muted">
              <Database aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Columns: {dataset.columns.join(', ')}
            </p>
            <div className="mt-4 flex justify-end">
              <Button
                variant="secondary"
                loading={busy === dataset.id}
                onClick={() => void download(dataset)}
              >
                <Download aria-hidden="true" className="size-4" />
                Download CSV
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
