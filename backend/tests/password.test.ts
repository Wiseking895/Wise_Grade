import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password.js'
import { generateOpaqueToken, hashToken } from '../src/auth/tokens.js'

describe('password hashing', () => {
  it('produces a salted scrypt hash, never the plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery')

    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true)
    expect(hash).not.toContain('correct-horse-battery')
    expect(hash.split('$')).toHaveLength(6)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery')

    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(
      true,
    )
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery')

    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('uses a fresh salt for every hash', async () => {
    const first = await hashPassword('correct-horse-battery')
    const second = await hashPassword('correct-horse-battery')

    expect(first).not.toBe(second)
    await expect(verifyPassword('correct-horse-battery', first)).resolves.toBe(
      true,
    )
    await expect(verifyPassword('correct-horse-battery', second)).resolves.toBe(
      true,
    )
  })

  it('returns false for malformed stored hashes', async () => {
    for (const value of [
      '',
      'plaintext',
      'scrypt$16384$8$1$only-five-parts',
      'bcrypt$16384$8$1$c2FsdA$aGFzaA',
      'scrypt$not-a-number$8$1$c2FsdA$aGFzaA',
    ]) {
      await expect(verifyPassword('password', value)).resolves.toBe(false)
    }
  })
})

describe('opaque tokens', () => {
  it('generates distinct, high-entropy tokens', () => {
    const first = generateOpaqueToken()
    const second = generateOpaqueToken()

    expect(first).not.toBe(second)
    expect(first.length).toBeGreaterThanOrEqual(40)
  })

  it('hashes tokens deterministically without storing the raw value', () => {
    const token = generateOpaqueToken()
    const hash = hashToken(token)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(hashToken(token))
    expect(hash).not.toContain(token)
  })
})
