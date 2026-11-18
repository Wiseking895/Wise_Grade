import {
  API_BASE_URL,
  API_CONFIGURATION_ERROR,
  ApiError,
  apiRequest,
} from '../lib/api'
import type {
  BillingAuditRecord,
  BillingSchoolScope,
  CreateInvoiceInput,
  CreateInvoiceResult,
  CreatePricingRuleInput,
  InvoiceDetail,
  InvoiceRecord,
  InvoiceStatus,
  ManualPaymentInput,
  OnlinePaymentResult,
  PaymentDetail,
  PaymentRecord,
  PaymentVerificationResult,
  PricingRule,
  SchoolInvoicesResult,
} from './types'

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
  }

  return params.size > 0 ? `?${params.toString()}` : ''
}

function schoolPath(schoolId: string, suffix = ''): string {
  return `/api/schools/${schoolId}/billing${suffix}`
}

async function fetchPrivateBlob(path: string, accept: string): Promise<Blob> {
  if (API_CONFIGURATION_ERROR) {
    throw new ApiError(0, API_CONFIGURATION_ERROR)
  }

  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: { Accept: accept },
    })
  } catch {
    throw new ApiError(
      0,
      'Could not reach the Wise Grade API. Check that the backend is running.',
    )
  }

  if (!response.ok) {
    const isJson = response.headers
      .get('content-type')
      ?.includes('application/json')
    const payload = isJson
      ? ((await response.json()) as {
          error?: { message?: string; details?: [] }
        })
      : null

    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details ?? [],
    )
  }

  return response.blob()
}

// ---------------------------------------------------------------------------
// School-scoped billing
// ---------------------------------------------------------------------------

export function listSchoolInvoices(schoolId: string) {
  return apiRequest<SchoolInvoicesResult>(
    schoolPath(schoolId, '/invoices'),
  )
}

export function getSchoolInvoice(schoolId: string, invoiceId: string) {
  return apiRequest<InvoiceDetail>(
    schoolPath(schoolId, `/invoices/${invoiceId}`),
  )
}

export function listSchoolPayments(
  schoolId: string,
  filter: { invoiceId?: string } = {},
) {
  return apiRequest<{ payments: PaymentRecord[] }>(
    schoolPath(
      schoolId,
      `/payments${queryString({ invoiceId: filter.invoiceId })}`,
    ),
  )
}

export function getSchoolPayment(schoolId: string, paymentId: string) {
  return apiRequest<{ payment: PaymentDetail }>(
    schoolPath(schoolId, `/payments/${paymentId}`),
  )
}

export function fetchSchoolPaymentEvidence(
  schoolId: string,
  paymentId: string,
  evidenceId: string,
) {
  return fetchPrivateBlob(
    schoolPath(
      schoolId,
      `/payments/${paymentId}/evidence/${evidenceId}`,
    ),
    '*/*',
  )
}

export function submitManualPayment(
  schoolId: string,
  invoiceId: string,
  input: ManualPaymentInput,
) {
  return apiRequest<{ payment: PaymentDetail }>(
    schoolPath(schoolId, `/invoices/${invoiceId}/payments/manual`),
    { method: 'POST', body: input },
  )
}

export function initiateOnlinePayment(
  schoolId: string,
  invoiceId: string,
  input: { idempotencyKey: string; method: 'MOBILE_MONEY' | 'CARD' },
) {
  return apiRequest<OnlinePaymentResult>(
    schoolPath(schoolId, `/invoices/${invoiceId}/payments/online`),
    { method: 'POST', body: input },
  )
}

// ---------------------------------------------------------------------------
// Platform-super-admin billing
// ---------------------------------------------------------------------------

export function listBillingSchools() {
  return apiRequest<{ schools: BillingSchoolScope[] }>(
    '/api/platform/billing/schools',
  )
}

export function listPricingRules() {
  return apiRequest<{ rules: PricingRule[] }>(
    '/api/platform/billing/pricing-rules',
  )
}

export function createPricingRule(
  input: CreatePricingRuleInput,
  reauthToken?: string,
) {
  return apiRequest<{ rule: PricingRule }>(
    '/api/platform/billing/pricing-rules',
    {
      method: 'POST',
      body: input,
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

export function setPricingRuleActive(
  ruleId: string,
  isActive: boolean,
  reauthToken?: string,
) {
  return apiRequest<{ rule: PricingRule }>(
    `/api/platform/billing/pricing-rules/${ruleId}`,
    {
      method: 'PATCH',
      body: { isActive },
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

export function listPlatformInvoices(
  filter: { status?: InvoiceStatus; schoolId?: string } = {},
) {
  return apiRequest<{ invoices: InvoiceRecord[] }>(
    `/api/platform/billing/invoices${queryString({
      status: filter.status,
      schoolId: filter.schoolId,
    })}`,
  )
}

export function getPlatformInvoice(invoiceId: string) {
  return apiRequest<InvoiceDetail>(
    `/api/platform/billing/invoices/${invoiceId}`,
  )
}

export function createInvoice(
  input: CreateInvoiceInput,
  reauthToken?: string,
) {
  return apiRequest<CreateInvoiceResult>('/api/platform/billing/invoices', {
    method: 'POST',
    body: input,
    headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
  })
}

export function issueInvoice(invoiceId: string, reauthToken?: string) {
  return apiRequest<InvoiceDetail>(
    `/api/platform/billing/invoices/${invoiceId}/issue`,
    {
      method: 'POST',
      body: {},
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

export function cancelInvoice(invoiceId: string, reauthToken?: string) {
  return apiRequest<InvoiceDetail>(
    `/api/platform/billing/invoices/${invoiceId}/cancel`,
    {
      method: 'POST',
      body: {},
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

export function listPendingPayments() {
  return apiRequest<{ payments: PaymentDetail[] }>(
    '/api/platform/billing/payments/pending',
  )
}

export function listVerifiedPayments() {
  return apiRequest<{ payments: PaymentDetail[] }>(
    '/api/platform/billing/payments/verified',
  )
}

export function getPlatformPayment(paymentId: string) {
  return apiRequest<{ payment: PaymentDetail }>(
    `/api/platform/billing/payments/${paymentId}`,
  )
}

export function fetchPlatformPaymentEvidence(
  paymentId: string,
  evidenceId: string,
) {
  return fetchPrivateBlob(
    `/api/platform/billing/payments/${paymentId}/evidence/${evidenceId}`,
    '*/*',
  )
}

export function verifyPayment(
  paymentId: string,
  input: { decision: 'VERIFIED' | 'REJECTED'; reason?: string | null },
  reauthToken?: string,
) {
  return apiRequest<PaymentVerificationResult>(
    `/api/platform/billing/payments/${paymentId}/verify`,
    {
      method: 'POST',
      body: input,
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

export function listBillingAudit(
  filter: { schoolId?: string; invoiceId?: string; paymentId?: string } = {},
) {
  return apiRequest<{ audit: BillingAuditRecord[] }>(
    `/api/platform/billing/audit${queryString({
      schoolId: filter.schoolId,
      invoiceId: filter.invoiceId,
      paymentId: filter.paymentId,
    })}`,
  )
}
