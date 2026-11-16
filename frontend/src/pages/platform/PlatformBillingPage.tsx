import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  History,
  Paperclip,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tag,
  Wallet,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextareaField,
} from '../../components/ui'
import {
  cancelInvoice,
  createInvoice,
  createPricingRule,
  fetchPlatformPaymentEvidence,
  getPlatformInvoice,
  issueInvoice,
  listBillingAudit,
  listBillingSchools,
  listPendingPayments,
  listPlatformInvoices,
  listPricingRules,
  listVerifiedPayments,
  setPricingRuleActive,
  verifyPayment,
} from '../../billing/api'
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatMoneyMinor,
  invoiceStatusTone,
  paymentStatusTone,
  toMinorUnits,
} from '../../billing/format'
import type {
  BillingAuditRecord,
  BillingSchoolScope,
  InvoiceDetail,
  InvoiceRecord,
  InvoiceStatus,
  PaymentDetail,
  PricingRule,
} from '../../billing/types'
import { formatDate, formatDateTime, todayInputValue } from '../../lib/format'
import { usePlatformReauth } from '../../platform/reauth-context'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'

type Tab = 'overview' | 'pricing' | 'invoices' | 'payments' | 'audit'

const TABS: { id: Tab; label: string; icon: typeof Wallet }[] = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'pricing', label: 'Pricing', icon: Tag },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'audit', label: 'Audit history', icon: History },
]

function parseSignedMinor(value: string): number | null {
  const trimmed = value.trim()

  if (trimmed === '') return 0

  const negative = trimmed.startsWith('-')
  const absolute = toMinorUnits(negative ? trimmed.slice(1) : trimmed)

  if (absolute === null) return null

  return negative ? -absolute : absolute
}

function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string
  value: string
  icon: typeof Wallet
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
            {label}
          </p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-gradely-navy">
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-gradely-muted">{hint}</p> : null}
        </div>
        <span className="rounded-xl bg-gradely-blue/10 p-2.5">
          <Icon aria-hidden="true" className="size-5 text-gradely-blue" />
        </span>
      </div>
    </div>
  )
}

