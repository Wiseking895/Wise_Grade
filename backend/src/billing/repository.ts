import type { SchoolRole } from '../auth/roles.js'

export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED'

export type InvoiceLineKind = 'PUPIL_CHARGE' | 'ADJUSTMENT'

export type PaymentSource = 'ONLINE' | 'MANUAL'

export type PaymentMethod =
  | 'MOBILE_MONEY'
  | 'BANK_TRANSFER'
  | 'CARD'
  | 'CASH'
  | 'OTHER'

export type PaymentStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'

export type PaymentVerificationDecision = 'VERIFIED' | 'REJECTED'

export interface SchoolBillingActor {
  schoolId: string
  userId: string
  membershipId: string
  role: SchoolRole
}

export interface PlatformBillingActor {
  userId: string
}

export interface BillingAuditContext {
  actorUserId?: string | null
  actorMembershipId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

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

export interface PricingRuleRecord {
  id: string
  currency: string
  amountMinor: number
  effectiveFrom: Date
  effectiveTo: Date | null
  isActive: boolean
  version: number
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

export interface CreatePricingRuleInput {
  currency: string
  amountMinor: number
  effectiveFrom: string
}

export interface BillablePupilRecord {
  pupilId: string
  reportCardId: string
  reportVersion: number
  pupilName: string
  admissionNumber: string
  classId: string
  className: string
}

export interface InvoiceLineRecord {
  id: string
  invoiceId: string
  kind: InvoiceLineKind
  description: string
  quantity: number
  unitAmountMinor: number
  amountMinor: number
  sortOrder: number
}

export interface InvoicePupilRecord {
  id: string
  invoiceId: string
  pupilId: string
  reportCardId: string | null
  classId: string
  pupilName: string
  admissionNumber: string
  reportVersion: number
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
  issueDate: Date
  dueDate: Date | null
  issuedAt: Date | null
  cancelledAt: Date | null
  snapshot: unknown
  createdAt: Date
  updatedAt: Date
}

export interface PaymentEvidenceRecord {
  id: string
  paymentId: string
  storageKey: string
  mimeType: string
  byteSize: number
  checksum: string
  originalName: string
  createdAt: Date
}

export interface PaymentVerificationRecord {
  id: string
  paymentId: string
  invoiceId: string
  decision: PaymentVerificationDecision
  fromStatus: PaymentStatus
  toStatus: PaymentStatus
  reason: string | null
  verifiedByUserId: string
  verifiedByName: string | null
  createdAt: Date
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
  paidAt: Date
  notes: string | null
  submittedByMembershipId: string | null
  initiatedByUserId: string | null
  verifiedByUserId: string | null
  submittedAt: Date
  verifiedAt: Date | null
  rejectionReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface PaymentDetail extends PaymentRecord {
  invoiceNumber: string
  schoolName: string
  evidence: PaymentEvidenceRecord[]
  verifications: PaymentVerificationRecord[]
}

export interface InvoiceDetail {
  invoice: InvoiceRecord
  pupils: InvoicePupilRecord[]
  lines: InvoiceLineRecord[]
  payments: PaymentRecord[]
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
  /** Optimistic idempotency support for repeated platform submissions. */
  regenerateDraft?: boolean
}

export interface CreateInvoiceResult {
  detail: InvoiceDetail
  reusedDraft: boolean
}

export interface ManualPaymentInput {
  paymentId: string
  invoiceId: string
  amountMinor: number
  currency: string
  method: Exclude<PaymentMethod, 'CARD'>
  paymentReference: string
  paidAt: string
  payerName?: string | null
  notes?: string | null
  evidence?: {
    storageKey: string
    mimeType: string
    byteSize: number
    checksum: string
    originalName: string
  } | null
}

export interface OnlinePaymentInput {
  paymentId: string
  invoiceId: string
  amountMinor: number
  currency: string
  method: PaymentMethod
  paymentReference: string
  provider: string
  providerReference: string
  idempotencyKey: string
  paidAt: string
}

export interface PaymentVerificationResult {
  payment: PaymentRecord
  invoice: InvoiceRecord
}

export interface VerifyManualPaymentInput {
  decision: PaymentVerificationDecision
  reason?: string | null
}

export interface ProviderEventInput {
  provider: string
  providerEventId: string
  eventType: string
  providerReference?: string | null
  schoolId?: string | null
  paymentId?: string | null
  payload: unknown
  signatureValid: boolean
  outcome: string
}

export interface ProviderEventRecord {
  id: string
  provider: string
  providerEventId: string
  outcome: string
  createdAt: Date
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
  createdAt: Date
}

/**
 * Persistence boundary for Phase 6A billing. Every school-facing method is
 * scoped by the authenticated actor's schoolId. Platform methods are only
 * reachable through platform-admin routes.
 */
export interface BillingRepository {
  /** Platform-only: schools and their calendar scopes for invoice creation. */
  listBillingSchools(): Promise<BillingSchoolScope[]>
  listPricingRules(): Promise<PricingRuleRecord[]>
  createPricingRule(
    actor: PlatformBillingActor,
    input: CreatePricingRuleInput,
    audit: BillingAuditContext,
  ): Promise<PricingRuleRecord>
  setPricingRuleActive(
    actor: PlatformBillingActor,
    ruleId: string,
    isActive: boolean,
    audit: BillingAuditContext,
  ): Promise<PricingRuleRecord>
  resolvePricingRule(
    currency: string,
    onDate: Date,
  ): Promise<PricingRuleRecord | null>

