import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Scale,
  SearchX,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
  TextareaField,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { formatMoney } from '../../platform/format'
import {
  acknowledgePlatformPayment,
  getPlatformReconciliation,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'
import type {
  ReconciliationIssue,
  ReconciliationIssueCode,
  ReconciliationPage,
  ReconciliationSeverity,
} from '../../platform/types'
import { StatCard } from '../../platform/components'

const CODE_LABELS: Record<ReconciliationIssueCode, string> = {
  MISMATCHED_REFERENCE: 'Mismatched reference',
  DUPLICATE_PROVIDER_REFERENCE: 'Duplicate provider reference',
  REPEATED_SUBMISSION: 'Repeated submission',
  FAILED_VERIFICATION: 'Failed verification',
  INCONSISTENT_AMOUNT: 'Inconsistent amount',
  OVERPAYMENT: 'Overpayment',
  UNRECONCILED_PAYMENT: 'Unreconciled payment',
  WRONG_SCHOOL: 'Wrong school',
  WRONG_TERM: 'Wrong term',
}

function severityTone(
  severity: ReconciliationSeverity,
): 'success' | 'warning' | 'info' {
  if (severity === 'CRITICAL') return 'warning'
  if (severity === 'WARNING') return 'warning'
  return 'info'
}

export default function PlatformReconciliationPage() {
  const { ensureReauth } = usePlatformReauth()
  const [page, setPage] = useState<ReconciliationPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [severity, setSeverity] = useState('')
  const [code, setCode] = useState('')
  const [target, setTarget] = useState<ReconciliationIssue | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setPage(
        await getPlatformReconciliation({
          severity: severity || undefined,
          code: code || undefined,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load payment reconciliation.',
      )
    } finally {
      setLoading(false)
    }
  }, [severity, code])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function acknowledge() {
    if (!target) return

    setBusy(true)
    setError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.reconciliation,
      'Acknowledging a payment records a manual reconciliation decision. Confirm your identity to continue.',
    )

    if (!token) {
      setBusy(false)
      return
    }

    try {
      await acknowledgePlatformPayment(
        target.paymentId,
        note.trim() || null,
        token,
      )
      setTarget(null)
      setNote('')
      await load()
      setNotice('Payment acknowledged. The manual action was audited.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not acknowledge the payment.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment reconciliation"
        description="Detect mismatched references, duplicate or repeated submissions, failed verifications, inconsistent amounts, unreconciled payments and wrong school or term assignments. Historical per-pupil pricing is preserved; acknowledging a payment records an audited manual decision."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Re-run checks
          </Button>
        }
      />

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

      {page ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Payments reviewed"
            value={page.summary.totalPayments}
            hint={`${page.summary.verifiedPayments} verified`}
            icon={<Scale aria-hidden="true" className="size-5" />}
          />
          <StatCard
            label="Open issues"
            value={page.summary.totalIssues}
            tone={page.summary.totalIssues > 0 ? 'warning' : 'success'}
            hint={`${page.summary.criticalIssues} critical · ${page.summary.warningIssues} warning`}
            icon={<AlertTriangle aria-hidden="true" className="size-5" />}
          />
          <StatCard
            label="Unreconciled verified"
            value={page.summary.unreconciledVerified}
            tone={
              page.summary.unreconciledVerified > 0 ? 'warning' : 'success'
            }
            hint="Verified payments without an acknowledgement"
          />
          <StatCard
            label="Generated"
            value={formatDateTime(page.generatedAt)}
            hint="Read-only detection; no records are modified"
          />
        </div>
      ) : null}

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">Any severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </SelectField>
          <SelectField
            label="Issue type"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          >
            <option value="">Any issue type</option>
            {Object.entries(CODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
      </Panel>

      {loading && !page ? (
        <LoadingPanel label="Running reconciliation checks…" />
      ) : null}

      {page && page.issues.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No reconciliation issues"
          description="No mismatched, duplicate or unreconciled payments were detected in the reviewed window."
        />
      ) : null}

      {page && page.issues.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-gradely-light text-xs uppercase tracking-wide text-gradely-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Issue</th>
                <th className="px-4 py-3 font-semibold">School / invoice</th>
                <th className="px-4 py-3 font-semibold">Payment</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Detail</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {page.issues.map((issue) => (
                <tr key={`${issue.code}-${issue.paymentId}`}>
                  <td className="px-4 py-3">
                    <Badge tone={severityTone(issue.severity)}>
                      {CODE_LABELS[issue.code]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gradely-text">
                      {issue.schoolName}
                    </p>
                    <p className="text-xs text-gradely-muted">
                      {issue.invoiceNumber}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-gradely-text">
                      {issue.paymentReference}
                    </p>
                    <p className="text-xs text-gradely-muted">
                      {issue.status} · {issue.source} · {issue.method}
                    </p>
                    <p className="text-xs text-gradely-muted">
                      {formatDateTime(issue.submittedAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-semibold text-gradely-text">
                      {formatMoney(issue.amountMinor, issue.currency)}
                    </p>
                    <p className="text-gradely-muted">
                      Applied {formatMoney(issue.appliedMinor, issue.currency)}
                    </p>
                    {issue.overpaymentMinor > 0 ? (
                      <p className="text-gradely-muted">
                        Over {formatMoney(issue.overpaymentMinor, issue.currency)}
                      </p>
                    ) : null}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-xs text-gradely-muted">
                    {issue.detail}
                    {issue.reconciledAt ? (
                      <p className="mt-1 text-[#137026]">
                        Acknowledged {formatDateTime(issue.reconciledAt)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={issue.reconciledAt !== null}
                      onClick={() => {
                        setTarget(issue)
                        setNote('')
                      }}
                    >
                      Acknowledge
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        title="Acknowledge this payment?"
        description="This records a manual reconciliation decision for the selected payment. It does not change the payment amount, invoice balance or per-pupil pricing, and it is audited with your account."
        confirmLabel="Acknowledge payment"
        busy={busy}
        onConfirm={() => void acknowledge()}
        onCancel={() => {
          if (!busy) setTarget(null)
        }}
      />

      {target ? (
        <Panel>
          <TextareaField
            label="Reconciliation note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            hint="Record why this issue is considered resolved."
          />
          <div className="mt-3 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setTarget(null)
                setNote('')
              }}
              disabled={busy}
            >
              Clear selection
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
