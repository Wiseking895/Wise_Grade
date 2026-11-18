import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  checkDeployableApiUrl,
  LOCAL_API_URL,
  resolveApiBaseUrl,
} from '../src/lib/api-url.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('API base URL resolution', () => {
  it('uses the local backend by default during development', () => {
    const resolved = resolveApiBaseUrl(undefined, false)

    assert.equal(resolved.error, null)
    assert.equal(resolved.baseUrl, LOCAL_API_URL)
    assert.equal(resolved.baseUrl, 'http://localhost:4000')
  })

  it('accepts a configured development origin', () => {
    const resolved = resolveApiBaseUrl('http://localhost:4000/', false)

    assert.equal(resolved.error, null)
    assert.equal(resolved.baseUrl, 'http://localhost:4000')
  })

  it('never falls back to localhost in a production bundle', () => {
    const resolved = resolveApiBaseUrl(undefined, true)

    assert.equal(resolved.baseUrl, '')
    assert.match(resolved.error ?? '', /VITE_API_URL is not configured/)
  })

  it('rejects a localhost API URL in a production bundle', () => {
    for (const value of [
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'https://localhost:4000',
    ]) {
      const resolved = resolveApiBaseUrl(value, true)

      assert.equal(resolved.baseUrl, '')
      assert.ok(resolved.error, `expected an error for ${value}`)
    }
  })

  it('rejects plain HTTP in a production bundle', () => {
    const resolved = resolveApiBaseUrl('http://api.example.com', true)

    assert.equal(resolved.baseUrl, '')
    assert.match(resolved.error ?? '', /https/i)
  })

  it('accepts a deployed HTTPS origin and strips a trailing slash', () => {
    const resolved = resolveApiBaseUrl('https://api.wise-grade.example/', true)

    assert.equal(resolved.error, null)
    assert.equal(resolved.baseUrl, 'https://api.wise-grade.example')
  })

  it('rejects paths, credentials and malformed values', () => {
    for (const value of [
      'https://api.wise-grade.example/api',
      'https://user:secret@api.wise-grade.example',
      'not-a-url',
      'ftp://api.wise-grade.example',
    ]) {
      const resolved = resolveApiBaseUrl(value, true)

      assert.equal(resolved.baseUrl, '', `expected rejection for ${value}`)
      assert.ok(resolved.error, `expected an error for ${value}`)
    }
  })
})

describe('single API origin', () => {
  it('exports one validated base URL from the shared client', async () => {
    const text = await source('../src/lib/api.ts')

    assert.match(text, /export const API_BASE_URL/)
    assert.match(text, /credentials: 'include'/)
  })

  for (const modulePath of [
    '../src/billing/api.ts',
    '../src/reports/api.ts',
  ]) {
    it(`keeps ${modulePath} on the shared origin`, async () => {
      const text = await source(modulePath)

      // These modules download private files directly, so they must not
      // re-resolve VITE_API_URL or silently fall back to localhost when the
      // production variable is missing.
      assert.match(text, /API_BASE_URL/)
      assert.match(text, /API_CONFIGURATION_ERROR/)
      assert.match(text, /credentials: 'include'/)
      assert.doesNotMatch(text, /import\.meta\.env/)
      assert.doesNotMatch(text, /localhost:4000/)
      assert.doesNotMatch(text, /api-placeholder/)
    })
  }
})

describe('build-time API URL check', () => {
  it('blocks a build without VITE_API_URL', () => {
    const check = checkDeployableApiUrl(undefined)

    assert.ok(check.error)
    assert.equal(check.warning, null)
  })

  it('blocks a build with a malformed URL', () => {
    const check = checkDeployableApiUrl('localhost:4000')

    assert.ok(check.error)
  })

  it('warns but allows a local production-mode build', () => {
    const check = checkDeployableApiUrl('http://localhost:4000')

    assert.equal(check.error, null)
    assert.match(check.warning ?? '', /local backend/)
  })

  it('accepts a deployed HTTPS API origin silently', () => {
    const check = checkDeployableApiUrl('https://api.wise-grade.example')

    assert.equal(check.error, null)
    assert.equal(check.warning, null)
  })
})
