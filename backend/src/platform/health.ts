import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { env } from '../config/env.js'
import { getPrismaClient } from '../lib/prisma.js'
import type { StorageAdapter } from '../storage/storage.js'
import type { PlatformOperationsRepository } from './operations-repository.js'
import type {
  HealthCheck,
  HealthStatus,
  MigrationHealth,
  PaymentProviderHealth,
  PlatformHealth,
  SchedulerHealth,
} from './operations-types.js'

export interface PlatformHealthService {
  check(): Promise<PlatformHealth>
}

export interface PlatformHealthOptions {
  storage: StorageAdapter
  operations: PlatformOperationsRepository
  /** Override for tests; defaults to backend/prisma/migrations. */
  migrationsDirectory?: string
}

const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../prisma/migrations', import.meta.url),
)

function check(
  id: string,
  label: string,
  status: HealthStatus,
  detail: string,
  checkedAt: string,
): HealthCheck {
  return { id, label, status, detail, checkedAt }
}

function overallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some((item) => item.status === 'error')) {
    return 'error'
  }

  if (
    checks.some(
      (item) => item.status === 'degraded' || item.status === 'not_configured',
    )
  ) {
    return 'degraded'
  }

  if (checks.some((item) => item.status === 'unknown')) {
    return 'unknown'
  }

  return 'ok'
}

