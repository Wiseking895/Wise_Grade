import {
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Upload,
  Wallet,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import {
  AccessDenied,
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
  TextareaField,
} from '../../components/ui'
import {
  fetchSchoolPaymentEvidence,
  getSchoolInvoice,
  getSchoolPayment,
  initiateOnlinePayment,
  listSchoolInvoices,
  listSchoolPayments,
  submitManualPayment,
} from '../../billing/api'
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatMoneyMinor,
  invoiceStatusTone,
  isPayableInvoice,
  minorToMajorInput,
  paymentStatusTone,
  toMinorUnits,
} from '../../billing/format'
import type {
  InvoiceDetail,
  InvoiceRecord,
  ManualPaymentInput,
  PaymentMethod,
  PaymentRecord,
} from '../../billing/types'
import { formatDate, formatDateTime, todayInputValue } from '../../lib/format'
import { useSchool } from '../../schools/use-school'

const EVIDENCE_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024

type EvidenceMime = (typeof EVIDENCE_TYPES)[number]

function isEvidenceMime(value: string): value is EvidenceMime {
  return (EVIDENCE_TYPES as readonly string[]).includes(value)
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result

      if (typeof result !== 'string') {
        reject(new Error('Could not read the selected file'))
        return
      }

      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.readAsDataURL(file)
  })
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Wallet
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
        </div>
        <span className="rounded-xl bg-gradely-blue/10 p-2.5">
          <Icon aria-hidden="true" className="size-5 text-gradely-blue" />
        </span>
      </div>
    </div>
  )
}

function ManualPaymentForm({
  schoolId,
  invoice,
  onSubmitted,
  onCancel,
}: {
  schoolId: string
  invoice: InvoiceRecord
  onSubmitted: () => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(
    minorToMajorInput(invoice.outstandingMinor),
  )
  const [method, setMethod] =
    useState<Exclude<PaymentMethod, 'CARD'>>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [paidAt, setPaidAt] = useState(todayInputValue())
  const [payerName, setPayerName] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setFile(selected)
    setError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) return

    const amountMinor = toMinorUnits(amount)

    if (amountMinor === null || amountMinor <= 0) {
      setError('Enter a valid amount greater than zero, with at most 2 decimals.')
      return
    }

    if (!reference.trim()) {
      setError('Enter the bank, mobile-money or receipt reference.')
      return
    }

    if (!file) {
      setError('Attach payment evidence (PNG, JPEG or PDF, up to 2 MB).')
      return
    }

    if (!isEvidenceMime(file.type)) {
      setError('Evidence must be a PNG, JPEG or PDF file.')
      return
    }

    if (file.size === 0 || file.size > MAX_EVIDENCE_BYTES) {
      setError('Evidence must be between 1 byte and 2 MB.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const input: ManualPaymentInput = {
        amountMinor,
        currency: invoice.currency,
        method,
        paymentReference: reference.trim(),
        paidAt,
        payerName: payerName.trim() || null,
        notes: notes.trim() || null,
        evidence: {
          mimeType: file.type,
          originalName: file.name,
          base64: await readFileAsBase64(file),
        },
      }

      await submitManualPayment(schoolId, invoice.id, input)
      onSubmitted()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not submit the payment.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <div className="rounded-xl border border-gradely-blue/20 bg-gradely-blue/5 px-4 py-3 text-sm text-gradely-navy">
        <p className="font-semibold">Submission is not settlement.</p>
        <p className="mt-0.5 text-gradely-muted">
          The invoice remains unpaid until a platform administrator verifies the
          evidence. Evidence is stored privately and is never served as a public
          link.
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-gradely-text">
          Amount ({invoice.currency})
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
          />
          <span className="mt-1 block text-xs font-normal text-gradely-muted">
            Outstanding: {formatMoneyMinor(invoice.outstandingMinor, invoice.currency)}
          </span>
        </label>

        <SelectField
          label="Payment method"
          value={method}
          onChange={(event) =>
            setMethod(event.target.value as Exclude<PaymentMethod, 'CARD'>)
          }
        >
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="MOBILE_MONEY">Mobile money</option>
          <option value="CASH">Cash</option>
          <option value="OTHER">Other</option>
        </SelectField>

        <label className="block text-sm font-semibold text-gradely-text">
          Payment reference
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            required
            maxLength={120}
            placeholder="Bank or receipt reference"
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
          />
        </label>

        <label className="block text-sm font-semibold text-gradely-text">
          Payment date
          <input
            type="date"
            value={paidAt}
            max={todayInputValue()}
            onChange={(event) => setPaidAt(event.target.value)}
            required
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
          />
        </label>

        <label className="block text-sm font-semibold text-gradely-text">
          Payer name (optional)
          <input
            value={payerName}
            onChange={(event) => setPayerName(event.target.value)}
            maxLength={160}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
          />
        </label>

        <label className="block text-sm font-semibold text-gradely-text">
          Evidence file
          <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-gradely-light px-3.5 py-2.5 text-sm font-normal text-gradely-muted">
            <Upload aria-hidden="true" className="size-4 shrink-0" />
            <input
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              onChange={handleFile}
              required
              className="w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-gradely-navy file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </span>
          <span className="mt-1 block text-xs font-normal text-gradely-muted">
            PNG, JPEG or PDF up to 2 MB. Stored privately.
          </span>
        </label>
      </div>

      <TextareaField
        label="Notes (optional)"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={1000}
        rows={3}
      />

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          <Paperclip aria-hidden="true" className="size-4" />
          Submit for verification
        </Button>
      </div>
    </form>
  )
}

