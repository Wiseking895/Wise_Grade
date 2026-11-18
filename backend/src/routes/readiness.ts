import { Router } from 'express'
import { checkDatabaseConnection } from '../lib/database-health.js'

export type DatabaseReadinessCheck = () => Promise<void>

interface SafeDatabaseLogEntry {
  name: string
  code?: string
}

/**
 * Reduces a database failure to fields that cannot contain a connection string,
 * hostname, SQL text or credential. Error codes (for example Prisma `P1001` or
 * Node `ECONNREFUSED`) are safe to log and make production incidents easier to
 * diagnose.
 */
function safeDatabaseLogEntry(error: unknown): SafeDatabaseLogEntry {
  const name =
    error instanceof Error && error.name ? error.name : 'UnknownError'
  const code =
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined

  return code === undefined ? { name } : { name, code }
}

/**
 * Public readiness endpoint.
 *
 * A successful check proves the API can reach PostgreSQL through the shared
 * Prisma client. The response deliberately contains no error detail; failures
 * are logged as a sanitized descriptor and reported as a generic 503.
 */
export function createReadinessRouter(
  checkDatabase: DatabaseReadinessCheck = checkDatabaseConnection,
): Router {
  const router = Router()

  router.get('/', async (_req, res) => {
    // Readiness must never be served from a CDN or browser cache.
    res.setHeader('Cache-Control', 'no-store')
    const timestamp = new Date().toISOString()

    try {
      await checkDatabase()

      res.status(200).json({
        status: 'ok',
        service: 'gradely-api',
        database: 'connected',
        timestamp,
      })
    } catch (error) {
      console.error(
        '[gradely-api] readiness check failed:',
        safeDatabaseLogEntry(error),
      )

      res.status(503).json({
        status: 'error',
        service: 'gradely-api',
        database: 'unavailable',
        timestamp,
      })
    }
  })

  return router
}
