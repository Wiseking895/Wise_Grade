import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
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
