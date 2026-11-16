export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED'

export type PaymentStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'

export type PaymentSource = 'ONLINE' | 'MANUAL'

export type PaymentMethod =
  | 'MOBILE_MONEY'
  | 'BANK_TRANSFER'
  | 'CARD'
  | 'CASH'
  | 'OTHER'

export interface BillingTermScope {
  id: string
  name: string
  sequence: number
  isCurrent: boolean
}

export interface BillingYearScope {
  id: string
  name: string
  isCurrent: boolean
  terms: BillingTermScope[]
}

export interface BillingSchoolScope {
  id: string
  name: string
  isActive: boolean
  academicYears: BillingYearScope[]
}

export interface PricingRule {
  id: string
  currency: string
  amountMinor: number
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
  version: number
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceRecord {
  id: string
  invoiceNumber: string
  schoolId: string
  schoolName: string
  academicYearId: string
  academicYearName: string
  academicTermId: string
  academicTermName: string
  academicTermSequence: number
  pricingRuleId: string
  currency: string
  unitAmountMinor: number
  billablePupilCount: number
  subtotalMinor: number
  adjustmentMinor: number
  totalMinor: number
  paidMinor: number
  outstandingMinor: number
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  issuedAt: string | null
  cancelledAt: string | null
  snapshot: InvoiceSnapshot | null
  createdAt: string
  updatedAt: string
}

export interface InvoiceSnapshot {
  schemaVersion: number
  invoiceNumber: string
  school: { id: string; name: string }
  academicYear: { id: string; name: string }
  academicTerm: { id: string; name: string; sequence: number }
  price: {
    pricingRuleId: string
    version: number
    currency: string
    amountMinor: number
    effectiveFrom: string
    effectiveTo: string | null
  }
  billablePopulation: { count: number; pupils: InvoicePupil[] }
  calculation: {
    unitAmountMinor: number
    billablePupilCount: number
    subtotalMinor: number
    adjustmentMinor: number
    adjustmentReason: string | null
    totalMinor: number
    formula: string
  }
  dates: { issueDate: string; dueDate: string | null }
  releaseBoundary: string
}

export interface InvoiceLine {
  id: string
  invoiceId: string
  kind: 'PUPIL_CHARGE' | 'ADJUSTMENT'
  description: string
  quantity: number
  unitAmountMinor: number
  amountMinor: number
  sortOrder: number
}

export interface InvoicePupil {
  id: string
  invoiceId: string
  pupilId: string
  reportCardId: string | null
  classId: string
  pupilName: string
  admissionNumber: string
  reportVersion: number
}

export interface PaymentEvidence {
  id: string
  paymentId: string
  storageKey: string
  mimeType: string
  byteSize: number
  checksum: string
  originalName: string
  createdAt: string
}

export interface PaymentVerification {
  id: string
  paymentId: string
  invoiceId: string
  decision: 'VERIFIED' | 'REJECTED'
  fromStatus: PaymentStatus
  toStatus: PaymentStatus
  reason: string | null
  verifiedByUserId: string
  verifiedByName: string | null
  createdAt: string
}

export interface PaymentRecord {
  id: string
  schoolId: string
  invoiceId: string
  source: PaymentSource
  method: PaymentMethod
  status: PaymentStatus
  amountMinor: number
  appliedMinor: number
  overpaymentMinor: number
  currency: string
  paymentReference: string
  provider: string | null
  providerReference: string | null
  idempotencyKey: string | null
  payerName: string | null
  paidAt: string
  notes: string | null
  submittedByMembershipId: string | null
  initiatedByUserId: string | null
  verifiedByUserId: string | null
  submittedAt: string
  verifiedAt: string | null
  rejectionReason: string | null
  createdAt: string
  updatedAt: string
}

export interface PaymentDetail extends PaymentRecord {
  invoiceNumber: string
  schoolName: string
  evidence: PaymentEvidence[]
  verifications: PaymentVerification[]
}

export interface InvoiceDetail {
  invoice: InvoiceRecord
  pupils: InvoicePupil[]
  lines: InvoiceLine[]
  payments: PaymentRecord[]
}

export interface SchoolInvoicesResult {
  invoices: InvoiceRecord[]
  onlinePaymentsEnabled: boolean
  provider: string | null
}

export interface CreateInvoiceResult {
  invoice: InvoiceRecord
  pupils: InvoicePupil[]
  lines: InvoiceLine[]
  reusedDraft: boolean
}

export interface PaymentVerificationResult {
  payment: PaymentRecord
  invoice: InvoiceRecord
}

export interface OnlinePaymentResult {
  payment: PaymentRecord
  checkout: {
    provider: string
    providerReference: string
    checkoutUrl: string | null
  }
  reused: boolean
}

export interface BillingAuditRecord {
  id: string
  schoolId: string | null
  invoiceId: string | null
  paymentId: string | null
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string | null
  beforeState: unknown
  afterState: unknown
  metadata: unknown
  createdAt: string
}

export interface CreatePricingRuleInput {
  currency: string
  amountMinor: number
  effectiveFrom: string
}

export interface CreateInvoiceInput {
  schoolId: string
  academicYearId: string
  academicTermId: string
  currency?: string
  issueDate?: string | null
  dueDate?: string | null
  adjustmentMinor?: number
  adjustmentReason?: string | null
}

export interface ManualPaymentInput {
  amountMinor: number
  currency: string
  method: Exclude<PaymentMethod, 'CARD'>
  paymentReference: string
  paidAt: string
  payerName?: string | null
  notes?: string | null
  evidence?: {
    mimeType: 'image/png' | 'image/jpeg' | 'application/pdf'
    originalName: string
    base64: string
  }
}
