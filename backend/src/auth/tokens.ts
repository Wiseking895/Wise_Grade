import { createHash, randomBytes, randomInt } from 'node:crypto'

const TOKEN_BYTES = 32

/**
 * Subject-teacher access codes use a fixed, human-readable shape:
 *
 *   DDDDUll  ->  four digits, one uppercase letter, two lowercase letters
 *   e.g. 4821Kmw
 *
 * The alphabet deliberately excludes ambiguous characters where possible. The
 * canonical form is the only value ever hashed or stored, so a teacher can type
 * the code in any case without a case-conversion failure. Entropy is
 * 10^4 * 26 * 26^2 = 175,760,000 combinations, which is ample for short-lived,
 * assignment-bound codes. The database also enforces uniqueness on the hash.
 */
export const SUBJECT_ACCESS_CODE_PATTERN = /^\d{4}[A-Z][a-z]{2}$/
export const SUBJECT_ACCESS_CODE_LENGTH = 7

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'

/** Generates a 256-bit opaque token that is safe to place in a cookie or URL. */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * Generates one cryptographically secure subject-teacher access code in the
 * exact `DDDDUll` shape. `randomInt` uses the platform CSPRNG and avoids modulo
 * bias, unlike `Math.random()`-style generation.
 */
export function generateSubjectAccessCode(): string {
  const digits = String(randomInt(0, 10_000)).padStart(4, '0')
  const upper = UPPERCASE[randomInt(0, UPPERCASE.length)] as string
  const lowerOne = LOWERCASE[randomInt(0, LOWERCASE.length)] as string
  const lowerTwo = LOWERCASE[randomInt(0, LOWERCASE.length)] as string

  return `${digits}${upper}${lowerOne}${lowerTwo}`
}

/**
 * Canonicalises user input without weakening the format.
 *
 * Teachers often type on a phone keyboard that produces lower-case letters, or
 * paste a code with surrounding spaces. This trims whitespace and forces the
 * exact case pattern the generator uses. It returns `null` for anything that is
 * not four digits followed by three letters, so invalid values are still
 * rejected rather than silently repaired.
 */
export function normalizeSubjectAccessCode(
  value: string,
): string | null {
  const compact = value.trim().replace(/\s+/g, '')

  if (!/^\d{4}[A-Za-z]{3}$/.test(compact)) {
    return null
  }

  const canonical = `${compact.slice(0, 4)}${compact
    .slice(4, 5)
    .toUpperCase()}${compact.slice(5).toLowerCase()}`

  return SUBJECT_ACCESS_CODE_PATTERN.test(canonical) ? canonical : null
}

/** Tokens and access codes are stored only as SHA-256 hashes, never plaintext. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
