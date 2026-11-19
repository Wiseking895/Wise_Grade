import { getPrismaClient } from '../lib/prisma.js'
import type { Prisma } from '../generated/prisma/client.js'

export type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED'

/**
 * Maximum delivery attempts before a non-sensitive row becomes FAILED.
 * Shared with the service so `findDue` and claim logic agree on the limit.
 */
export const MAX_DELIVERY_ATTEMPTS = 5

export interface OutboxRecord {
  id: string
  dedupeKey: string
  recipient: string
  template: string
  payload: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  nextAttemptAt: Date
  lastErrorCode: string | null
  sentAt: Date | null
  createdAt: Date
}

export interface CreateOutboxInput {
  dedupeKey: string
  recipient: string
  template: string
  payload: Record<string, unknown>
}

/**
 * Persistence boundary for the transactional email outbox. The Prisma
 * implementation is used in production; tests inject an in-memory store.
 */
export interface EmailOutboxStore {
  /** Creates a row, or returns the existing row for the same business event. */
  create(input: CreateOutboxInput): Promise<{ record: OutboxRecord; created: boolean }>
  /**
   * Atomically takes a short lease on a due row before delivery.
   *
   * The compare-and-set on `attempts` ensures only one API instance (inline
   * send or cron drain) can deliver the same business event at a time. Returns
   * false when another worker already claimed it or it is no longer due.
   */
  claim(
    id: string,
    input: { expectedAttempts: number; now: Date; leaseUntil: Date },
  ): Promise<boolean>
  markSent(id: string, sentAt: Date): Promise<void>
  markFailed(
    id: string,
    input: {
      errorCode: string
      attempts: number
      nextAttemptAt: Date
      permanent: boolean
    },
  ): Promise<void>
  findById(id: string): Promise<OutboxRecord | null>
  findDue(now: Date, limit: number): Promise<OutboxRecord[]>
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function mapRecord(record: {
  id: string
  dedupeKey: string
  recipient: string
  template: string
  payload: Prisma.JsonValue
  status: OutboxStatus
  attempts: number
  nextAttemptAt: Date
  lastErrorCode: string | null
  sentAt: Date | null
  createdAt: Date
}): OutboxRecord {
  return {
    id: record.id,
    dedupeKey: record.dedupeKey,
    recipient: record.recipient,
    template: record.template,
    payload:
      typeof record.payload === 'object' &&
      record.payload !== null &&
      !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : {},
    status: record.status,
    attempts: record.attempts,
    nextAttemptAt: record.nextAttemptAt,
    lastErrorCode: record.lastErrorCode,
    sentAt: record.sentAt,
    createdAt: record.createdAt,
  }
}

export function createPrismaEmailOutboxStore(): EmailOutboxStore {
  return {
    async create(input) {
      const prisma = getPrismaClient()

      try {
        const record = await prisma.emailOutbox.create({
          data: {
            dedupeKey: input.dedupeKey,
            recipient: input.recipient,
            template: input.template,
            payload: toJson(input.payload),
          },
        })

        return { record: mapRecord(record), created: true }
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error
        }

        const existing = await prisma.emailOutbox.findUnique({
          where: { dedupeKey: input.dedupeKey },
        })

        if (!existing) {
          throw error
        }

        return { record: mapRecord(existing), created: false }
      }
    },

    async markSent(id, sentAt) {
      await getPrismaClient().emailOutbox.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt,
          nextAttemptAt: sentAt,
          lastErrorCode: null,
        },
      })
    },

    async claim(id, input) {
      const result = await getPrismaClient().emailOutbox.updateMany({
        where: {
          id,
          status: 'PENDING',
          attempts: input.expectedAttempts,
          nextAttemptAt: { lte: input.now },
        },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: input.leaseUntil,
        },
      })

      return result.count === 1
    },

    async markFailed(id, input) {
      await getPrismaClient().emailOutbox.update({
        where: { id },
        data: {
          status: input.permanent ? 'FAILED' : 'PENDING',
          attempts: input.attempts,
          nextAttemptAt: input.nextAttemptAt,
          lastErrorCode: input.errorCode,
        },
      })
    },

    async findById(id) {
      const record = await getPrismaClient().emailOutbox.findUnique({
        where: { id },
      })

      return record ? mapRecord(record) : null
    },

    async findDue(now, limit) {
      const records = await getPrismaClient().emailOutbox.findMany({
        where: {
          status: 'PENDING',
          attempts: { lt: MAX_DELIVERY_ATTEMPTS },
          nextAttemptAt: { lte: now },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      })

      return records.map(mapRecord)
    },
  }
}
