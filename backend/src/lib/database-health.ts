import { getPrismaClient } from './prisma.js'

/**
 * Readiness probes must answer quickly even when PostgreSQL is unreachable.
 * The shared Prisma adapter also applies its own connection timeout; this
 * shorter bound keeps the public endpoint from holding a serverless invocation
 * open for the full driver timeout.
 */
export const DATABASE_READINESS_TIMEOUT_MS = 5_000

export class DatabaseReadinessTimeoutError extends Error {
  constructor() {
    super('Database readiness check timed out')
    this.name = 'DatabaseReadinessTimeoutError'
  }
}

/**
 * Performs a read-only connectivity check with the shared Prisma client.
 *
 * No client is created here: `getPrismaClient()` returns the existing
 * singleton, so warm serverless instances reuse the same pool. The query is a
 * literal `SELECT 1` and never reads or mutates application data.
 */
export async function checkDatabaseConnection(
  timeoutMs: number = DATABASE_READINESS_TIMEOUT_MS,
): Promise<void> {
  const prisma = getPrismaClient()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DatabaseReadinessTimeoutError()),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}