export default function PlatformBillingPage() {
  const { ensureReauth } = usePlatformReauth()
  const [tab, setTab] = useState<Tab>('overview')
  const [schools, setSchools] = useState<BillingSchoolScope[]>([])
  const [rules, setRules] = useState<PricingRule[]>([])
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [pending, setPending] = useState<PaymentDetail[]>([])
  const [verified, setVerified] = useState<PaymentDetail[]>([])
  const [audit, setAudit] = useState<BillingAuditRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [pricingAmount, setPricingAmount] = useState('')
  const [pricingFrom, setPricingFrom] = useState(todayInputValue())
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingError, setPricingError] = useState<string | null>(null)

  const [invoiceSchoolId, setInvoiceSchoolId] = useState('')
  const [invoiceYearId, setInvoiceYearId] = useState('')
  const [invoiceTermId, setInvoiceTermId] = useState('')
  const [invoiceIssueDate, setInvoiceIssueDate] = useState(todayInputValue())
  const [invoiceDueDate, setInvoiceDueDate] = useState('')
  const [adjustment, setAdjustment] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('')
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  const [confirmAction, setConfirmAction] = useState<{
    invoiceId: string
    action: 'issue' | 'cancel'
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const [decisionPayment, setDecisionPayment] =
    useState<PaymentDetail | null>(null)
  const [decision, setDecision] = useState<'VERIFIED' | 'REJECTED'>('VERIFIED')
  const [decisionReason, setDecisionReason] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const [
        schoolResult,
        ruleResult,
        invoiceResult,
        pendingResult,
        verifiedResult,
        auditResult,
      ] = await Promise.all([
        listBillingSchools(),
        listPricingRules(),
        listPlatformInvoices(),
        listPendingPayments(),
        listVerifiedPayments(),
        listBillingAudit(),
      ])

      setSchools(schoolResult.schools)
      setRules(ruleResult.rules)
      setInvoices(invoiceResult.invoices)
      setPending(pendingResult.payments)
      setVerified(verifiedResult.payments)
      setAudit(auditResult.audit)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load platform billing data.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const selectedSchool = schools.find((school) => school.id === invoiceSchoolId)
  const selectedYear = selectedSchool?.academicYears.find(
    (year) => year.id === invoiceYearId,
  )

  function selectInvoiceSchool(schoolId: string) {
    setInvoiceSchoolId(schoolId)
    const school = schools.find((item) => item.id === schoolId)
    const year = school?.academicYears[0]
    setInvoiceYearId(year?.id ?? '')
    setInvoiceTermId(year?.terms[0]?.id ?? '')
  }

  function selectInvoiceYear(yearId: string) {
    setInvoiceYearId(yearId)
    const year = selectedSchool?.academicYears.find((item) => item.id === yearId)
    setInvoiceTermId(year?.terms[0]?.id ?? '')
  }

  async function handleCreatePricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (pricingBusy) return

    const amountMinor = toMinorUnits(pricingAmount)

    if (amountMinor === null || amountMinor <= 0) {
      setPricingError('Enter a valid per-pupil amount greater than zero.')
      return
    }

    setPricingBusy(true)
    setPricingError(null)
    setNotice(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Creating a per-pupil pricing version affects every new invoice. Confirm your identity to continue.',
    )

    if (!token) {
      setPricingBusy(false)
      return
    }

    try {
      const result = await createPricingRule(
        {
          currency: 'GHS',
          amountMinor,
          effectiveFrom: pricingFrom,
        },
        token,
      )
      setPricingAmount('')
      setNotice(
        `Pricing version ${result.rule.version} created at ${formatMoneyMinor(result.rule.amountMinor, result.rule.currency)} per pupil.`,
      )
      await load()
    } catch (cause) {
      setPricingError(
        cause instanceof Error
          ? cause.message
          : 'Could not create the pricing rule.',
      )
    } finally {
      setPricingBusy(false)
    }
  }

  async function togglePricingRule(rule: PricingRule) {
    setPricingError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Activating or retiring a pricing version changes what schools are billed. Confirm your identity to continue.',
    )

    if (!token) return

    try {
      await setPricingRuleActive(rule.id, !rule.isActive, token)
      await load()
    } catch (cause) {
      setPricingError(
        cause instanceof Error
          ? cause.message
          : 'Could not update the pricing rule.',
      )
    }
  }

  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (invoiceBusy) return

    if (!invoiceSchoolId || !invoiceYearId || !invoiceTermId) {
      setInvoiceError('Select a school, academic year and term.')
      return
    }

    const adjustmentMinor = parseSignedMinor(adjustment)

    if (adjustmentMinor === null) {
      setInvoiceError('Enter a valid adjustment amount.')
      return
    }

    if (adjustmentMinor !== 0 && !adjustmentReason.trim()) {
      setInvoiceError('An adjustment reason is required.')
      return
    }

    setInvoiceBusy(true)
    setInvoiceError(null)
    setNotice(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Creating an invoice snapshots current per-pupil pricing for the selected term. Confirm your identity to continue.',
    )

    if (!token) {
      setInvoiceBusy(false)
      return
    }

    try {
      const result = await createInvoice(
        {
          schoolId: invoiceSchoolId,
          academicYearId: invoiceYearId,
          academicTermId: invoiceTermId,
          issueDate: invoiceIssueDate,
          dueDate: invoiceDueDate || null,
          adjustmentMinor,
          adjustmentReason: adjustmentReason.trim() || null,
        },
        token,
      )

      setNotice(
        result.reusedDraft
          ? `Draft ${result.invoice.invoiceNumber} was refreshed. Issued invoices are immutable.`
          : `Draft ${result.invoice.invoiceNumber} created for ${result.invoice.billablePupilCount} unique pupil${result.invoice.billablePupilCount === 1 ? '' : 's'} (${formatMoneyMinor(result.invoice.totalMinor, result.invoice.currency)}).`,
      )
      setAdjustment('')
      setAdjustmentReason('')
      await load()
      await openInvoice(result.invoice.id)
    } catch (cause) {
      setInvoiceError(
        cause instanceof Error
          ? cause.message
          : 'Could not create the invoice.',
      )
    } finally {
      setInvoiceBusy(false)
    }
  }

  const openInvoice = useCallback(async (invoiceId: string) => {
    setDetailBusy(true)

    try {
      const result = await getPlatformInvoice(invoiceId)
      setDetail(result)
    } catch (cause) {
      setInvoiceError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the invoice.',
      )
    } finally {
      setDetailBusy(false)
    }
  }, [])

  async function runConfirmedAction() {
    if (!confirmAction) return

    setConfirmBusy(true)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      confirmAction.action === 'issue'
        ? 'Issuing an invoice makes it immutable and billable. Confirm your identity to continue.'
        : 'Cancelling an invoice stops it being payable. Confirm your identity to continue.',
    )

    if (!token) {
      setConfirmBusy(false)
      return
    }

    try {
      const result =
        confirmAction.action === 'issue'
          ? await issueInvoice(confirmAction.invoiceId, token)
          : await cancelInvoice(confirmAction.invoiceId, token)

      setNotice(
        confirmAction.action === 'issue'
          ? `Invoice ${result.invoice.invoiceNumber} issued. It is now immutable.`
          : `Invoice ${result.invoice.invoiceNumber} cancelled.`,
      )
      setConfirmAction(null)
      setDetail(result)
      await load()
    } catch (cause) {
      setInvoiceError(
        cause instanceof Error
          ? cause.message
          : 'Could not update the invoice.',
      )
    } finally {
      setConfirmBusy(false)
    }
  }

  function openDecision(payment: PaymentDetail, next: 'VERIFIED' | 'REJECTED') {
    setDecisionPayment(payment)
    setDecision(next)
    setDecisionReason('')
    setDecisionError(null)
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!decisionPayment || decisionBusy) return

    if (decision === 'REJECTED' && !decisionReason.trim()) {
      setDecisionError('A rejection reason is required.')
      return
    }

    setDecisionBusy(true)
    setDecisionError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      decision === 'VERIFIED'
        ? 'Verifying a payment applies money to an invoice. Confirm your identity to continue.'
        : 'Rejecting a payment is an audited financial decision. Confirm your identity to continue.',
    )

    if (!token) {
      setDecisionBusy(false)
      return
    }

    try {
      const result = await verifyPayment(
        decisionPayment.id,
        {
          decision,
          reason: decisionReason.trim() || null,
        },
        token,
      )

      setNotice(
        decision === 'VERIFIED'
          ? `Payment verified: ${formatMoneyMinor(result.payment.appliedMinor, result.payment.currency)} applied to ${result.invoice.invoiceNumber}.${result.payment.overpaymentMinor > 0 ? ` ${formatMoneyMinor(result.payment.overpaymentMinor, result.payment.currency)} retained as overpayment.` : ''}`
          : `Payment rejected for ${result.invoice.invoiceNumber}. The invoice balance was not changed.`,
      )
      setDecisionPayment(null)
      setDecisionReason('')
      await load()
    } catch (cause) {
      setDecisionError(
        cause instanceof Error
          ? cause.message
          : 'Could not record the payment decision.',
      )
    } finally {
      setDecisionBusy(false)
    }
  }

  async function openEvidence(payment: PaymentDetail) {
    setEvidenceError(null)

    const evidence = payment.evidence[0]

    if (!evidence) {
      setEvidenceError('This payment has no evidence attached.')
      return
    }

    try {
      const blob = await fetchPlatformPaymentEvidence(payment.id, evidence.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (cause) {
      setEvidenceError(
        cause instanceof Error ? cause.message : 'Could not open the evidence.',
      )
    }
  }

  const filteredInvoices = useMemo(
    () =>
      statusFilter
        ? invoices.filter((invoice) => invoice.status === statusFilter)
        : invoices,
    [invoices, statusFilter],
  )

  const activeCurrency = invoices[0]?.currency ?? 'GHS'
  const totalInvoiced = invoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((sum, invoice) => sum + invoice.totalMinor, 0)
  const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0)
  const totalOutstanding = invoices.reduce(
    (sum, invoice) => sum + invoice.outstandingMinor,
    0,
  )

  const outstandingBySchool = useMemo(() => {
    const grouped = new Map<
      string,
      { schoolId: string; schoolName: string; outstandingMinor: number; invoices: number }
    >()

    for (const invoice of invoices) {
      if (invoice.outstandingMinor <= 0 || invoice.status === 'CANCELLED') {
        continue
      }

      const current = grouped.get(invoice.schoolId) ?? {
        schoolId: invoice.schoolId,
        schoolName: invoice.schoolName,
        outstandingMinor: 0,
        invoices: 0,
      }

      current.outstandingMinor += invoice.outstandingMinor
      current.invoices += 1
      grouped.set(invoice.schoolId, current)
    }

    return [...grouped.values()].sort(
      (a, b) => b.outstandingMinor - a.outstandingMinor,
    )
  }, [invoices])

  const statusCounts = useMemo(() => {
    const counts: Record<InvoiceStatus, number> = {
      DRAFT: 0,
      ISSUED: 0,
      PARTIALLY_PAID: 0,
      PAID: 0,
      CANCELLED: 0,
    }

    for (const invoice of invoices) {
      counts[invoice.status] += 1
    }

    return counts
  }, [invoices])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform billing"
        description="Manage per-pupil pricing, issue immutable invoices, verify manual payments and audit every billing decision. Verification never releases report cards."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            loading={loading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {notice ? (
        <div
          role="status"
          className="rounded-xl border border-gradely-green/30 bg-gradely-green/10 px-4 py-3 text-sm text-[#137026]"
        >
          {notice}
        </div>
      ) : null}

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => {
          const Icon = item.icon

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                tab === item.id
                  ? 'bg-gradely-navy text-white shadow-sm'
                  : 'border border-slate-300 bg-white text-gradely-text hover:bg-gradely-light'
              }`}
            >
              <Icon aria-hidden="true" className="size-4" />
              {item.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <LoadingPanel label="Loading platform billing…" />
      ) : tab === 'overview' ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Invoiced"
              value={formatMoneyMinor(totalInvoiced, activeCurrency)}
              icon={FileText}
              hint={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
            />
            <StatCard
              label="Verified paid"
              value={formatMoneyMinor(totalPaid, activeCurrency)}
              icon={CheckCircle2}
              hint={`${verified.length} verified payment${verified.length === 1 ? '' : 's'}`}
            />
            <StatCard
              label="Outstanding"
              value={formatMoneyMinor(totalOutstanding, activeCurrency)}
              icon={Wallet}
              hint={`${statusCounts.ISSUED + statusCounts.PARTIALLY_PAID} open invoice${statusCounts.ISSUED + statusCounts.PARTIALLY_PAID === 1 ? '' : 's'}`}
            />
            <StatCard
              label="Awaiting verification"
              value={String(pending.length)}
              icon={ShieldCheck}
              hint="Manual payments"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <h2 className="text-lg font-bold text-gradely-text">
                Outstanding by school
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Only unpaid or partially paid invoices are included.
              </p>
              {outstandingBySchool.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    icon={BadgeCheck}
                    title="No outstanding balances"
                    description="Every active invoice is fully paid."
                  />
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                      <tr>
                        <th className="px-3 py-2">School</th>
                        <th className="px-3 py-2">Invoices</th>
                        <th className="px-3 py-2">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {outstandingBySchool.map((row) => (
                        <tr key={row.schoolId}>
                          <td className="px-3 py-2 font-semibold text-gradely-text">
                            {row.schoolName}
                          </td>
                          <td className="px-3 py-2 text-gradely-muted">
                            {row.invoices}
                          </td>
                          <td className="px-3 py-2 font-semibold text-gradely-navy">
                            {formatMoneyMinor(
                              row.outstandingMinor,
                              activeCurrency,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel>
              <h2 className="text-lg font-bold text-gradely-text">
                Invoice status
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(
                  Object.entries(statusCounts) as [InvoiceStatus, number][]
                ).map(([status, count]) => (
                  <div
                    key={status}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <Badge tone={invoiceStatusTone(status)}>
                      {INVOICE_STATUS_LABELS[status]}
                    </Badge>
                    <p className="mt-2 text-2xl font-extrabold text-gradely-navy">
                      {count}
                    </p>
                  </div>
                ))}
              </div>

              <h3 className="mt-6 text-sm font-bold text-gradely-text">
                Recent billing activity
              </h3>
              {audit.length === 0 ? (
                <p className="mt-2 text-sm text-gradely-muted">
                  No billing activity recorded yet.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {audit.slice(0, 8).map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-gradely-text">
                          {entry.action}
                        </p>
                        <p className="text-xs text-gradely-muted">
                          {entry.entityType}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-gradely-muted">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : tab === 'pricing' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Panel>
            <h2 className="text-lg font-bold text-gradely-text">
              New pricing version
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              Prices are in GHS minor units on the server. Creating a later
              version closes the previous interval; issued invoice snapshots are
              never rewritten.
            </p>

            <form onSubmit={handleCreatePricing} className="mt-4 space-y-4">
              {pricingError ? <ErrorNotice message={pricingError} /> : null}

              <label className="block text-sm font-semibold text-gradely-text">
                Per-pupil price (GHS)
                <input
                  value={pricingAmount}
                  onChange={(event) => setPricingAmount(event.target.value)}
                  inputMode="decimal"
                  required
                  placeholder="e.g. 5.00"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
                />
              </label>

              <label className="block text-sm font-semibold text-gradely-text">
                Effective from
                <input
                  type="date"
                  value={pricingFrom}
                  onChange={(event) => setPricingFrom(event.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
                />
              </label>

              <Button type="submit" loading={pricingBusy}>
                <Plus aria-hidden="true" className="size-4" />
                Create pricing version
              </Button>
            </form>
          </Panel>

          <Panel>
            <h2 className="text-lg font-bold text-gradely-text">
              Pricing history
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              Inactive or historical rules are retained for audit and invoice
              snapshots. Only one active rule resolves per currency and date.
            </p>

            {rules.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={Tag}
                  title="No pricing configured"
                  description="Create the first per-pupil price before creating invoices."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Version</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2">Effective</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="px-3 py-2 font-semibold text-gradely-text">
                          v{rule.version}
                        </td>
                        <td className="px-3 py-2 text-gradely-text">
                          {formatMoneyMinor(rule.amountMinor, rule.currency)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gradely-muted">
                          {formatDate(rule.effectiveFrom)} –{' '}
                          {rule.effectiveTo
                            ? formatDate(rule.effectiveTo)
                            : 'open'}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={rule.isActive ? 'success' : 'neutral'}>
                            {rule.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void togglePricingRule(rule)}
                          >
                            {rule.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      ) : tab === 'invoices' ? (
        <div className="space-y-6">
          <Panel>
            <h2 className="text-lg font-bold text-gradely-text">
              Create a draft invoice
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              The backend counts unique eligible pupils, applies the active
              per-pupil price and calculates every total. Duplicate report
              versions do not multiply the bill.
            </p>

            <form
              onSubmit={handleCreateInvoice}
              className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {invoiceError ? (
                <div className="sm:col-span-2 lg:col-span-3">
                  <ErrorNotice message={invoiceError} />
                </div>
              ) : null}

              <SelectField
                label="School"
                value={invoiceSchoolId}
                onChange={(event) => selectInvoiceSchool(event.target.value)}
                required
              >
                <option value="">Select a school</option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Academic year"
                value={invoiceYearId}
                onChange={(event) => selectInvoiceYear(event.target.value)}
                disabled={!selectedSchool}
                required
              >
                <option value="">Select a year</option>
                {selectedSchool?.academicYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Term"
                value={invoiceTermId}
                onChange={(event) => setInvoiceTermId(event.target.value)}
                disabled={!selectedYear}
                required
              >
                <option value="">Select a term</option>
                {selectedYear?.terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </SelectField>

              <label className="block text-sm font-semibold text-gradely-text">
                Issue date
                <input
                  type="date"
                  value={invoiceIssueDate}
                  onChange={(event) => setInvoiceIssueDate(event.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
                />
              </label>

              <label className="block text-sm font-semibold text-gradely-text">
                Due date (optional)
                <input
                  type="date"
                  value={invoiceDueDate}
                  onChange={(event) => setInvoiceDueDate(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
                />
              </label>

              <label className="block text-sm font-semibold text-gradely-text">
                Adjustment (GHS, optional)
                <input
                  value={adjustment}
                  onChange={(event) => setAdjustment(event.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. -5.00"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
                />
              </label>

              <div className="sm:col-span-2">
                <TextareaField
                  label="Adjustment reason"
                  value={adjustmentReason}
                  onChange={(event) => setAdjustmentReason(event.target.value)}
                  rows={2}
                  maxLength={400}
                  hint="Required whenever the adjustment is not zero."
                />
              </div>

              <div className="flex items-end">
                <Button type="submit" loading={invoiceBusy}>
                  <Plus aria-hidden="true" className="size-4" />
                  Create draft
                </Button>
              </div>
            </form>
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gradely-text">
                  All invoices
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Issued invoices are immutable. Cancel only unpaid invoices.
                </p>
              </div>
              <SelectField
                label="Filter by status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as InvoiceStatus | '')
                }
              >
                <option value="">All statuses</option>
                {(
                  Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]
                ).map((status) => (
                  <option key={status} value={status}>
                    {INVOICE_STATUS_LABELS[status]}
                  </option>
                ))}
              </SelectField>
            </div>

            {filteredInvoices.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={FileText}
                  title="No invoices"
                  description="Create a draft invoice after configuring a pricing version."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2">School / term</th>
                      <th className="px-3 py-2">Pupils</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Outstanding</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-3 py-2 font-semibold text-gradely-text">
                          {invoice.invoiceNumber}
                        </td>
                        <td className="px-3 py-2 text-gradely-muted">
                          {invoice.schoolName}
                          <br />
                          <span className="text-xs">
                            {invoice.academicYearName} ·{' '}
                            {invoice.academicTermName}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gradely-muted">
                          {invoice.billablePupilCount}
                        </td>
                        <td className="px-3 py-2 text-gradely-text">
                          {formatMoneyMinor(
                            invoice.totalMinor,
                            invoice.currency,
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold text-gradely-navy">
                          {formatMoneyMinor(
                            invoice.outstandingMinor,
                            invoice.currency,
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={invoiceStatusTone(invoice.status)}>
                            {INVOICE_STATUS_LABELS[invoice.status]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openInvoice(invoice.id)}
                            >
                              View
                            </Button>
                            {invoice.status === 'DRAFT' ? (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    setConfirmAction({
                                      invoiceId: invoice.id,
                                      action: 'issue',
                                    })
                                  }
                                >
                                  Issue
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setConfirmAction({
                                      invoiceId: invoice.id,
                                      action: 'cancel',
                                    })
                                  }
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : null}
                            {invoice.status === 'ISSUED' &&
                            invoice.paidMinor === 0 ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setConfirmAction({
                                    invoiceId: invoice.id,
                                    action: 'cancel',
                                  })
                                }
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {detailBusy ? (
              <div className="mt-4">
                <LoadingPanel label="Loading invoice detail…" />
              </div>
            ) : detail ? (
              <div className="mt-5 space-y-4 rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-gradely-text">
                      {detail.invoice.invoiceNumber}
                    </h3>
                    <p className="text-xs text-gradely-muted">
                      {detail.invoice.schoolName} · {detail.invoice.academicYearName} ·{' '}
                      {detail.invoice.academicTermName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={invoiceStatusTone(detail.invoice.status)}>
                      {INVOICE_STATUS_LABELS[detail.invoice.status]}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetail(null)}
                    >
                      Close
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-gradely-muted">Unit price</p>
                    <p className="font-semibold">
                      {formatMoneyMinor(
                        detail.invoice.unitAmountMinor,
                        detail.invoice.currency,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gradely-muted">Unique pupils</p>
                    <p className="font-semibold">
                      {detail.invoice.billablePupilCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gradely-muted">Total</p>
                    <p className="font-semibold">
                      {formatMoneyMinor(
                        detail.invoice.totalMinor,
                        detail.invoice.currency,
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gradely-muted">Outstanding</p>
                    <p className="font-semibold">
                      {formatMoneyMinor(
                        detail.invoice.outstandingMinor,
                        detail.invoice.currency,
                      )}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                      <tr>
                        <th className="px-3 py-2">Line</th>
                        <th className="px-3 py-2">Qty</th>
                        <th className="px-3 py-2">Unit</th>
                        <th className="px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-3 py-2">{line.description}</td>
                          <td className="px-3 py-2 text-gradely-muted">
                            {line.quantity}
                          </td>
                          <td className="px-3 py-2 text-gradely-muted">
                            {formatMoneyMinor(
                              line.unitAmountMinor,
                              detail.invoice.currency,
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {formatMoneyMinor(
                              line.amountMinor,
                              detail.invoice.currency,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-gradely-text">
                    Billed pupils
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detail.pupils.map((pupil) => (
                      <span
                        key={pupil.id}
                        className="rounded-full bg-gradely-light px-3 py-1 text-xs font-medium text-gradely-text"
                      >
                        {pupil.pupilName} · {pupil.admissionNumber} · v
                        {pupil.reportVersion}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : tab === 'payments' ? (
        <div className="space-y-6">
          {evidenceError ? <ErrorNotice message={evidenceError} /> : null}

          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gradely-text">
                  Awaiting verification
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Manual payments only. Verification applies the amount to the
                  invoice and never releases report cards.
                </p>
              </div>
              <Badge tone="warning">{pending.length} pending</Badge>
            </div>

            {pending.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={BadgeCheck}
                  title="Nothing awaiting verification"
                  description="New manual payment evidence will appear here."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {pending.map((payment) => (
                  <article
                    key={payment.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-gradely-text">
                          {payment.schoolName} · {payment.invoiceNumber}
                        </p>
                        <p className="mt-0.5 text-sm text-gradely-muted">
                          {formatMoneyMinor(
                            payment.amountMinor,
                            payment.currency,
                          )}{' '}
                          · {PAYMENT_METHOD_LABELS[payment.method]} ·{' '}
                          {payment.paymentReference}
                        </p>
                        <p className="text-xs text-gradely-muted">
                          Paid {formatDate(payment.paidAt)} · submitted{' '}
                          {formatDateTime(payment.submittedAt)}
                          {payment.payerName
                            ? ` · payer ${payment.payerName}`
                            : ''}
                        </p>
                        {payment.notes ? (
                          <p className="mt-1 text-sm text-gradely-text">
                            {payment.notes}
                          </p>
                        ) : null}
                      </div>
                      <Badge tone={paymentStatusTone(payment.status)}>
                        {PAYMENT_STATUS_LABELS[payment.status]}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void openEvidence(payment)}
                      >
                        <Paperclip aria-hidden="true" className="size-4" />
                        View evidence
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openDecision(payment, 'VERIFIED')}
                      >
                        <CheckCircle2 aria-hidden="true" className="size-4" />
                        Verify
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => openDecision(payment, 'REJECTED')}
                      >
                        <AlertTriangle aria-hidden="true" className="size-4" />
                        Reject
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel>
            <h2 className="text-lg font-bold text-gradely-text">
              Verified payments
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              Verified amounts are the only payments that change invoice
              balances.
            </p>

            {verified.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={CheckCircle2}
                  title="No verified payments"
                  description="Verified manual and online payments will appear here."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Verified</th>
                      <th className="px-3 py-2">School / invoice</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Applied</th>
                      <th className="px-3 py-2">Overpayment</th>
                      <th className="px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {verified.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-3 py-2 text-gradely-muted">
                          {formatDateTime(payment.verifiedAt)}
                        </td>
                        <td className="px-3 py-2 text-gradely-text">
                          {payment.schoolName}
                          <br />
                          <span className="text-xs text-gradely-muted">
                            {payment.invoiceNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gradely-muted">
                          {payment.paymentReference}
                        </td>
                        <td className="px-3 py-2">
                          {formatMoneyMinor(
                            payment.amountMinor,
                            payment.currency,
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold text-gradely-navy">
                          {formatMoneyMinor(
                            payment.appliedMinor,
                            payment.currency,
                          )}
                        </td>
                        <td className="px-3 py-2 text-gradely-muted">
                          {payment.overpaymentMinor > 0
                            ? formatMoneyMinor(
                                payment.overpaymentMinor,
                                payment.currency,
                              )
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone="info">{payment.source}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gradely-text">
                Billing audit history
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Append-only record of pricing, invoice, payment and verification
                decisions.
              </p>
            </div>
            <Badge tone="info">{audit.length} entries</Badge>
          </div>

          {audit.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={History}
                title="No audit entries"
                description="Billing actions will be recorded here."
              />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Entity</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3 py-2 text-gradely-muted">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-semibold text-gradely-text">
                        {entry.action}
                      </td>
                      <td className="px-3 py-2 text-gradely-muted">
                        {entry.entityType}
                        {entry.entityId ? (
                          <span className="block max-w-40 truncate text-xs">
                            {entry.entityId}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-gradely-muted">
                        {entry.actorUserId ? (
                          <span className="block max-w-40 truncate text-xs">
                            {entry.actorUserId}
                          </span>
                        ) : (
                          'system'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold text-gradely-navy">
                            View
                          </summary>
                          <pre className="mt-2 max-w-xl overflow-x-auto rounded-lg bg-gradely-light p-2 text-[11px] text-gradely-text">
                            {JSON.stringify(
                              {
                                before: entry.beforeState,
                                after: entry.afterState,
                                metadata: entry.metadata,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.action === 'issue'
            ? 'Issue this invoice?'
            : 'Cancel this invoice?'
        }
        description={
          confirmAction?.action === 'issue'
            ? 'Issuing freezes the price snapshot and makes the invoice immutable. This cannot be undone.'
            : 'Cancelling stops the invoice from accepting payments. Only unpaid invoices can be cancelled.'
        }
        confirmLabel={confirmAction?.action === 'issue' ? 'Issue invoice' : 'Cancel invoice'}
        danger={confirmAction?.action === 'cancel'}
        busy={confirmBusy}
        onConfirm={() => void runConfirmedAction()}
        onCancel={() => setConfirmAction(null)}
      />

      <Modal
        open={decisionPayment !== null}
        title={
          decision === 'VERIFIED'
            ? 'Verify this payment?'
            : 'Reject this payment?'
        }
        description={
          decision === 'VERIFIED'
            ? 'The verified amount will be applied to the invoice, capped at the outstanding balance. Any excess is retained as an explicit overpayment.'
            : 'A rejection reason is required. The invoice balance will not change.'
        }
        onClose={() => {
          if (!decisionBusy) setDecisionPayment(null)
        }}
      >
        <form onSubmit={submitDecision} className="space-y-4">
          {decisionError ? <ErrorNotice message={decisionError} /> : null}

          {decisionPayment ? (
            <div className="rounded-xl bg-gradely-light px-4 py-3 text-sm">
              <p className="font-semibold text-gradely-text">
                {decisionPayment.schoolName} · {decisionPayment.invoiceNumber}
              </p>
              <p className="text-gradely-muted">
                {formatMoneyMinor(
                  decisionPayment.amountMinor,
                  decisionPayment.currency,
                )}{' '}
                · {decisionPayment.paymentReference}
              </p>
            </div>
          ) : null}

          <TextareaField
            label={decision === 'VERIFIED' ? 'Note (optional)' : 'Rejection reason'}
            value={decisionReason}
            onChange={(event) => setDecisionReason(event.target.value)}
            rows={3}
            maxLength={1000}
            required={decision === 'REJECTED'}
            hint={
              decision === 'REJECTED'
                ? 'Explain why the evidence or reference was not accepted.'
                : 'Optional verification note stored in the audit history.'
            }
          />

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDecisionPayment(null)}
              disabled={decisionBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={decision === 'REJECTED' ? 'danger' : 'primary'}
              loading={decisionBusy}
            >
              {decision === 'VERIFIED' ? 'Verify payment' : 'Reject payment'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
