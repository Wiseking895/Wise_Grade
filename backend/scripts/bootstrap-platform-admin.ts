/**
 * Secure first-run provisioning for the Wise Grade Platform Super Admin.
 *
 * This is deliberately a command-line procedure, not an HTTP endpoint:
 *
 *   npm run admin:bootstrap
 *
 * Safety properties:
 * - prints the exact target database (host/name/user) and requires confirmation
 *   before writing anything;
 * - hashes the password with the same scrypt implementation used by login;
 * - creates a platform identity (`User.isPlatformAdmin = true`) with no school
 *   membership;
 * - refuses to promote or overwrite an existing user;
 * - refuses to create a second platform administrator unless explicitly allowed;
 * - never prints or logs the password or password hash;
 * - is never invoked automatically when the API starts.
 */
import { createInterface } from 'node:readline/promises'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/config/env.js'
import { getPrismaClient } from '../src/lib/prisma.js'

interface TargetDatabase {
  host: string
  port: string
  database: string
  user: string
  ssl: string
}

function describeDatabase(connectionString: string): TargetDatabase {
  const url = new URL(connectionString)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))

  return {
    host: url.hostname,
    port: url.port || '5432',
    database,
    user: decodeURIComponent(url.username),
    ssl: url.searchParams.get('sslmode') ?? 'prefer',
  }
}

function validateEmail(value: string): string {
  const email = value.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error('Enter a valid email address')
  }

  return email
}

function validatePassword(value: string): void {
  const checks: Array<[boolean, string]> = [
    [value.length >= 12, 'at least 12 characters'],
    [/[a-z]/.test(value), 'a lowercase letter'],
    [/[A-Z]/.test(value), 'an uppercase letter'],
    [/[0-9]/.test(value), 'a number'],
    [/[^A-Za-z0-9]/.test(value), 'a symbol'],
  ]
  const missing = checks.filter(([passed]) => !passed).map(([, label]) => label)

  if (missing.length > 0) {
    throw new Error(`Password must contain ${missing.join(', ')}`)
  }
}

function validateName(value: string, label: string): string {
  const name = value.trim()

  if (name.length < 2 || name.length > 80) {
    throw new Error(`${label} must be between 2 and 80 characters`)
  }

  return name
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

/**
 * npm on Windows can treat unknown `--flags` as npm config rather than script
 * arguments, so every flag also has an environment-variable equivalent.
 */
function enabled(flag: string, envName: string): boolean {
  return hasFlag(flag) || process.env[envName] === 'true'
}

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in backend/.env or the process environment before provisioning.',
    )
  }

  const target = describeDatabase(env.DATABASE_URL)
  const nonInteractive =
    enabled('--non-interactive', 'PLATFORM_ADMIN_NON_INTERACTIVE') ||
    Boolean(process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD)

  console.log('Wise Grade — Platform Super Admin bootstrap')
  console.log('')
  console.log('Target database:')
  console.log(`  host:     ${target.host}:${target.port}`)
  console.log(`  database: ${target.database}`)
  console.log(`  user:     ${target.user}`)
  console.log(`  sslmode:  ${target.ssl}`)
  console.log(`  NODE_ENV: ${env.NODE_ENV}`)
  console.log('')
  console.log('No password, hash or connection secret is printed by this command.')
  console.log('')

  let email: string
  let password: string
  let firstName: string
  let lastName: string

  if (nonInteractive) {
    const confirmation = process.env.PLATFORM_ADMIN_CONFIRM_DATABASE ?? ''

    if (confirmation !== target.database) {
      throw new Error(
        `Refusing to write. Set PLATFORM_ADMIN_CONFIRM_DATABASE=${target.database} to confirm this exact database.`,
      )
    }

    email = validateEmail(process.env.PLATFORM_ADMIN_EMAIL ?? '')
    password = process.env.PLATFORM_ADMIN_PASSWORD ?? ''
    firstName = validateName(process.env.PLATFORM_ADMIN_FIRST_NAME ?? '', 'First name')
    lastName = validateName(process.env.PLATFORM_ADMIN_LAST_NAME ?? '', 'Last name')
  } else {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })
    const writable = rl as unknown as {
      _writeToOutput?: (text: string) => void
    }
    const originalWrite = writable._writeToOutput?.bind(rl)
    let muted = false

    writable._writeToOutput = (text: string) => {
      if (muted) {
        return
      }

      if (originalWrite) {
        originalWrite(text)
        return
      }

      process.stdout.write(text)
    }

    async function secret(question: string): Promise<string> {
      process.stdout.write(question)
      muted = true

      try {
        return await rl.question('')
      } finally {
        muted = false
        process.stdout.write('\n')
      }
    }

    try {
      const typed = await rl.question(
        `Type the database name (${target.database}) to confirm: `,
      )

      if (typed.trim() !== target.database) {
        throw new Error('Database confirmation did not match. Nothing was written.')
      }

      console.log('')
      email = validateEmail(await rl.question('Platform admin email: '))
      firstName = validateName(await rl.question('First name: '), 'First name')
      lastName = validateName(await rl.question('Last name: '), 'Last name')
      password = await secret('Password (hidden): ')

      const repeated = await secret('Repeat password (hidden): ')

      if (password !== repeated) {
        throw new Error('Passwords did not match. Nothing was written.')
      }

      validatePassword(password)
    } finally {
      rl.close()
    }
  }

  validatePassword(password)

  const prisma = getPrismaClient()

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } })

    if (existingUser) {
      throw new Error(
        `An account with ${email} already exists. This command never promotes or overwrites an existing account.`,
      )
    }

    const existingAdmins = await prisma.user.count({
      where: { isPlatformAdmin: true },
    })

    if (
      existingAdmins > 0 &&
      !enabled('--allow-additional-admin', 'PLATFORM_ADMIN_ALLOW_ADDITIONAL')
    ) {
      throw new Error(
        'A Platform Super Admin already exists. Re-run with PLATFORM_ADMIN_ALLOW_ADDITIONAL=true (or --allow-additional-admin via tsx) only if another platform owner is genuinely required.',
      )
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          isPlatformAdmin: true,
          isActive: true,
        },
      })

      // No SchoolMembership is created: the platform identity is intentionally
      // separate from every school tenant.
      await tx.auditLog.create({
        data: {
          actorUserId: created.id,
          action: 'PLATFORM_ADMIN_PROVISIONED',
          entityType: 'User',
          entityId: created.id,
          metadata: {
            email: created.email,
            via: 'admin:bootstrap',
            database: target.database,
          },
        },
      })

      return created
    })

    console.log('')
    console.log('Platform Super Admin provisioned successfully.')
    console.log(`  user id: ${user.id}`)
    console.log(`  email:   ${user.email}`)
    console.log(`  name:    ${user.firstName} ${user.lastName}`)
    console.log('  role:    PLATFORM_SUPER_ADMIN (isPlatformAdmin = true)')
    console.log('  school memberships: none')
    console.log('')
    console.log('Sign in through the existing Wise Grade login page.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('')
  console.error(
    `Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
