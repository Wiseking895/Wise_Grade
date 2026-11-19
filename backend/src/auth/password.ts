import {
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

// Memory-hard parameters. N=16384 with r=8 needs ~16 MiB per hash, which is a
// deliberate cost for password guessing while staying safe for a normal API
// process. The parameters are stored with each hash so they can be raised later
// without invalidating existing passwords.
const PARAMS = { N: 16384, r: 8, p: 1 } as const
const KEY_LENGTH = 64
const SALT_BYTES = 16
const ALGORITHM = 'scrypt'

function encode(value: Buffer): string {
  return value.toString('base64url')
}

/**
 * A small, curated deny-list of the passwords most frequently present in
 * credential-stuffing lists. This is not a global uniqueness rule: two people
 * may still choose the same strong password. It only rejects values that are
 * trivially guessable.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'password1234',
  'passw0rd',
  'p@ssw0rd',
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  'qwerty123',
  'letmein123',
  'welcome123',
  'welcome1',
  'admin12345',
  'administrator',
  'iloveyou123',
  'changeme123',
  'abc1234567',
  'football123',
  'monkey123',
  'dragon123',
  'sunshine123',
  'princess123',
  'baseball123',
])

/** Case-insensitive common-password check for new password choices. */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase())
}

const TEMP_PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const TEMP_PASSWORD_LENGTH = 20
const UPPERCASE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWERCASE_ALPHABET = 'abcdefghijkmnopqrstuvwxyz'
const DIGITS = '23456789'

/**
 * Generates a strong, unpredictable temporary password for a new class teacher.
 *
 * Uses the platform CSPRNG, avoids ambiguous characters (0/O, 1/I/l) that are
 * difficult to retype from an email, and guarantees at least one uppercase
 * letter, one lowercase letter and one digit. The value is never persisted in
 * plaintext: the caller hashes it before the account is written.
 */
export function generateTemporaryPassword(): string {
  const pick = () =>
    TEMP_PASSWORD_ALPHABET[
      randomInt(0, TEMP_PASSWORD_ALPHABET.length)
    ] as string

  const required = [
    UPPERCASE_ALPHABET[randomInt(0, UPPERCASE_ALPHABET.length)] as string,
    LOWERCASE_ALPHABET[randomInt(0, LOWERCASE_ALPHABET.length)] as string,
    DIGITS[randomInt(0, DIGITS.length)] as string,
  ]

  const remaining = Array.from(
    { length: TEMP_PASSWORD_LENGTH - required.length },
    pick,
  )
  const characters = [...required, ...remaining]

  // Fisher-Yates with CSPRNG so the guaranteed characters are not always first.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(0, index + 1)
    const value = characters[index] as string
    characters[index] = characters[swapWith] as string
    characters[swapWith] = value
  }

  return characters.join('')
}



export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS)

  return [
    ALGORITHM,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    encode(salt),
    encode(derived),
  ].join('$')
}

/**
 * Constant-time password check. Returns false for malformed or unknown hashes
 * instead of throwing, so callers always take the same failure path.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$')

  if (parts.length !== 6) {
    return false
  }

  const [algorithm, n, r, p, saltPart, hashPart] = parts

  if (
    algorithm !== ALGORITHM ||
    !n ||
    !r ||
    !p ||
    !saltPart ||
    !hashPart
  ) {
    return false
  }

  const N = Number(n)
  const rValue = Number(r)
  const pValue = Number(p)

  if (!Number.isInteger(N) || !Number.isInteger(rValue) || !Number.isInteger(pValue)) {
    return false
  }

  try {
    const salt = Buffer.from(saltPart, 'base64url')
    const expected = Buffer.from(hashPart, 'base64url')

    if (expected.length === 0) {
      return false
    }

    const derived = await scrypt(password, salt, expected.length, {
      N,
      r: rValue,
      p: pValue,
    })

    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
