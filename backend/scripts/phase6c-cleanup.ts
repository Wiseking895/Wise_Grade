/**
 * Removes only the synthetic Phase 6C browser-QA fixtures created by
 * `phase6c-seed.ts`, plus their private local-storage directory.
 */
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { loadProjectEnvFile } from '../src/config/env-file.js'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { assertSafeIntegrationTarget } from '../tests/integration/target.js'

loadProjectEnvFile()

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl) {
  console.error(
    'PHASE6C CLEANUP BLOCKED: TEST_DATABASE_URL is not set. No database was changed.',
  )
  process.exit(1)
}

assertSafeIntegrationTarget({
  testDatabaseUrl,
  databaseUrl: process.env.DATABASE_URL?.trim(),
  nodeEnv: process.env.NODE_ENV,
})

const EMAIL_DOMAIN = '@phase6c.test'
const SLUG_PREFIX = 'phase6c-'

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: testDatabaseUrl })
  const prisma = new PrismaClient({ adapter })

  try {
    const schools = await prisma.school.findMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
      select: { id: true },
    })

    const users = await prisma.user.findMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
      select: { id: true },
    })

    await prisma.school.deleteMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
    })

    if (users.length > 0) {
      const ids = users.map((user) => user.id)
      await prisma.pricingRule.deleteMany({
        where: { createdByUserId: { in: ids } },
      })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }

    for (const school of schools) {
      await rm(resolve(process.cwd(), '.storage', 'schools', school.id), {
        recursive: true,
        force: true,
      })
    }

    console.log(
      `PHASE6C CLEANUP OK: ${schools.length} school(s) and ${users.length} user(s) removed.`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(
    'PHASE6C CLEANUP FAILED:',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
