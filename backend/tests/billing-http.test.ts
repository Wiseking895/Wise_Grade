import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import { MemoryStorageAdapter } from '../src/storage/storage.js'
import {
  MockPaymentProvider,
  signMockWebhook,
} from '../src/billing/provider.js'
import { dateOnly, todayUtc } from '../src/billing/domain.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeBillingRepository } from './helpers/fake-billing-repository.js'
import { tinyPng } from './helpers/png.js'

const WEBHOOK_SECRET = 'phase6a-test-webhook-secret'
const SCHOOL_NAME = 'Green Valley Academy'

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`
}

function today(): string {
  return dateOnly(todayUtc())
}

describe('Phase 6A billing HTTP routes', () => {
  let auth: FakeAuthRepository
  let billing: FakeBillingRepository
  let storage: MemoryStorageAdapter
  let provider: MockPaymentProvider
  let app: ReturnType<typeof createApp>
  let adminAgent: ReturnType<typeof request.agent>
  let otherAgent: ReturnType<typeof request.agent>
  let schoolA: string
  let schoolB: string
  let yearId: string
  let termId: string
  let adminToken: string
  let otherToken: string
  let platformToken: string
  let platformUserId: string

  beforeEach(async () => {
    auth = new FakeAuthRepository()
    billing = new FakeBillingRepository()
    storage = new MemoryStorageAdapter()
    provider = new MockPaymentProvider({
      webhookSecret: WEBHOOK_SECRET,
      maxSkewSeconds: 300,
    })
    app = createApp({
      authRepository: auth,
      billingRepository: billing,
      billingStorage: storage,
      paymentProvider: provider,
    })

    adminAgent = request.agent(app)
    otherAgent = request.agent(app)

    const registrationA = await adminAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: SCHOOL_NAME,
          email: 'billing-admin-a@example.com',
        }),
      )
    const registrationB = await otherAgent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(
        registrationBody({
          schoolName: 'Blue Ridge College',
          email: 'billing-admin-b@example.com',
        }),
      )

    expect(registrationA.status).toBe(201)
    expect(registrationB.status).toBe(201)

    schoolA = registrationA.body.data.school.id
    schoolB = registrationB.body.data.school.id
    adminToken = await auth.issueSessionFor(registrationA.body.data.user.id)
    otherToken = await auth.issueSessionFor(registrationB.body.data.user.id)

    const platformUser = await auth.createUser({
      email: 'platform-billing@example.com',
      password: TEST_PASSWORD,
      firstName: 'Platform',
      lastName: 'Admin',
      isPlatformAdmin: true,
    })
    platformUserId = platformUser.id
    platformToken = await auth.issueSessionFor(platformUser.id)

    yearId = randomUUID()
    termId = randomUUID()

    billing.setBillablePupils(
      {
        schoolId: schoolA,
        schoolName: SCHOOL_NAME,
        academicYearId: yearId,
        academicYearName: '2026 Academic Year',
        academicTermId: termId,
        academicTermName: 'Term 1',
        academicTermSequence: 1,
      },
      [
        {
          pupilId: 'pupil-1',
          reportCardId: 'card-1-v1',
          reportVersion: 1,
          pupilName: 'Ama Mensah',
          admissionNumber: 'ADM-001',
          classId: 'class-1',
          className: 'JHS 1',
        },
        {
          // A second report version for the same pupil must not be billed twice.
          pupilId: 'pupil-1',
          reportCardId: 'card-1-v2',
          reportVersion: 2,
          pupilName: 'Ama Mensah',
          admissionNumber: 'ADM-001',
          classId: 'class-1',
          className: 'JHS 1',
        },
        {
          pupilId: 'pupil-2',
          reportCardId: 'card-2-v1',
          reportVersion: 1,
          pupilName: 'Kofi Owusu',
          admissionNumber: 'ADM-002',
          classId: 'class-1',
          className: 'JHS 1',
        },
        {
          pupilId: 'pupil-3',
          reportCardId: 'card-3-v1',
          reportVersion: 1,
          pupilName: 'Akosua Boateng',
          admissionNumber: 'ADM-003',
          classId: 'class-1',
          className: 'JHS 1',
        },
      ],
    )
  })

  function asSchool(
    method: 'get' | 'post' | 'patch',
    url: string,
    token = adminToken,
  ) {
    const agent = request(app)[method](url).set('Cookie', cookie(token))
    return method === 'get' ? agent : agent.set('Origin', TEST_ORIGIN)
  }

  function asPlatform(
    method: 'get' | 'post' | 'patch',
    url: string,
    token = platformToken,
  ) {
    const agent = request(app)[method](url).set('Cookie', cookie(token))
    return method === 'get' ? agent : agent.set('Origin', TEST_ORIGIN)
  }

  async function createPricingRule(amountMinor = 500, effectiveFrom = '2020-01-01') {
    return asPlatform('post', '/api/platform/billing/pricing-rules').send({
      currency: 'GHS',
      amountMinor,
      effectiveFrom,
    })
  }

  async function createInvoice(overrides: Record<string, unknown> = {}) {
    return asPlatform('post', '/api/platform/billing/invoices').send({
      schoolId: schoolA,
      academicYearId: yearId,
      academicTermId: termId,
      ...overrides,
    })
  }

  async function createIssuedInvoice(amountMinor = 500) {
    const pricing = await createPricingRule(amountMinor)
    expect(pricing.status).toBe(201)

    const created = await createInvoice()
    expect(created.status).toBe(201)

    const issued = await asPlatform(
      'post',
      `/api/platform/billing/invoices/${created.body.data.invoice.id}/issue`,
    ).send({})
    expect(issued.status).toBe(200)

    return issued.body.data as {
      invoice: {
        id: string
        invoiceNumber: string
        totalMinor: number
        paidMinor: number
        outstandingMinor: number
        status: string
      }
    }
  }

  async function submitManual(
    invoiceId: string,
    overrides: Record<string, unknown> = {},
    token = adminToken,
  ) {
    return asSchool(
      'post',
      `/api/schools/${schoolA}/billing/invoices/${invoiceId}/payments/manual`,
      token,
    ).send({
      amountMinor: 500,
      currency: 'GHS',
      method: 'BANK_TRANSFER',
      paymentReference: `REF-${randomUUID()}`,
      paidAt: today(),
      payerName: 'Ama Mensah',
      evidence: {
        mimeType: 'image/png',
        originalName: 'receipt.png',
        base64: tinyPng(2).toString('base64'),
      },
      ...overrides,
    })
  }

  function webhookRequest(payload: unknown, signature?: string, timestamp?: string) {
    const rawBody = JSON.stringify(payload)
    const ts = timestamp ?? String(Math.floor(Date.now() / 1000))
    const sig =
      signature ??
      signMockWebhook({
        webhookSecret: WEBHOOK_SECRET,
        timestamp: ts,
        rawBody,
      })

    return request(app)
      .post('/api/webhooks/payments/mock')
      .set('Content-Type', 'application/json')
      .set('x-gradely-timestamp', ts)
      .set('x-gradely-signature', sig)
      .send(rawBody)
  }

  describe('platform pricing and invoice creation', () => {
    it('restricts pricing management to platform administrators', async () => {
      const denied = await asSchool(
        'post',
        '/api/platform/billing/pricing-rules',
      ).send({
        currency: 'GHS',
        amountMinor: 500,
        effectiveFrom: '2020-01-01',
      })

      expect(denied.status).toBe(403)

      const anonymous = await request(app)
        .get('/api/platform/billing/pricing-rules')
      expect(anonymous.status).toBe(401)
    })

    it('creates versioned pricing and only allows platform admins to deactivate it', async () => {
      const first = await createPricingRule(500, '2020-01-01')
      expect(first.status).toBe(201)
      expect(first.body.data.rule).toMatchObject({
        amountMinor: 500,
        version: 1,
        isActive: true,
        currency: 'GHS',
      })

      const second = await createPricingRule(700, '2021-01-01')
      expect(second.status).toBe(201)
      expect(second.body.data.rule.version).toBe(2)

      const rules = await asPlatform('get', '/api/platform/billing/pricing-rules')
      expect(rules.status).toBe(200)
      expect(rules.body.data.rules).toHaveLength(2)

      const firstRule = rules.body.data.rules.find(
        (rule: { version: number }) => rule.version === 1,
      )
      expect(firstRule.effectiveTo.slice(0, 10)).toBe('2020-12-31')

      const deactivated = await asPlatform(
        'patch',
        `/api/platform/billing/pricing-rules/${second.body.data.rule.id}`,
      ).send({ isActive: false })
      expect(deactivated.status).toBe(200)
      expect(deactivated.body.data.rule.isActive).toBe(false)

      const schoolDenied = await asSchool(
        'patch',
        `/api/platform/billing/pricing-rules/${second.body.data.rule.id}`,
      ).send({ isActive: true })
      expect(schoolDenied.status).toBe(403)
    })

    it('lists schools with calendar scopes for invoice creation', async () => {
      const response = await asPlatform('get', '/api/platform/billing/schools')

      expect(response.status).toBe(200)
      expect(response.body.data.schools).toHaveLength(1)
      expect(response.body.data.schools[0]).toMatchObject({
        id: schoolA,
        name: SCHOOL_NAME,
      })
      expect(response.body.data.schools[0].academicYears[0].terms[0]).toMatchObject({
        id: termId,
        name: 'Term 1',
        sequence: 1,
      })
    })

    it('bills unique eligible pupils once and calculates totals on the backend', async () => {
      await createPricingRule(500)
      const created = await createInvoice()

      expect(created.status).toBe(201)
      expect(created.body.data.reusedDraft).toBe(false)
      expect(created.body.data.invoice).toMatchObject({
        status: 'DRAFT',
        unitAmountMinor: 500,
        billablePupilCount: 3,
        subtotalMinor: 1500,
        adjustmentMinor: 0,
        totalMinor: 1500,
        paidMinor: 0,
        outstandingMinor: 1500,
        currency: 'GHS',
      })
      expect(created.body.data.pupils).toHaveLength(3)
      expect(
        created.body.data.pupils.filter(
          (pupil: { pupilId: string }) => pupil.pupilId === 'pupil-1',
        ),
      ).toHaveLength(1)
      expect(created.body.data.lines[0]).toMatchObject({
        kind: 'PUPIL_CHARGE',
        quantity: 3,
        unitAmountMinor: 500,
        amountMinor: 1500,
      })
      expect(created.body.data.invoice.snapshot.price.amountMinor).toBe(500)
      expect(created.body.data.invoice.snapshot.billablePopulation.count).toBe(3)
    })

    it('reuses an existing draft instead of creating a duplicate invoice', async () => {
      await createPricingRule(500)
      const first = await createInvoice()
      const second = await createInvoice()

      expect(first.status).toBe(201)
      expect(second.status).toBe(200)
      expect(second.body.data.reusedDraft).toBe(true)
      expect(second.body.data.invoice.id).toBe(first.body.data.invoice.id)
      expect(billing.invoices).toHaveLength(1)
    })

    it('requires an adjustment reason and a positive total', async () => {
      await createPricingRule(500)

      const missingReason = await createInvoice({ adjustmentMinor: -100 })
      expect(missingReason.status).toBe(400)
      expect(missingReason.body.error.message).toMatch(/adjustment reason/i)

      const negativeTotal = await createInvoice({
        adjustmentMinor: -2000,
        adjustmentReason: 'Invalid credit',
      })
      expect(negativeTotal.status).toBe(400)
      expect(negativeTotal.body.error.message).toMatch(/greater than zero/i)

      const adjusted = await createInvoice({
        adjustmentMinor: -100,
        adjustmentReason: 'Sibling discount',
      })
      expect(adjusted.status).toBe(201)
      expect(adjusted.body.data.invoice.totalMinor).toBe(1400)
      expect(adjusted.body.data.lines).toHaveLength(2)
    })

    it('rejects a term that does not belong to the selected school', async () => {
      await createPricingRule(500)
      const response = await createInvoice({ schoolId: schoolB })

      expect(response.status).toBe(400)
      expect(response.body.error.message).toMatch(/must belong to this school/i)
    })
  })

  describe('invoice transitions and immutability', () => {
    it('issues a draft and rejects recalculating an issued invoice', async () => {
      await createPricingRule(500)
      const created = await createInvoice()
      const invoiceId = created.body.data.invoice.id

      const issued = await asPlatform(
        'post',
        `/api/platform/billing/invoices/${invoiceId}/issue`,
      ).send({})
      expect(issued.status).toBe(200)
      expect(issued.body.data.invoice.status).toBe('ISSUED')
      expect(issued.body.data.invoice.issuedAt).toBeTruthy()

      const recalculated = await createInvoice()
      expect(recalculated.status).toBe(409)
      expect(recalculated.body.error.message).toMatch(/immutable/i)

      const reissued = await asPlatform(
        'post',
        `/api/platform/billing/invoices/${invoiceId}/issue`,
      ).send({})
      expect(reissued.status).toBe(409)
    })

    it('cancels an unpaid issued invoice and refuses further payment', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id

      const cancelled = await asPlatform(
        'post',
        `/api/platform/billing/invoices/${invoiceId}/cancel`,
      ).send({})
      expect(cancelled.status).toBe(200)
      expect(cancelled.body.data.invoice.status).toBe('CANCELLED')

      const payment = await submitManual(invoiceId)
      expect(payment.status).toBe(409)
    })

    it('does not allow a school administrator to issue or cancel invoices', async () => {
      await createPricingRule(500)
      const created = await createInvoice()
      const invoiceId = created.body.data.invoice.id

      const issue = await asSchool(
        'post',
        `/api/platform/billing/invoices/${invoiceId}/issue`,
      ).send({})
      expect(issue.status).toBe(403)

      const cancel = await asSchool(
        'post',
        `/api/platform/billing/invoices/${invoiceId}/cancel`,
      ).send({})
      expect(cancel.status).toBe(403)
    })
  })

  describe('school billing visibility and tenant isolation', () => {
    it('shows invoices and audit history only to the owning school', async () => {
      const issued = await createIssuedInvoice()

      const own = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices`,
      )
      expect(own.status).toBe(200)
      expect(own.body.data.invoices).toHaveLength(1)
      expect(own.body.data.onlinePaymentsEnabled).toBe(true)
      expect(own.body.data.provider).toBe('mock')

      const other = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices`,
        otherToken,
      )
      expect(other.status).toBe(403)

      const crossInvoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}`,
        otherToken,
      )
      expect(crossInvoice.status).toBe(403)

      const audit = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/audit`,
      )
      expect(audit.status).toBe(200)
      expect(
        audit.body.data.audit.map((entry: { action: string }) => entry.action),
      ).toEqual(
        expect.arrayContaining(['INVOICE_DRAFT_CREATED', 'INVOICE_ISSUED']),
      )

      const anonymous = await request(app).get(
        `/api/schools/${schoolA}/billing/invoices`,
      )
      expect(anonymous.status).toBe(401)
    })

    it('rejects a non-admin school member from billing routes', async () => {
      const teacher = await auth.createUser({
        email: 'billing-teacher@example.com',
        password: TEST_PASSWORD,
      })
      await auth.addMembership(teacher.id, schoolA, 'CLASS_TEACHER')
      const teacherToken = await auth.issueSessionFor(teacher.id)

      const response = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices`,
        teacherToken,
      )
      expect(response.status).toBe(403)
    })
  })

  describe('manual payments and verification', () => {
    it('submits evidence without settling the invoice and verifies partially', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id
      const png = tinyPng(4)

      const submitted = await submitManual(invoiceId, {
        amountMinor: 500,
        evidence: {
          mimeType: 'image/png',
          originalName: 'bank-slip.png',
          base64: png.toString('base64'),
        },
      })

      expect(submitted.status).toBe(201)
      expect(submitted.body.data.payment).toMatchObject({
        status: 'PENDING',
        amountMinor: 500,
        appliedMinor: 0,
        overpaymentMinor: 0,
        source: 'MANUAL',
        currency: 'GHS',
      })
      expect(submitted.body.data.payment.evidence).toHaveLength(1)
      expect(submitted.body.data.payment.evidence[0].storageKey).toBe('[private]')

      // Submission is not settlement: the invoice is unchanged.
      const afterSubmit = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}`,
      )
      expect(afterSubmit.body.data.invoice).toMatchObject({
        status: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: 1500,
      })

      // Evidence bytes are stored privately and served only through authorized routes.
      const evidenceRow = billing.evidence[0]
      expect(evidenceRow).toBeDefined()
      expect(storage.has(evidenceRow!.storageKey)).toBe(true)
      const evidenceId = submitted.body.data.payment.evidence[0].id
      const paymentId = submitted.body.data.payment.id

      const schoolEvidence = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/payments/${paymentId}/evidence/${evidenceId}`,
      )
      expect(schoolEvidence.status).toBe(200)
      expect(schoolEvidence.headers['content-type']).toContain('image/png')
      expect(schoolEvidence.headers['cache-control']).toBe('private, no-store')
      expect(Buffer.from(schoolEvidence.body).subarray(0, 8)).toEqual(
        png.subarray(0, 8),
      )

      const crossSchoolEvidence = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/payments/${paymentId}/evidence/${evidenceId}`,
        otherToken,
      )
      expect(crossSchoolEvidence.status).toBe(403)

      const pending = await asPlatform(
        'get',
        '/api/platform/billing/payments/pending',
      )
      expect(pending.status).toBe(200)
      expect(pending.body.data.payments).toHaveLength(1)

      const platformEvidence = await asPlatform(
        'get',
        `/api/platform/billing/payments/${paymentId}/evidence/${evidenceId}`,
      )
      expect(platformEvidence.status).toBe(200)

      const schoolVerify = await asSchool(
        'post',
        `/api/platform/billing/payments/${paymentId}/verify`,
      ).send({ decision: 'VERIFIED' })
      expect(schoolVerify.status).toBe(403)

      const verified = await asPlatform(
        'post',
        `/api/platform/billing/payments/${paymentId}/verify`,
      ).send({ decision: 'VERIFIED', reason: 'Bank statement matched' })

      expect(verified.status).toBe(200)
      expect(verified.body.data.payment).toMatchObject({
        status: 'VERIFIED',
        appliedMinor: 500,
        overpaymentMinor: 0,
        verifiedByUserId: platformUserId,
      })
      expect(verified.body.data.invoice).toMatchObject({
        status: 'PARTIALLY_PAID',
        paidMinor: 500,
        outstandingMinor: 1000,
      })

      const verifiedList = await asPlatform(
        'get',
        '/api/platform/billing/payments/verified',
      )
      expect(verifiedList.body.data.payments).toHaveLength(1)

      const audit = await asPlatform(
        'get',
        `/api/platform/billing/audit?invoiceId=${invoiceId}`,
      )
      const verifiedAudit = audit.body.data.audit.find(
        (entry: { action: string }) => entry.action === 'MANUAL_PAYMENT_VERIFIED',
      )
      expect(verifiedAudit).toBeTruthy()
      expect(verifiedAudit.metadata.releaseBoundary).toMatch(
        /report cards remain internal drafts/i,
      )
    })

    it('rejects a manual payment with a required reason and leaves billing unchanged', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id
      const submitted = await submitManual(invoiceId)
      expect(submitted.status).toBe(201)
      const paymentId = submitted.body.data.payment.id

      const missingReason = await asPlatform(
        'post',
        `/api/platform/billing/payments/${paymentId}/verify`,
      ).send({ decision: 'REJECTED' })
      expect(missingReason.status).toBe(400)
      expect(missingReason.body.error.message).toBe('Validation failed')
      expect(missingReason.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'reason',
            message: expect.stringMatching(/rejection reason/i),
          }),
        ]),
      )

      const rejected = await asPlatform(
        'post',
        `/api/platform/billing/payments/${paymentId}/verify`,
      ).send({ decision: 'REJECTED', reason: 'Reference not found on statement' })
      expect(rejected.status).toBe(200)
      expect(rejected.body.data.payment.status).toBe('REJECTED')
      expect(rejected.body.data.payment.rejectionReason).toBe(
        'Reference not found on statement',
      )
      expect(rejected.body.data.invoice).toMatchObject({
        status: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: 1500,
      })
    })

    it('caps application at the outstanding balance and records overpayment explicitly', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id
      const submitted = await submitManual(invoiceId, { amountMinor: 2000 })
      expect(submitted.status).toBe(201)

      const verified = await asPlatform(
        'post',
        `/api/platform/billing/payments/${submitted.body.data.payment.id}/verify`,
      ).send({ decision: 'VERIFIED' })

      expect(verified.status).toBe(200)
      expect(verified.body.data.payment).toMatchObject({
        status: 'VERIFIED',
        amountMinor: 2000,
        appliedMinor: 1500,
        overpaymentMinor: 500,
      })
      expect(verified.body.data.invoice).toMatchObject({
        status: 'PAID',
        paidMinor: 1500,
        outstandingMinor: 0,
      })

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}`,
      )
      expect(invoice.body.data.invoice.outstandingMinor).toBe(0)
      expect(invoice.body.data.invoice.paidMinor).toBeLessThanOrEqual(
        invoice.body.data.invoice.totalMinor,
      )
    })

    it('completes an invoice through two partial payments and marks it paid only after full settlement', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id

      const first = await submitManual(invoiceId, { amountMinor: 500 })
      const firstVerified = await asPlatform(
        'post',
        `/api/platform/billing/payments/${first.body.data.payment.id}/verify`,
      ).send({ decision: 'VERIFIED' })
      expect(firstVerified.body.data.invoice.status).toBe('PARTIALLY_PAID')

      const second = await submitManual(invoiceId, { amountMinor: 1000 })
      const secondVerified = await asPlatform(
        'post',
        `/api/platform/billing/payments/${second.body.data.payment.id}/verify`,
      ).send({ decision: 'VERIFIED' })
      expect(secondVerified.body.data.invoice).toMatchObject({
        status: 'PAID',
        paidMinor: 1500,
        outstandingMinor: 0,
      })
    })

    it('refuses to verify the same manual payment twice', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id
      const submitted = await submitManual(invoiceId, { amountMinor: 500 })
      const paymentId = submitted.body.data.payment.id

      const first = await asPlatform(
        'post',
        `/api/platform/billing/payments/${paymentId}/verify`,
      ).send({ decision: 'VERIFIED' })
      expect(first.status).toBe(200)

      const second = await asPlatform(
        'post',
        `/api/platform/billing/payments/${paymentId}/verify`,
      ).send({ decision: 'VERIFIED' })
      expect(second.status).toBe(409)
      expect(second.body.error.message).toMatch(/no longer awaiting verification/i)

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}`,
      )
      expect(invoice.body.data.invoice).toMatchObject({
        status: 'PARTIALLY_PAID',
        paidMinor: 500,
        outstandingMinor: 1000,
      })
    })

    it('prevents a submitter from verifying their own payment', async () => {
      await auth.addMembership(platformUserId, schoolA, 'SCHOOL_ADMIN')
      const issued = await createIssuedInvoice()
      const submitted = await submitManual(
        issued.invoice.id,
        {},
        platformToken,
      )
      expect(submitted.status).toBe(201)

      const selfVerify = await asPlatform(
        'post',
        `/api/platform/billing/payments/${submitted.body.data.payment.id}/verify`,
      ).send({ decision: 'VERIFIED' })
      expect(selfVerify.status).toBe(403)
      expect(selfVerify.body.error.message).toMatch(/cannot be verified by its submitter/i)
    })

    it('validates payment input and rejects duplicate references', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id
      const reference = `REF-${randomUUID()}`

      const wrongCurrency = await submitManual(invoiceId, {
        currency: 'USD',
        paymentReference: reference,
      })
      expect(wrongCurrency.status).toBe(400)

      const future = await submitManual(invoiceId, {
        paidAt: '2999-01-01',
      })
      expect(future.status).toBe(400)
      expect(future.body.error.message).toMatch(/future/i)

      const first = await submitManual(invoiceId, { paymentReference: reference })
      expect(first.status).toBe(201)

      const duplicate = await submitManual(invoiceId, {
        paymentReference: reference,
      })
      expect(duplicate.status).toBe(409)

      const badEvidence = await submitManual(invoiceId, {
        evidence: {
          mimeType: 'image/png',
          originalName: 'not-a-png.png',
          base64: Buffer.from('plain text').toString('base64'),
        },
      })
      expect(badEvidence.status).toBe(400)
      expect(badEvidence.body.error.message).toMatch(/declared file type/i)

      const noEvidence = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}/payments/manual`,
      ).send({
        amountMinor: 100,
        currency: 'GHS',
        method: 'BANK_TRANSFER',
        paymentReference: `REF-${randomUUID()}`,
        paidAt: today(),
      })
      expect(noEvidence.status).toBe(400)
      expect(noEvidence.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'evidence' }),
        ]),
      )
    })

    it('does not accept manual payments against a draft invoice', async () => {
      await createPricingRule(500)
      const created = await createInvoice()

      const response = await submitManual(created.body.data.invoice.id)
      expect(response.status).toBe(409)
    })
  })

  describe('online payments and provider webhooks', () => {
    it('initiates a payment server-side and settles it only after a signed webhook', async () => {
      const issued = await createIssuedInvoice()
      const invoiceId = issued.invoice.id
      const idempotencyKey = `idem-${randomUUID()}`

      const initiated = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}/payments/online`,
      ).send({ idempotencyKey, method: 'MOBILE_MONEY' })

      expect(initiated.status).toBe(201)
      expect(initiated.body.data.reused).toBe(false)
      expect(initiated.body.data.payment).toMatchObject({
        status: 'PENDING',
        source: 'ONLINE',
        amountMinor: 1500,
        currency: 'GHS',
        provider: 'mock',
      })

      const afterInitiate = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}`,
      )
      expect(afterInitiate.body.data.invoice).toMatchObject({
        status: 'ISSUED',
        paidMinor: 0,
      })

      const reused = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}/payments/online`,
      ).send({ idempotencyKey, method: 'MOBILE_MONEY' })
      expect(reused.status).toBe(201)
      expect(reused.body.data.reused).toBe(true)
      expect(reused.body.data.payment.id).toBe(initiated.body.data.payment.id)

      const payment = initiated.body.data.payment
      const eventId = `evt-${randomUUID()}`
      const payload = {
        id: eventId,
        type: 'PAYMENT_SUCCEEDED',
        data: {
          providerReference: payment.providerReference,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          invoiceNumber: issued.invoice.invoiceNumber,
          schoolId: schoolA,
        },
      }

      const webhook = await webhookRequest(payload)
      expect(webhook.status).toBe(200)
      expect(webhook.body.data.status).toBe('processed')
      expect(webhook.body.data.paymentId).toBe(payment.id)

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}`,
      )
      expect(invoice.body.data.invoice).toMatchObject({
        status: 'PAID',
        paidMinor: 1500,
        outstandingMinor: 0,
      })

      const duplicate = await webhookRequest(payload)
      expect(duplicate.status).toBe(200)
      expect(duplicate.body.data.status).toBe('duplicate')

      const stillPaid = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${invoiceId}`,
      )
      expect(stillPaid.body.data.invoice.paidMinor).toBe(1500)
    })

    it('marks an online payment failed without changing the invoice', async () => {
      const issued = await createIssuedInvoice()
      const initiated = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/online`,
      ).send({ idempotencyKey: `idem-${randomUUID()}`, method: 'CARD' })
      expect(initiated.status).toBe(201)

      const payment = initiated.body.data.payment
      const webhook = await webhookRequest({
        id: `evt-${randomUUID()}`,
        type: 'PAYMENT_FAILED',
        data: {
          providerReference: payment.providerReference,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        },
      })

      expect(webhook.status).toBe(200)
      expect(webhook.body.data.status).toBe('processed')

      const detail = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/payments/${payment.id}`,
      )
      expect(detail.body.data.payment.status).toBe('FAILED')

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}`,
      )
      expect(invoice.body.data.invoice).toMatchObject({
        status: 'ISSUED',
        paidMinor: 0,
      })
    })

    it('rejects unsigned, incorrectly signed and unknown-provider webhooks', async () => {
      const issued = await createIssuedInvoice()
      const initiated = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/online`,
      ).send({ idempotencyKey: `idem-${randomUUID()}`, method: 'MOBILE_MONEY' })

      const payload = {
        id: `evt-${randomUUID()}`,
        type: 'PAYMENT_SUCCEEDED',
        data: {
          providerReference: initiated.body.data.payment.providerReference,
          amountMinor: initiated.body.data.payment.amountMinor,
          currency: 'GHS',
        },
      }

      const unsigned = await request(app)
        .post('/api/webhooks/payments/mock')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload))
      expect(unsigned.status).toBe(401)

      const badSignature = await webhookRequest(payload, 'sha256=deadbeef')
      expect(badSignature.status).toBe(401)

      const unknownProvider = await request(app)
        .post('/api/webhooks/payments/unknown')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload))
      expect(unknownProvider.status).toBe(404)

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}`,
      )
      expect(invoice.body.data.invoice.paidMinor).toBe(0)
    })

    it('rejects a webhook whose amount does not match the payment', async () => {
      const issued = await createIssuedInvoice()
      const initiated = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/online`,
      ).send({ idempotencyKey: `idem-${randomUUID()}`, method: 'MOBILE_MONEY' })

      const webhook = await webhookRequest({
        id: `evt-${randomUUID()}`,
        type: 'PAYMENT_SUCCEEDED',
        data: {
          providerReference: initiated.body.data.payment.providerReference,
          amountMinor: 1,
          currency: 'GHS',
        },
      })

      expect(webhook.status).toBe(400)
      expect(webhook.body.error.message).toMatch(/amount does not match/i)

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}`,
      )
      expect(invoice.body.data.invoice.paidMinor).toBe(0)
    })

    it('rejects webhook currency and school mismatches without settling', async () => {
      const issued = await createIssuedInvoice()
      const initiated = await asSchool(
        'post',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/online`,
      ).send({ idempotencyKey: `idem-${randomUUID()}`, method: 'MOBILE_MONEY' })

      const payment = initiated.body.data.payment

      const wrongCurrency = await webhookRequest({
        id: `evt-${randomUUID()}`,
        type: 'PAYMENT_SUCCEEDED',
        data: {
          providerReference: payment.providerReference,
          amountMinor: payment.amountMinor,
          currency: 'USD',
        },
      })
      expect(wrongCurrency.status).toBe(400)
      expect(wrongCurrency.body.error.message).toMatch(/currency does not match/i)

      const wrongSchool = await webhookRequest({
        id: `evt-${randomUUID()}`,
        type: 'PAYMENT_SUCCEEDED',
        data: {
          providerReference: payment.providerReference,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          schoolId: randomUUID(),
        },
      })
      expect(wrongSchool.status).toBe(400)
      expect(wrongSchool.body.error.message).toMatch(/school does not match/i)

      const invoice = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}`,
      )
      expect(invoice.body.data.invoice).toMatchObject({
        status: 'ISSUED',
        paidMinor: 0,
        outstandingMinor: 1500,
      })

      const detail = await asSchool(
        'get',
        `/api/schools/${schoolA}/billing/payments/${payment.id}`,
      )
      expect(detail.body.data.payment.status).toBe('PENDING')
    })

    it('refuses online payments when no provider is configured', async () => {
      const appWithoutProvider = createApp({
        authRepository: auth,
        billingRepository: billing,
        billingStorage: storage,
        paymentProvider: null,
      })
      const issued = await createIssuedInvoice()

      const response = await request(appWithoutProvider)
        .post(
          `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/online`,
        )
        .set('Cookie', cookie(adminToken))
        .set('Origin', TEST_ORIGIN)
        .send({ idempotencyKey: `idem-${randomUUID()}` })

      expect(response.status).toBe(503)
      expect(response.body.error.message).toMatch(/not configured/i)
    })
  })

  describe('sensitive route rate limiting', () => {
    it('limits repeated manual payment submissions per actor', async () => {
      const limitedApp = createApp({
        authRepository: auth,
        billingRepository: billing,
        billingStorage: storage,
        paymentProvider: provider,
        billingRateLimits: {
          paymentRateLimit: { windowMs: 60_000, max: 1 },
          platformRateLimit: { windowMs: 60_000, max: 100 },
          webhookRateLimit: { windowMs: 60_000, max: 100 },
        },
      })
      const issued = await createIssuedInvoice()

      const first = await request(limitedApp)
        .post(
          `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/manual`,
        )
        .set('Cookie', cookie(adminToken))
        .set('Origin', TEST_ORIGIN)
        .send({
          amountMinor: 100,
          currency: 'GHS',
          method: 'CASH',
          paymentReference: `REF-${randomUUID()}`,
          paidAt: today(),
          evidence: {
            mimeType: 'image/png',
            originalName: 'receipt.png',
            base64: tinyPng(2).toString('base64'),
          },
        })
      expect(first.status).toBe(201)

      const second = await request(limitedApp)
        .post(
          `/api/schools/${schoolA}/billing/invoices/${issued.invoice.id}/payments/manual`,
        )
        .set('Cookie', cookie(adminToken))
        .set('Origin', TEST_ORIGIN)
        .send({
          amountMinor: 100,
          currency: 'GHS',
          method: 'CASH',
          paymentReference: `REF-${randomUUID()}`,
          paidAt: today(),
          evidence: {
            mimeType: 'image/png',
            originalName: 'receipt.png',
            base64: tinyPng(2).toString('base64'),
          },
        })

      expect(second.status).toBe(429)
      expect(second.headers['retry-after']).toBeTruthy()
    })
  })
})