export default function BillingPage() {
  const { schoolId, isAdmin } = useSchool()
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [onlineEnabled, setOnlineEnabled] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)
  const [onlineMessage, setOnlineMessage] = useState<string | null>(null)
  const [onlineError, setOnlineError] = useState<string | null>(null)
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schoolId) return

    setLoading(true)

    try {
      const [invoiceResult, paymentResult] = await Promise.all([
        listSchoolInvoices(schoolId),
        listSchoolPayments(schoolId),
      ])
      setInvoices(invoiceResult.invoices)
      setOnlineEnabled(invoiceResult.onlinePaymentsEnabled)
      setProvider(invoiceResult.provider)
      setPayments(paymentResult.payments)
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load billing data.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const openInvoice = useCallback(
    async (invoiceId: string) => {
      if (!schoolId) return

      setSelectedId(invoiceId)
      setDetailLoading(true)
      setShowManualForm(false)
      setOnlineMessage(null)
      setOnlineError(null)

      try {
        const result = await getSchoolInvoice(schoolId, invoiceId)
        setDetail(result)
        setDetailError(null)
      } catch (cause) {
        setDetail(null)
        setDetailError(
          cause instanceof Error
            ? cause.message
            : 'Could not load the invoice.',
        )
      } finally {
        setDetailLoading(false)
      }
    },
    [schoolId],
  )

  async function refreshAfterPayment(invoiceId: string) {
    await load()
    await openInvoice(invoiceId)
  }

  async function handleOnlinePayment(invoice: InvoiceRecord) {
    if (!schoolId || onlineBusy) return

    setOnlineBusy(true)
    setOnlineError(null)
    setOnlineMessage(null)

    try {
      const result = await initiateOnlinePayment(schoolId, invoice.id, {
        idempotencyKey: crypto.randomUUID(),
        method: 'MOBILE_MONEY',
      })

      setOnlineMessage(
        result.reused
          ? 'An existing online payment attempt was reused. It still awaits provider settlement.'
          : 'Online payment attempt created. This development mock only settles after a signed provider webhook; it is not proof of payment.',
      )
      await refreshAfterPayment(invoice.id)
    } catch (cause) {
      setOnlineError(
        cause instanceof Error
          ? cause.message
          : 'Could not start an online payment.',
      )
    } finally {
      setOnlineBusy(false)
    }
  }

  async function openEvidence(paymentId: string) {
    if (!schoolId) return

    setEvidenceError(null)

    try {
      const result = await getSchoolPayment(schoolId, paymentId)
      const evidence = result.payment.evidence[0]

      if (!evidence) {
        setEvidenceError('This payment has no evidence attached.')
        return
      }

      const blob = await fetchSchoolPaymentEvidence(
        schoolId,
        paymentId,
        evidence.id,
      )
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (cause) {
      setEvidenceError(
        cause instanceof Error ? cause.message : 'Could not open the evidence.',
      )
    }
  }

  if (!isAdmin) {
    return (
      <AccessDenied message="Only school administrators can view invoices and submit payment evidence." />
    )
  }

  if (!schoolId) return null

  const totalInvoiced = invoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((sum, invoice) => sum + invoice.totalMinor, 0)
  const totalPaid = invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0)
  const totalOutstanding = invoices.reduce(
    (sum, invoice) => sum + invoice.outstandingMinor,
    0,
  )
  const currency = invoices[0]?.currency ?? 'GHS'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & payments"
        description="Review school invoices, submit payment evidence and track verification. Payment verification updates billing only; it does not release report cards."
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

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Invoiced"
          value={formatMoneyMinor(totalInvoiced, currency)}
          icon={FileText}
        />
        <StatCard
          label="Verified paid"
          value={formatMoneyMinor(totalPaid, currency)}
          icon={CheckCircle2}
        />
        <StatCard
          label="Outstanding"
          value={formatMoneyMinor(totalOutstanding, currency)}
          icon={Wallet}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gradely-text">Invoices</h2>
            <p className="mt-1 text-sm text-gradely-muted">
              Issued invoices are immutable. Amounts are calculated by the
              backend from the active per-pupil price and unique eligible pupils.
            </p>
          </div>
          <Badge tone={onlineEnabled ? 'success' : 'neutral'}>
            {onlineEnabled
              ? `Online payments: ${provider ?? 'configured'}`
              : 'Online payments unavailable'}
          </Badge>
        </div>

        {loading ? (
          <div className="mt-4">
            <LoadingPanel label="Loading invoices…" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Banknote}
              title="No invoices yet"
              description="The platform administrator creates an invoice for your school, academic year and term."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {invoices.map((invoice) => {
              const progress =
                invoice.totalMinor > 0
                  ? Math.min(
                      100,
                      Math.round(
                        (invoice.paidMinor / invoice.totalMinor) * 100,
                      ),
                    )
                  : 0

              return (
                <article
                  key={invoice.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-gradely-text">
                        {invoice.invoiceNumber}
                      </p>
                      <p className="mt-0.5 text-sm text-gradely-muted">
                        {invoice.academicYearName} · {invoice.academicTermName} ·{' '}
                        {invoice.billablePupilCount} pupil
                        {invoice.billablePupilCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <Badge tone={invoiceStatusTone(invoice.status)}>
                      {INVOICE_STATUS_LABELS[invoice.status]}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-gradely-muted">Total</p>
                      <p className="font-semibold text-gradely-text">
                        {formatMoneyMinor(invoice.totalMinor, invoice.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gradely-muted">Paid</p>
                      <p className="font-semibold text-gradely-text">
                        {formatMoneyMinor(invoice.paidMinor, invoice.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gradely-muted">Outstanding</p>
                      <p className="font-semibold text-gradely-text">
                        {formatMoneyMinor(
                          invoice.outstandingMinor,
                          invoice.currency,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gradely-muted">Due</p>
                      <p className="font-semibold text-gradely-text">
                        {formatDate(invoice.dueDate ?? invoice.issueDate)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradely-green"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void openInvoice(invoice.id)}
                    >
                      View invoice
                    </Button>
                    {isPayableInvoice(invoice.status) && onlineEnabled ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={onlineBusy && selectedId === invoice.id}
                        onClick={() => void handleOnlinePayment(invoice)}
                      >
                        <CreditCard aria-hidden="true" className="size-4" />
                        Start online payment
                      </Button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Panel>

      {selectedId ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gradely-text">
                Invoice detail
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Frozen price snapshot, pupil population and payment history.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedId(null)
                setDetail(null)
              }}
            >
              Close
            </Button>
          </div>

          {detailLoading ? (
            <div className="mt-4">
              <LoadingPanel label="Loading invoice detail…" />
            </div>
          ) : detailError ? (
            <div className="mt-4">
              <ErrorNotice
                message={detailError}
                onRetry={() => void openInvoice(selectedId)}
              />
            </div>
          ) : detail ? (
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gradely-light px-4 py-3">
                <div>
                  <p className="font-bold text-gradely-navy">
                    {detail.invoice.invoiceNumber}
                  </p>
                  <p className="text-xs text-gradely-muted">
                    {detail.invoice.schoolName} · {detail.invoice.academicYearName} ·{' '}
                    {detail.invoice.academicTermName}
                  </p>
                </div>
                <Badge tone={invoiceStatusTone(detail.invoice.status)}>
                  {INVOICE_STATUS_LABELS[detail.invoice.status]}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-gradely-muted">Per pupil</p>
                  <p className="font-semibold text-gradely-text">
                    {formatMoneyMinor(
                      detail.invoice.unitAmountMinor,
                      detail.invoice.currency,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gradely-muted">Unique pupils</p>
                  <p className="font-semibold text-gradely-text">
                    {detail.invoice.billablePupilCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gradely-muted">Total</p>
                  <p className="font-semibold text-gradely-text">
                    {formatMoneyMinor(
                      detail.invoice.totalMinor,
                      detail.invoice.currency,
                    )}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-gradely-text">
                  Invoice lines
                </h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                      <tr>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2">Qty</th>
                        <th className="px-3 py-2">Unit</th>
                        <th className="px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-3 py-2 text-gradely-text">
                            {line.description}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                            {line.quantity}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                            {formatMoneyMinor(
                              line.unitAmountMinor,
                              detail.invoice.currency,
                            )}
                          </td>
                          <td className="px-3 py-2 font-semibold whitespace-nowrap text-gradely-text">
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
              </div>

              <div>
                <h3 className="text-sm font-bold text-gradely-text">
                  Billed pupils
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.pupils.map((pupil) => (
                    <span
                      key={pupil.id}
                      className="rounded-full bg-gradely-light px-3 py-1 text-xs font-medium text-gradely-text"
                    >
                      {pupil.pupilName} · {pupil.admissionNumber}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-gradely-text">
                  Payment attempts
                </h3>
                {detail.payments.length === 0 ? (
                  <p className="mt-2 text-sm text-gradely-muted">
                    No payments submitted for this invoice.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {detail.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-gradely-text">
                            {formatMoneyMinor(
                              payment.amountMinor,
                              payment.currency,
                            )}{' '}
                            · {PAYMENT_METHOD_LABELS[payment.method]}
                          </p>
                          <p className="text-xs text-gradely-muted">
                            {payment.paymentReference} ·{' '}
                            {formatDateTime(payment.submittedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={paymentStatusTone(payment.status)}>
                            {PAYMENT_STATUS_LABELS[payment.status]}
                          </Badge>
                          {payment.source === 'MANUAL' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openEvidence(payment.id)}
                            >
                              <Paperclip aria-hidden="true" className="size-3.5" />
                              Evidence
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {evidenceError ? (
                <ErrorNotice message={evidenceError} />
              ) : null}

              {onlineMessage ? (
                <div className="rounded-xl border border-gradely-blue/20 bg-gradely-blue/5 px-4 py-3 text-sm text-gradely-navy">
                  {onlineMessage}
                </div>
              ) : null}

              {onlineError ? <ErrorNotice message={onlineError} /> : null}

              {isPayableInvoice(detail.invoice.status) ? (
                <div className="border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-gradely-text">
                        Submit a manual payment
                      </h3>
                      <p className="text-xs text-gradely-muted">
                        A platform administrator must verify the evidence before
                        the invoice balance changes.
                      </p>
                    </div>
                    {!showManualForm ? (
                      <Button
                        size="sm"
                        onClick={() => setShowManualForm(true)}
                      >
                        <Upload aria-hidden="true" className="size-4" />
                        Add payment evidence
                      </Button>
                    ) : null}
                  </div>

                  {showManualForm ? (
                    <ManualPaymentForm
                      schoolId={schoolId}
                      invoice={detail.invoice}
                      onCancel={() => setShowManualForm(false)}
                      onSubmitted={() => {
                        setShowManualForm(false)
                        void refreshAfterPayment(detail.invoice.id)
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gradely-text">
              Payment history
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              Manual and online payment attempts for this school. Submission
              never settles an invoice on its own.
            </p>
          </div>
          <Badge tone="info">
            <ShieldCheck aria-hidden="true" className="mr-1 size-3.5" />
            Platform-verified
          </Badge>
        </div>

        {payments.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Wallet}
              title="No payments yet"
              description="Payment attempts will appear here after the school submits evidence or starts an online payment."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-gradely-light text-left text-xs text-gradely-muted uppercase">
                <tr>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Applied</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                      {formatDateTime(payment.submittedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gradely-text">
                      {payment.paymentReference}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gradely-text">
                      {formatMoneyMinor(payment.amountMinor, payment.currency)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                      {formatMoneyMinor(payment.appliedMinor, payment.currency)}
                      {payment.overpaymentMinor > 0 ? (
                        <span className="ml-1 text-xs text-[#7a5400]">
                          (+{formatMoneyMinor(payment.overpaymentMinor, payment.currency)}{' '}
                          overpayment)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={paymentStatusTone(payment.status)}>
                        {PAYMENT_STATUS_LABELS[payment.status]}
                      </Badge>
                      {payment.rejectionReason ? (
                        <p className="mt-1 max-w-48 text-xs text-gradely-muted">
                          {payment.rejectionReason}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {payment.source === 'MANUAL' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openEvidence(payment.id)}
                        >
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-gradely-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
