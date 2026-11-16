import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEnvFile } from '../../src/config/env-file.js'
import { PrismaClient } from '../../src/generated/prisma/client.js'
import type {
  BillingAuditContext,
  BillingRepository,
  PlatformBillingActor,
  SchoolBillingActor,
} from '../../src/billing/repository.js'
import { assertSafeIntegrationTarget } from './target.js'

/**
 * Live PostgreSQL billing reconciliation and concurrency suite.
 *
 * Safety rules are shared with the main integration suite:
 * - skipped unless TEST_DATABASE_URL is set
 * - refused in production, against DATABASE_URL itself, or without "test" in
 *   the database name
 * - deletes only the schools and users created by this file
 */

loadEnvFile(
  process.env.GRADELY_ENV_FILE ??
    fileURLToPath(new URL('../../.env', import.meta.url)),
)

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined
const runIntegration = testDatabaseUrl !== undefined

if (runIntegration) {
  assertSafeIntegrationTarget({
    testDatabaseUrl,
    databaseUrl: configuredDatabaseUrl,
    nodeEnv: process.env.NODE_ENV,
  })
}

describe.skipIf(!runIntegration)('PostgreSQL billing reconciliation', () => {
  let prisma: PrismaClient
  let repository: BillingRepository
  let platformUser: { id: string }
  let submitterUser: { id: string }

  const createdSchoolIds: string[] = []
  const createdUserIds: string[] = []
  let fixtureCounter = 0

  function nextSuffix(): string {
    fixtureCounter += 1
    return `${Date.now().toString(36)}-${fixtureCounter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
  }

  function audit(userId: string): BillingAuditContext {
    return {
      actorUserId: userId,
      actorMembershipId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'billing-integration-test',
    }
  }

  const verifier: PlatformBillingActor = {
    get userId() {
      return platformUser.id
    },
  }

  let currencySequence = 0

  /**
   * Two base-26 letters keep every fixture in a run on a distinct currency.
   * Pricing rules are unique per (currency, version) and (currency,
   * effectiveFrom), so a random currency could collide and fail the fixture
   * with a unique-constraint error unrelated to the behaviour under test.
   */
  function testCurrency(): string {
    currencySequence += 1
    const high = Math.floor(currencySequence / 26) % 26
    const low = currencySequence % 26

    return `T${String.fromCharCode(65 + high)}${String.fromCharCode(65 + low)}`
  }

  async function createFixture(options: { totalMinor: number }) {
    const suffix = nextSuffix()
    const currency = testCurrency()

    const school = await prisma.school.create({
      data: {
        name: `Billing IT ${suffix}`,
        slug: `billing-it-${suffix}`,
        email: `billing-${suffix}@gradely-integration.test`,
      },
    })
    createdSchoolIds.push(school.id)

    const year = await prisma.academicYear.create({
      data: {
        schoolId: school.id,
        name: `Year ${suffix}`,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-31T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    const term = await prisma.academicTerm.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        name: `Term ${suffix}`,
        sequence: 1,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-04-30T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    const membership = await prisma.schoolMembership.create({
      data: {
        schoolId: school.id,
        userId: submitterUser.id,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    })

    const pricingRule = await prisma.pricingRule.create({
      data: {
        currency,
        amountMinor: options.totalMinor,
        effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
        isActive: true,
        version: 1,
        createdByUserId: platformUser.id,
      },
    })

    const invoice = await prisma.schoolInvoice.create({
      data: {
        invoiceNumber: `INV-IT-${suffix}`,
        schoolId: school.id,
        academicYearId: year.id,
        academicTermId: term.id,
        pricingRuleId: pricingRule.id,
        currency,
        unitAmountMinor: options.totalMinor,
        billablePupilCount: 1,
        subtotalMinor: options.totalMinor,
        adjustmentMinor: 0,
        totalMinor: options.totalMinor,
        paidMinor: 0,
        outstandingMinor: options.totalMinor,
        status: 'ISSUED',
        issueDate: new Date('2026-11-01T00:00:00.000Z'),
        snapshot: { test: true },
        createdByUserId: platformUser.id,
      },
    })

    const schoolActor: SchoolBillingActor = {
      schoolId: school.id,
      userId: submitterUser.id,
      membershipId: membership.id,
      role: 'SCHOOL_ADMIN',
    }

    return { school, year, term, currency, invoice, schoolActor }
  }

  async function createManualPayment(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    amountMinor: number,
  ) {
    return prisma.payment.create({
      data: {
        schoolId: fixture.school.id,
        invoiceId: fixture.invoice.id,
        source: 'MANUAL',
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        amountMinor,
        currency: fixture.currency,
        paymentReference: `REF-${randomUUID()}`,
        paidAt: new Date('2026-11-01T00:00:00.000Z'),
        initiatedByUserId: submitterUser.id,
      },
    })
  }

  async function createOnlinePayment(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    amountMinor: number,
  ) {
    const providerReference = `mock-${randomUUID()}`
    const payment = await prisma.payment.create({
      data: {
        schoolId: fixture.school.id,
        invoiceId: fixture.invoice.id,
        source: 'ONLINE',
        method: 'MOBILE_MONEY',
        status: 'PENDING',
        amountMinor,
        currency: fixture.currency,
        paymentReference: `ONLINE-${randomUUID()}`,
        provider: 'mock',
        providerReference,
        idempotencyKey: randomUUID(),
        paidAt: new Date('2026-11-01T00:00:00.000Z'),
        initiatedByUserId: submitterUser.id,
      },
    })

    return { payment, providerReference }
  }

  async function readInvoice(invoiceId: string) {
    return prisma.schoolInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
  }

  async function readPayment(paymentId: string) {
    return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
  }

  beforeAll(async () => {
    assertSafeIntegrationTarget({
      testDatabaseUrl: testDatabaseUrl!,
      databaseUrl: configuredDatabaseUrl,
      nodeEnv: process.env.NODE_ENV,
    })

    process.env.DATABASE_URL = testDatabaseUrl!

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    })

    const suffix = nextSuffix()
    platformUser = await prisma.user.create({
      data: {
        email: `billing-platform-${suffix}@gradely-integration.test`,
        passwordHash: 'integration-test-only',
        firstName: 'Platform',
        lastName: 'Verifier',
        isPlatformAdmin: true,
      },
      select: { id: true },
    })
    submitterUser = await prisma.user.create({
      data: {
        email: `billing-submitter-${suffix}@gradely-integration.test`,
        passwordHash: 'integration-test-only',
        firstName: 'School',
        lastName: 'Submitter',
      },
      select: { id: true },
    })
    createdUserIds.push(platformUser.id, submitterUser.id)

    const { createPrismaBillingRepository } = await import(
      '../../src/billing/prisma-repository.js'
    )
    repository = createPrismaBillingRepository()
  }, 30_000)

  afterAll(async () => {
    if (!prisma) {
      return
    }

    try {
      if (createdSchoolIds.length > 0) {
        // Cascades invoices, payments, evidence, verifications and audit rows.
        await prisma.school.deleteMany({
          where: { id: { in: createdSchoolIds } },
        })
      }

      if (createdUserIds.length > 0) {
        await prisma.pricingRule.deleteMany({
          where: { createdByUserId: { in: createdUserIds } },
        })
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        })
      }
    } finally {
      await prisma.$disconnect()
    }
  }, 30_000)

  it('leaves the invoice unchanged for pending and rejected payments', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const pending = await createManualPayment(fixture, 500)

    let invoice = await readInvoice(fixture.invoice.id)
    expect(invoice).toMatchObject({
      status: 'ISSUED',
      paidMinor: 0,
      outstandingMinor: 1500,
    })

    const rejected = await repository.verifyManualPayment(
      verifier,
      pending.id,
      { decision: 'REJECTED', reason: 'Reference not found on statement' },
      audit(platformUser.id),
    )

    invoice = await readInvoice(fixture.invoice.id)
    expect(rejected.payment.status).toBe('REJECTED')
    expect(rejected.payment.appliedMinor).toBe(0)
    expect(invoice).toMatchObject({
      status: 'ISSUED',
      paidMinor: 0,
      outstandingMinor: 1500,
    })
  })

  it('moves an issued invoice through PARTIALLY_PAID to PAID on full settlement', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const first = await createManualPayment(fixture, 500)
    const second = await createManualPayment(fixture, 1000)

    const firstResult = await repository.verifyManualPayment(
      verifier,
      first.id,
      { decision: 'VERIFIED' },
      audit(platformUser.id),
    )
    expect(firstResult.payment.appliedMinor).toBe(500)
    expect(firstResult.invoice).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: 500,
      outstandingMinor: 1000,
    })

    const secondResult = await repository.verifyManualPayment(
      verifier,
      second.id,
      { decision: 'VERIFIED' },
      audit(platformUser.id),
    )
    expect(secondResult.payment.appliedMinor).toBe(1000)
    expect(secondResult.invoice).toMatchObject({
      status: 'PAID',
      paidMinor: 1500,
      outstandingMinor: 0,
    })
  })

  it('caps application at the outstanding balance and records overpayment', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const payment = await createManualPayment(fixture, 2000)

    const result = await repository.verifyManualPayment(
      verifier,
      payment.id,
      { decision: 'VERIFIED' },
      audit(platformUser.id),
    )

    expect(result.payment).toMatchObject({
      status: 'VERIFIED',
      amountMinor: 2000,
      appliedMinor: 1500,
      overpaymentMinor: 500,
    })
    expect(result.invoice).toMatchObject({
      status: 'PAID',
      paidMinor: 1500,
      outstandingMinor: 0,
    })
    expect(result.invoice.paidMinor).toBeLessThanOrEqual(
      result.invoice.totalMinor,
    )
  })

  it('applies a duplicate verification only once under concurrency', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const payment = await createManualPayment(fixture, 500)

    const outcomes = await Promise.allSettled([
      repository.verifyManualPayment(
        verifier,
        payment.id,
        { decision: 'VERIFIED' },
        audit(platformUser.id),
      ),
      repository.verifyManualPayment(
        verifier,
        payment.id,
        { decision: 'VERIFIED' },
        audit(platformUser.id),
      ),
    ])

    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const rejection = rejected[0] as PromiseRejectedResult
    expect(rejection.reason).toMatchObject({ statusCode: 409 })

    const invoice = await readInvoice(fixture.invoice.id)
    const storedPayment = await readPayment(payment.id)
    const verificationCount = await prisma.paymentVerification.count({
      where: { paymentId: payment.id },
    })

    expect(invoice).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: 500,
      outstandingMinor: 1000,
    })
    expect(storedPayment).toMatchObject({
      status: 'VERIFIED',
      appliedMinor: 500,
      overpaymentMinor: 0,
    })
    expect(verificationCount).toBe(1)
  })

  it('serializes concurrent payments on one invoice without losing or over-crediting money', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const first = await createManualPayment(fixture, 1000)
    const second = await createManualPayment(fixture, 1000)

    const outcomes = await Promise.allSettled([
      repository.verifyManualPayment(
        verifier,
        first.id,
        { decision: 'VERIFIED' },
        audit(platformUser.id),
      ),
      repository.verifyManualPayment(
        verifier,
        second.id,
        { decision: 'VERIFIED' },
        audit(platformUser.id),
      ),
    ])

    expect(outcomes.every((item) => item.status === 'fulfilled')).toBe(true)

    const invoice = await readInvoice(fixture.invoice.id)
    const payments = await prisma.payment.findMany({
      where: { invoiceId: fixture.invoice.id },
      orderBy: { appliedMinor: 'asc' },
    })

    expect(invoice).toMatchObject({
      status: 'PAID',
      paidMinor: 1500,
      outstandingMinor: 0,
    })
    expect(payments.map((payment) => payment.appliedMinor)).toEqual([500, 1000])
    expect(
      payments.map((payment) => payment.overpaymentMinor).sort((a, b) => a - b),
    ).toEqual([0, 500])
    expect(
      payments.reduce((sum, payment) => sum + payment.appliedMinor, 0),
    ).toBe(1500)
    expect(invoice.paidMinor).toBeLessThanOrEqual(invoice.totalMinor)
    expect(invoice.outstandingMinor).toBeGreaterThanOrEqual(0)
  })

  it('does not apply an online payment twice under concurrent callbacks', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const { payment, providerReference } = await createOnlinePayment(
      fixture,
      500,
    )
    const input = {
      amountMinor: 500,
      currency: fixture.currency,
      providerReference,
    }

    const outcomes = await Promise.allSettled([
      repository.applyOnlinePayment(
        payment.id,
        input,
        audit(platformUser.id),
      ),
      repository.applyOnlinePayment(
        payment.id,
        input,
        audit(platformUser.id),
      ),
    ])

    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    const rejected = outcomes.filter((item) => item.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
    })

    const invoice = await readInvoice(fixture.invoice.id)
    const storedPayment = await readPayment(payment.id)
    expect(invoice).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: 500,
      outstandingMinor: 1000,
    })
    expect(storedPayment).toMatchObject({
      status: 'VERIFIED',
      appliedMinor: 500,
    })
  })

  it('refuses new payment submissions and pending verification after cancellation', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const pending = await createManualPayment(fixture, 500)

    await repository.cancelInvoice(
      verifier,
      fixture.invoice.id,
      audit(platformUser.id),
    )

    await expect(
      repository.createManualPayment(
        fixture.schoolActor,
        {
          paymentId: randomUUID(),
          invoiceId: fixture.invoice.id,
          amountMinor: 500,
          currency: fixture.currency,
          method: 'BANK_TRANSFER',
          paymentReference: `REF-${randomUUID()}`,
          paidAt: '2026-11-01',
          payerName: null,
          notes: null,
          evidence: null,
        },
        audit(submitterUser.id),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    await expect(
      repository.verifyManualPayment(
        verifier,
        pending.id,
        { decision: 'VERIFIED' },
        audit(platformUser.id),
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    const invoice = await readInvoice(fixture.invoice.id)
    const storedPayment = await readPayment(pending.id)
    expect(invoice).toMatchObject({
      status: 'CANCELLED',
      paidMinor: 0,
      outstandingMinor: 1500,
    })
    expect(storedPayment.status).toBe('PENDING')
  })

  it('keeps cancellation and verification mutually consistent under concurrency', async () => {
    const fixture = await createFixture({ totalMinor: 1500 })
    const payment = await createManualPayment(fixture, 500)

    const outcomes = await Promise.allSettled([
      repository.verifyManualPayment(
        verifier,
        payment.id,
        { decision: 'VERIFIED' },
        audit(platformUser.id),
      ),
      repository.cancelInvoice(
        verifier,
        fixture.invoice.id,
        audit(platformUser.id),
      ),
    ])

    const invoice = await readInvoice(fixture.invoice.id)
    const storedPayment = await readPayment(payment.id)
    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)

    if (invoice.status === 'CANCELLED') {
      expect(invoice.paidMinor).toBe(0)
      expect(storedPayment.status).toBe('PENDING')
    } else {
      expect(invoice).toMatchObject({
        status: 'PARTIALLY_PAID',
        paidMinor: 500,
        outstandingMinor: 1000,
      })
      expect(storedPayment.status).toBe('VERIFIED')
    }
  })
})
