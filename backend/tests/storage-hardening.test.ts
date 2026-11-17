import { describe, expect, it } from 'vitest'
import { env } from '../src/config/env.js'
import { safeErrorLogEntry } from '../src/middleware/error-handler.js'
import { storageFailureMessage } from '../src/storage/storage.js'

const BUCKET = 'gradely-prod-private'
const OBJECT_KEY = 'schools/school-1/reports/term-1/pupil-1/v1.pdf'

function awsError(name: string, status: number, message: string) {
  return { name, message, $metadata: { httpStatusCode: status } }
}

describe('storage health failure messages', () => {
  const cases = [
    { name: 'NoSuchBucket', status: 404, expected: /bucket was not found/i },
    { name: 'AccessDenied', status: 403, expected: /not authorized/i },
    { name: 'InvalidAccessKeyId', status: 403, expected: /access key ID was rejected/i },
    { name: 'SignatureDoesNotMatch', status: 403, expected: /secret access key was rejected/i },
    { name: 'TimeoutError', status: 0, expected: /timed out/i },
  ]

  for (const testCase of cases) {
    it(`maps ${testCase.name} to a safe message`, () => {
      const message = storageFailureMessage(
        awsError(
          testCase.name,
          testCase.status,
          `failed for ${BUCKET} key ${OBJECT_KEY} request abc123`,
        ),
      )

      expect(message).toMatch(testCase.expected)
      expect(message).not.toContain(BUCKET)
      expect(message).not.toContain(OBJECT_KEY)
      expect(message).not.toContain('abc123')
    })
  }

  it('falls back to a generic message without leaking the raw error', () => {
    const message = storageFailureMessage(
      new Error(`unexpected failure ${BUCKET} ${OBJECT_KEY}`),
    )

    expect(message).toMatch(/could not be reached/i)
    expect(message).not.toContain(BUCKET)
    expect(message).not.toContain(OBJECT_KEY)
  })
})

describe('5xx error log sanitization', () => {
  it('reduces AWS SDK errors to a name and status only', () => {
    const entry = safeErrorLogEntry({
      name: 'AccessDenied',
      message: `Access denied for ${BUCKET} key ${OBJECT_KEY}`,
      $metadata: { httpStatusCode: 403, requestId: 'req-secret' },
    })

    expect(entry).toEqual({ name: 'AccessDenied', httpStatusCode: 403 })

    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain(BUCKET)
    expect(serialized).not.toContain(OBJECT_KEY)
    expect(serialized).not.toContain('req-secret')
  })

  it('redacts private storage keys and access-key patterns from other errors', () => {
    const entry = safeErrorLogEntry(
      new Error(`failed ${OBJECT_KEY} with AKIAIOSFODNN7EXAMPLE`),
    )

    expect(entry.name).toBe('Error')
    expect(entry.message).toBeDefined()
    expect(entry.message).not.toContain(OBJECT_KEY)
    expect(entry.message).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(entry.message).toContain('[redacted')
  })

  it('redacts configured secret values from other errors', () => {
    const secret = env.R2_SECRET_ACCESS_KEY

    if (!secret) {
      return
    }

    const entry = safeErrorLogEntry(new Error(`unexpected value ${secret}`))

    expect(JSON.stringify(entry)).not.toContain(secret)
    expect(entry.message).toContain('[redacted]')
  })

  it('does not include a stack trace in the log entry', () => {
    const entry = safeErrorLogEntry(new Error('boom'))

    expect(entry).not.toHaveProperty('stack')
  })
})
