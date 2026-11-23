import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  FINAL_RECOVERY_MESSAGE,
  MAX_RECOVERY_ATTEMPTS,
  clearRecoveryAttempts,
  getRecoveryAttempts,
  recordRecoveryAttempt,
  recoveryExhausted,
} from '../src/lib/recovery.ts'

function installSessionStorage() {
  const values = new Map<string, string>()

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem(key: string) {
          return values.get(key) ?? null
        },
        setItem(key: string, value: string) {
          values.set(key, value)
        },
        removeItem(key: string) {
          values.delete(key)
        },
      },
    },
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('global recovery budget', () => {
  it('allows three consecutive recovery attempts and then stops', () => {
    installSessionStorage()
    clearRecoveryAttempts()

    assert.equal(getRecoveryAttempts(), 0)
    assert.equal(recordRecoveryAttempt(), 1)
    assert.equal(recordRecoveryAttempt(), 2)
    assert.equal(recordRecoveryAttempt(), 3)
    assert.equal(recordRecoveryAttempt(), MAX_RECOVERY_ATTEMPTS)
    assert.equal(recoveryExhausted(), true)
  })

  it('clears the counter only after a successful load', () => {
    installSessionStorage()
    recordRecoveryAttempt()
    recordRecoveryAttempt()

    assert.equal(getRecoveryAttempts(), 2)

    clearRecoveryAttempts()

    assert.equal(getRecoveryAttempts(), 0)
    assert.equal(recoveryExhausted(), false)
  })

  it('uses the required final wording after the budget is exhausted', () => {
    assert.equal(
      FINAL_RECOVERY_MESSAGE,
      "We're having difficulty loading your account right now. Please try again later or return to this page after some time.",
    )
  })

  it('treats unavailable or corrupt storage as no attempts rather than crashing', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: {
          getItem() {
            return 'not-a-number'
          },
          setItem() {
            throw new Error('blocked')
          },
          removeItem() {
            throw new Error('blocked')
          },
        },
      },
    })

    assert.equal(getRecoveryAttempts(), 0)
    assert.equal(recordRecoveryAttempt(), 1)
    assert.doesNotThrow(() => clearRecoveryAttempts())
  })
})
