import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '../config/env.js'
import { PrismaClient } from '../generated/prisma/client.js'

let prismaClient: PrismaClient | undefined

/**
 * Raised when a database-backed feature is used before a connection string is
 * configured. The error handler maps it to a clear 503 instead of leaking a
 * driver stack trace or crashing the API.
 */
export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'DATABASE_URL is not configured. Copy .env.example to .env and set a PostgreSQL connection string before using the database.',
    )
    this.name = 'DatabaseNotConfiguredError'
  }
}

/**
 * Returns the shared Prisma Client, creating it on first use.
 *
 * This is intentionally lazy: importing this module (or starting the API) does
 * not open a database connection. Health checks and public pages must remain
 * usable without PostgreSQL or DATABASE_URL.
 */
export function getPrismaClient(): PrismaClient {
  if (!env.DATABASE_URL) {
    throw new DatabaseNotConfiguredError()
  }

  if (!prismaClient) {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
    prismaClient = new PrismaClient({ adapter })
  }

  return prismaClient
}