export function createPlatformHealthService(
  options: PlatformHealthOptions,
): PlatformHealthService {
  return {
    async check(): Promise<PlatformHealth> {
      const checkedAt = new Date().toISOString()
      const checks: HealthCheck[] = []
      const prisma = getPrismaClient()

      // Database ------------------------------------------------------------
      try {
        await prisma.$queryRawUnsafe('SELECT 1')
        checks.push(
          check(
            'database',
            'PostgreSQL',
            'ok',
            'A read-only connectivity query succeeded.',
            checkedAt,
          ),
        )
      } catch (error) {
        checks.push(
          check(
            'database',
            'PostgreSQL',
            'error',
            `Database query failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
            checkedAt,
          ),
        )
      }

      // Prisma client -------------------------------------------------------
      const hasClient =
        typeof prisma.user === 'object' && typeof prisma.payment === 'object'

      checks.push(
        check(
          'prisma',
          'Prisma client',
          hasClient ? 'ok' : 'error',
          hasClient
            ? 'Generated Prisma client is loaded and exposes the expected models.'
            : 'The generated Prisma client is missing expected models.',
          checkedAt,
        ),
      )

      // Migrations ----------------------------------------------------------
      let migrations: MigrationHealth = {
        appliedCount: 0,
        expectedCount: 0,
        latestApplied: null,
        latestAppliedAt: null,
        upToDate: false,
        pending: [],
      }

      try {
        const applied = await prisma.$queryRawUnsafe<
          Array<{ migration_name: string; finished_at: Date | null }>
        >(
          'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC',
        )

        const directory =
          options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY
        const expected = (await readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()

        const appliedNames = new Set(
          applied.map((row) => row.migration_name),
        )
        const pending = expected.filter((name) => !appliedNames.has(name))
        const latest = applied[applied.length - 1]

        migrations = {
          appliedCount: applied.length,
          expectedCount: expected.length,
          latestApplied: latest?.migration_name ?? null,
          latestAppliedAt: latest?.finished_at
            ? new Date(latest.finished_at).toISOString()
            : null,
          upToDate: pending.length === 0 && applied.length >= expected.length,
          pending,
        }

        checks.push(
          check(
            'migrations',
            'Database migrations',
            migrations.upToDate ? 'ok' : 'degraded',
            migrations.upToDate
              ? `${migrations.appliedCount} migrations applied; no pending migration files.`
              : `${pending.length} migration file(s) have not been applied.`,
            checkedAt,
          ),
        )
      } catch (error) {
        checks.push(
          check(
            'migrations',
            'Database migrations',
            'unknown',
            `Migration status could not be read: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
            checkedAt,
          ),
        )
      }

      // Storage -------------------------------------------------------------
      try {
        const storage = await options.storage.healthCheck()
        checks.push(
          check(
            'storage',
            'Private object storage',
            storage.ok
              ? 'ok'
              : storage.mode === 'unconfigured'
                ? 'not_configured'
                : 'error',
            storage.message,
            checkedAt,
          ),
        )
      } catch {
        // The adapter normally converts failures into a sanitized
        // StorageHealth message. If it throws instead, never surface the raw
        // error (it can contain bucket or object details) to the client.
        checks.push(
          check(
            'storage',
            'Private object storage',
            'error',
            'The storage probe failed unexpectedly. Check the server logs for a sanitized error descriptor.',
            checkedAt,
          ),
        )
      }

      // Scheduler -----------------------------------------------------------
      let scheduler: SchedulerHealth = {
        enabled: env.CALENDAR_SCHEDULER_ENABLED,
        intervalMinutes: env.CALENDAR_SCHEDULER_INTERVAL_MINUTES,
        lastRun: null,
        lastSuccessfulRun: null,
        consecutiveFailures: 0,
      }

      try {
        const [runs, lastSuccessful] = await Promise.all([
          options.operations.listSchedulerRuns(10),
          options.operations.lastSuccessfulSchedulerRun(),
        ])

        let consecutiveFailures = 0
        for (const run of runs) {
          if (run.status === 'FAILED') {
            consecutiveFailures += 1
          } else {
            break
          }
        }

        scheduler = {
          ...scheduler,
          lastRun: runs[0] ?? null,
          lastSuccessfulRun: lastSuccessful,
          consecutiveFailures,
        }

        const lastRunAt = runs[0]?.startedAt
        const stale =
          lastRunAt === undefined
            ? false
            : Date.now() - new Date(lastRunAt).getTime() >
              Math.max(scheduler.intervalMinutes * 2, 120) * 60 * 1000

        checks.push(
          check(
            'scheduler',
            'Academic calendar scheduler',
            !scheduler.enabled
              ? 'not_configured'
              : consecutiveFailures > 0
                ? 'degraded'
                : stale
                  ? 'degraded'
                  : 'ok',
            !scheduler.enabled
              ? 'The scheduler is disabled by configuration.'
              : lastRunAt
                ? `Last run ${lastRunAt}; ${consecutiveFailures} consecutive failure(s).`
                : 'No scheduler run has been recorded yet.',
            checkedAt,
          ),
        )
      } catch (error) {
        checks.push(
          check(
            'scheduler',
            'Academic calendar scheduler',
            'unknown',
            `Scheduler history could not be read: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
            checkedAt,
          ),
        )
      }

      // Payment provider ----------------------------------------------------
      let paymentProvider: PaymentProviderHealth = {
        configured: false,
        provider: null,
        webhookSecretConfigured: false,
        lastWebhookAt: null,
        lastWebhookOutcome: null,
      }

      try {
        const lastEvent = await prisma.paymentProviderEvent.findFirst({
          orderBy: { receivedAt: 'desc' },
          select: {
            provider: true,
            outcome: true,
            receivedAt: true,
          },
        })

        paymentProvider = {
          configured: Boolean(env.PAYMENT_PROVIDER),
          provider: env.PAYMENT_PROVIDER ?? null,
          webhookSecretConfigured: Boolean(env.PAYMENT_WEBHOOK_SECRET),
          lastWebhookAt: lastEvent
            ? lastEvent.receivedAt.toISOString()
            : null,
          lastWebhookOutcome: lastEvent?.outcome ?? null,
        }

        checks.push(
          check(
            'payment_provider',
            'Payment provider',
            paymentProvider.configured ? 'ok' : 'not_configured',
            paymentProvider.configured
              ? `Provider ${paymentProvider.provider} is configured. Webhook secret ${
                  paymentProvider.webhookSecretConfigured
                    ? 'is present'
                    : 'is missing'
                }.`
              : 'No online payment provider is configured; manual verification remains available.',
            checkedAt,
          ),
        )

        checks.push(
          check(
            'webhooks',
            'Payment webhooks',
            paymentProvider.webhookSecretConfigured
              ? paymentProvider.lastWebhookAt
                ? 'ok'
                : 'degraded'
              : 'not_configured',
            paymentProvider.lastWebhookAt
              ? `Last webhook received at ${paymentProvider.lastWebhookAt} with outcome ${
                  paymentProvider.lastWebhookOutcome ?? 'unknown'
                }.`
              : 'No payment webhook has been received.',
            checkedAt,
          ),
        )
      } catch (error) {
        checks.push(
          check(
            'payment_provider',
            'Payment provider',
            'unknown',
            `Payment provider status could not be read: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
            checkedAt,
          ),
        )
      }

      return {
        status: overallStatus(checks),
        checks,
        migrations,
        scheduler,
        paymentProvider,
        generatedAt: checkedAt,
      }
    },
  }
}
