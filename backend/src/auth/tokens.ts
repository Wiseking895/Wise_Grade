import { createHash, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32

/** Generates a 256-bit opaque token that is safe to place in a cookie or URL. */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Tokens are stored only as SHA-256 hashes, never in plaintext. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
