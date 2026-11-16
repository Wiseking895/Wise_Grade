import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'

export type ProviderEventType =
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_PENDING'

export interface ProviderCheckoutInput {
  paymentId: string
  paymentReference: string
  invoiceNumber: string
  schoolId: string
  amountMinor: number
  currency: string
  description: string
}

export interface ProviderCheckout {
  provider: string
  providerReference: string
  checkoutUrl: string | null
}

export interface ProviderWebhookEvent {
  eventId: string
  type: ProviderEventType
  providerReference: string
  amountMinor: number | null
  currency: string | null
  invoiceNumber: string | null
  schoolId: string | null
  receivedAt: Date
  rawPayload: unknown
}

export interface VerifyWebhookInput {
  rawBody: Buffer
  headers: Record<string, string | string[] | undefined>
}

/**
 * Provider-neutral boundary. A production provider must implement server-side
 * verification and signed webhook parsing. The application never trusts a
 * frontend redirect as proof of payment.
 */
export interface PaymentProvider {
  readonly name: string
  createCheckout(input: ProviderCheckoutInput): Promise<ProviderCheckout>
  verifyWebhook(input: VerifyWebhookInput): Promise<ProviderWebhookEvent>
}

export interface MockProviderOptions {
  webhookSecret: string
  checkoutBaseUrl?: string
  maxSkewSeconds?: number
}

const MOCK_EVENT_TYPES = new Set<ProviderEventType>([
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'PAYMENT_PENDING',
])

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function signMockWebhook(input: {
  webhookSecret: string
  timestamp: string
  rawBody: Buffer | string
}): string {
  const body = Buffer.isBuffer(input.rawBody)
    ? input.rawBody
    : Buffer.from(input.rawBody)
  const digest = createHmac('sha256', input.webhookSecret)
    .update(`${input.timestamp}.`)
    .update(body)
    .digest('hex')

  return `sha256=${digest}`
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Development-only mock provider. It produces a deterministic provider
 * reference and verifies HMAC-signed webhook bodies. It never claims that a
 * real payment occurred and is disabled in production by `fromEnvironment`.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock'
  private readonly maxSkewSeconds: number

  constructor(private readonly options: MockProviderOptions) {
    this.maxSkewSeconds = options.maxSkewSeconds ?? 300
  }

  async createCheckout(input: ProviderCheckoutInput): Promise<ProviderCheckout> {
    const providerReference = `mock_${input.paymentReference}`
    const base = this.options.checkoutBaseUrl?.replace(/\/+$/, '')

    return {
      provider: this.name,
      providerReference,
      checkoutUrl: base
        ? `${base}/mock-payments/${encodeURIComponent(providerReference)}`
        : null,
    }
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<ProviderWebhookEvent> {
    const timestamp = headerValue(input.headers, 'x-gradely-timestamp')
    const signature = headerValue(input.headers, 'x-gradely-signature')

    if (!timestamp || !signature) {
      throw new HttpError(401, 'Missing webhook signature')
    }

    const seconds = Number(timestamp)

    if (!Number.isFinite(seconds)) {
      throw new HttpError(401, 'Invalid webhook timestamp')
    }

    const nowSeconds = Math.floor(Date.now() / 1000)

    if (Math.abs(nowSeconds - seconds) > this.maxSkewSeconds) {
      throw new HttpError(401, 'Webhook timestamp is outside the allowed window')
    }

    const expected = signMockWebhook({
      webhookSecret: this.options.webhookSecret,
      timestamp,
      rawBody: input.rawBody,
    })
    const provided = signature.startsWith('sha256=')
      ? signature
      : `sha256=${signature}`

    if (!safeEqualHex(expected.slice('sha256='.length), provided.slice('sha256='.length))) {
      throw new HttpError(401, 'Invalid webhook signature')
    }

    let payload: unknown

    try {
      payload = JSON.parse(input.rawBody.toString('utf8'))
    } catch {
      throw new HttpError(400, 'Webhook payload is not valid JSON')
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new HttpError(400, 'Webhook payload is invalid')
    }

    const body = payload as Record<string, unknown>
    const data =
      typeof body.data === 'object' && body.data !== null
        ? (body.data as Record<string, unknown>)
        : null

    if (
      typeof body.id !== 'string' ||
      body.id.trim() === '' ||
      typeof body.type !== 'string' ||
      !MOCK_EVENT_TYPES.has(body.type as ProviderEventType) ||
      !data ||
      typeof data.providerReference !== 'string' ||
      data.providerReference.trim() === ''
    ) {
      throw new HttpError(400, 'Webhook payload is missing required fields')
    }

    return {
      eventId: body.id,
      type: body.type as ProviderEventType,
      providerReference: data.providerReference,
      amountMinor:
        typeof data.amountMinor === 'number' && Number.isInteger(data.amountMinor)
          ? data.amountMinor
          : null,
      currency: typeof data.currency === 'string' ? data.currency : null,
      invoiceNumber:
        typeof data.invoiceNumber === 'string' ? data.invoiceNumber : null,
      schoolId: typeof data.schoolId === 'string' ? data.schoolId : null,
      receivedAt: new Date(),
      rawPayload: payload,
    }
  }
}

export function paymentProviderFromEnvironment(): PaymentProvider | null {
  if (env.PAYMENT_PROVIDER !== 'mock') {
    return null
  }

  if (env.NODE_ENV === 'production') {
    // A development mock must never be silently active in production.
    return null
  }

  if (!env.PAYMENT_WEBHOOK_SECRET) {
    return null
  }

  return new MockPaymentProvider({
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
    checkoutBaseUrl: env.FRONTEND_URL,
  })
}