  listSchoolInvoices(actor: SchoolBillingActor): Promise<InvoiceRecord[]>
  getSchoolInvoice(
    actor: SchoolBillingActor,
    invoiceId: string,
  ): Promise<InvoiceDetail | null>
  listPlatformInvoices(): Promise<InvoiceRecord[]>
  getPlatformInvoice(invoiceId: string): Promise<InvoiceDetail | null>
  createOrRefreshDraftInvoice(
    actor: PlatformBillingActor,
    input: CreateInvoiceInput,
    audit: BillingAuditContext,
  ): Promise<CreateInvoiceResult>
  issueInvoice(
    actor: PlatformBillingActor,
    invoiceId: string,
    audit: BillingAuditContext,
  ): Promise<InvoiceDetail>
  cancelInvoice(
    actor: PlatformBillingActor,
    invoiceId: string,
    audit: BillingAuditContext,
  ): Promise<InvoiceDetail>

  listPayments(
    actor: SchoolBillingActor,
    filter?: { invoiceId?: string },
  ): Promise<PaymentRecord[]>
  getPaymentForSchool(
    actor: SchoolBillingActor,
    paymentId: string,
  ): Promise<PaymentDetail | null>
  listPendingPayments(actor: PlatformBillingActor): Promise<PaymentDetail[]>
  listVerifiedPayments(actor: PlatformBillingActor): Promise<PaymentDetail[]>
  getPaymentForPlatform(
    actor: PlatformBillingActor,
    paymentId: string,
  ): Promise<PaymentDetail | null>
  findPaymentByIdempotencyKey(
    schoolId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null>
  findPaymentByProviderReference(
    providerReference: string,
  ): Promise<PaymentRecord | null>

  createOnlinePayment(
    actor: SchoolBillingActor,
    input: OnlinePaymentInput,
    audit: BillingAuditContext,
  ): Promise<PaymentRecord>
  attachProviderReference(
    paymentId: string,
    providerReference: string,
    audit: BillingAuditContext,
  ): Promise<PaymentRecord>
  failPayment(
    paymentId: string,
    reason: string,
    audit: BillingAuditContext,
  ): Promise<void>

  createManualPayment(
    actor: SchoolBillingActor,
    input: ManualPaymentInput,
    audit: BillingAuditContext,
  ): Promise<PaymentDetail>

  verifyManualPayment(
    actor: PlatformBillingActor,
    paymentId: string,
    input: VerifyManualPaymentInput,
    audit: BillingAuditContext,
  ): Promise<PaymentVerificationResult>
  applyOnlinePayment(
    paymentId: string,
    input: { amountMinor: number; currency: string; providerReference: string },
    audit: BillingAuditContext,
  ): Promise<PaymentVerificationResult>

  beginProviderEvent(
    input: ProviderEventInput,
  ): Promise<ProviderEventRecord | null>
  completeProviderEvent(
    eventId: string,
    input: { outcome: string; schoolId?: string | null; paymentId?: string | null },
  ): Promise<void>

  listAuditHistory(filter: {
    schoolId?: string
    invoiceId?: string
    paymentId?: string
  }): Promise<BillingAuditRecord[]>
}
