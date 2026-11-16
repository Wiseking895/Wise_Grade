import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'
import { env } from '../config/env.js'

/**
 * Dependency-free TOTP (RFC 6238) implementation used for optional platform
 * administrator multi-factor authentication.
 *
 * Secrets are encrypted at rest with AES-256-GCM. The key is derived from
 * AUTH_SECRET. Production must configure AUTH_SECRET before MFA can be enabled;
 * development falls back to a clearly non-production key so the local workflow
 * remains usable.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_DIGITS = 6
const TOTP_PERIOD_SECONDS = 30
const RECOVERY_CODE_COUNT = 10
const RECOVERY_CODE_BYTES = 8

const DEV_MFA_KEY =
  'wise-grade-development-only-mfa-encryption-key-do-not-use-in-production'

function encryptionKey(): Buffer {
  const material = env.AUTH_SECRET ?? DEV_MFA_KEY
  return createHash('sha256').update(`wise-grade-mfa:${material}`).digest()
}

/** True when MFA can be enabled in the current environment. */
export function isMfaConfigured(): boolean {
  return env.NODE_ENV !== 'production' || Boolean(env.AUTH_SECRET)
}

export function mfaConfigurationMessage(): string | null {
  if (isMfaConfigured()) {
    return null
  }

  return 'Multi-factor authentication requires AUTH_SECRET to be configured before it can be enabled in production.'
}

export function encryptMfaSecret(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

export function decryptMfaSecret(value: string): string | null {
  const parts = value.split(':')

  if (parts.length !== 4 || parts[0] !== 'v1') {
    return null
  }

  try {
    const iv = Buffer.from(parts[1]!, 'base64url')
    const tag = Buffer.from(parts[2]!, 'base64url')
    const ciphertext = Buffer.from(parts[3]!, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
    decipher.setAuthTag(tag)

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

export function encodeBase32(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  return output
}

export function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let value = 0

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)

    if (index === -1) {
      continue
    }

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

/** Generates a new 160-bit base32 TOTP secret. */
export function generateMfaSecret(): string {
  return encodeBase32(randomBytes(20))
}

export function buildOtpAuthUri(input: {
  secret: string
  accountName: string
  issuer?: string
}): string {
  const issuer = input.issuer ?? 'Wise Grade'
  const label = `${issuer}:${input.accountName}`
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

export function generateTotp(
  secret: string,
  at: Date = new Date(),
  periodOffset = 0,
): string {
  const counter = Math.floor(
    at.getTime() / 1000 / TOTP_PERIOD_SECONDS,
  ) + periodOffset
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counterBuffer)
    .digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

/**
 * Verifies a six-digit TOTP code. A one-period window is accepted in each
 * direction to tolerate small clock drift.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date = new Date(),
  window = 1,
): boolean {
  const normalized = code.replace(/\s+/g, '')

  if (!/^\d{6}$/.test(normalized)) {
    return false
  }

  const candidate = Buffer.from(normalized)

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(generateTotp(secret, at, offset))

    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      return true
    }
  }

  return false
}

function recoveryAlphabet(): string {
  // Unambiguous characters only (no 0/O, 1/I/L).
  return 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(`wise-grade-recovery:${normalizeRecoveryCode(code)}`)
    .digest('hex')
}

/** Generates human-readable single-use recovery codes. */
export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
): string[] {
  const alphabet = recoveryAlphabet()
  const codes: string[] = []

  for (let index = 0; index < count; index += 1) {
    const bytes = randomBytes(RECOVERY_CODE_BYTES)
    let raw = ''

    for (const byte of bytes) {
      raw += alphabet[byte % alphabet.length]
    }

    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }

  // randomInt is used here so the function has no accidental deterministic path.
  void randomInt(1)
  return codes
}

export function recoveryCodeHashes(codes: string[]): string[] {
  return codes.map(hashRecoveryCode)
}

export function verifyRecoveryCodeHash(
  code: string,
  hashes: string[],
): string | null {
  const candidate = hashRecoveryCode(code)
  const candidateBuffer = Buffer.from(candidate)
  let match: string | null = null

  for (const hash of hashes) {
    const expected = Buffer.from(hash)

    if (
      candidateBuffer.length === expected.length &&
      timingSafeEqual(candidateBuffer, expected)
    ) {
      match = hash
    }
  }

  return match
}
