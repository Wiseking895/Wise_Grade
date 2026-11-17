import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalStorageAdapter,
  MemoryStorageAdapter,
  assertSafeStorageKey,
  createStorageAdapter,
  sha256,
} from '../src/storage/storage.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('private storage adapters', () => {
  it('stores, reads and deletes private objects in memory', async () => {
    const storage = new MemoryStorageAdapter()
    const data = Buffer.from('private report bytes')

    const metadata = await storage.putObject(
      'schools/school-1/reports/term-1/pupil-1/v1.pdf',
      data,
      'application/pdf',
    )

    expect(metadata.checksum).toBe(sha256(data))
    expect(metadata.byteSize).toBe(data.length)
    expect(await storage.getObject(metadata.key)).toEqual(data)

    await storage.deleteObject(metadata.key)
    expect(await storage.getObject(metadata.key)).toBeNull()
  })

  it('rejects unsafe object keys', () => {
    expect(() => assertSafeStorageKey('../escape.pdf')).toThrow()
    expect(() => assertSafeStorageKey('/absolute.pdf')).toThrow()
    expect(() => assertSafeStorageKey('schools\\school-1\\report.pdf')).toThrow()
    expect(() => assertSafeStorageKey('')).toThrow()
  })

  it('keeps local objects inside the private root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gradely-storage-'))
    temporaryDirectories.push(root)
    const storage = new LocalStorageAdapter(root)
    const data = Buffer.from('local private report')

    const metadata = await storage.putObject(
      'schools/school-1/reports/term-1/pupil-1/v1.pdf',
      data,
      'application/pdf',
    )

    expect(await storage.getObject(metadata.key)).toEqual(data)
    await expect(
      storage.putObject('../outside.pdf', data, 'application/pdf'),
    ).rejects.toThrow()

    await storage.deleteObject(metadata.key)
    expect(await storage.getObject(metadata.key)).toBeNull()
  })

  it('fails loudly in production when R2 credentials are absent', async () => {
    const storage = createStorageAdapter({
      nodeEnv: 'production',
      driver: 'unconfigured',
    })

    await expect(
      storage.putObject('schools/school-1/report.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(/R2 storage is not configured/)
  })

  it('uses explicitly requested local private storage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gradely-storage-'))
    temporaryDirectories.push(root)
    const storage = createStorageAdapter({
      driver: 'local',
      localRoot: root,
    })

    const metadata = await storage.putObject(
      'schools/school-1/report.pdf',
      Buffer.from('local'),
      'application/pdf',
    )

    expect(metadata.key).toBe('schools/school-1/report.pdf')
  })
})

describe('storage factory test isolation', () => {
  it('returns in-memory storage by default in a test runtime', async () => {
    // This is the regression guard: before the fix the factory consulted the
    // environment and would build an R2 client whenever .env carried live
    // credentials.
    const storage = createStorageAdapter()

    expect((await storage.healthCheck()).mode).toBe('memory')
  })

  it('ignores configured environment credentials in a test runtime', async () => {
    const storage = createStorageAdapter({ nodeEnv: 'production' })

    // If the environment fallback were still active this would be an R2
    // adapter pointed at the production bucket.
    expect((await storage.healthCheck()).mode).toBe('unconfigured')
    await expect(
      storage.putObject(
        'schools/school-1/report.pdf',
        Buffer.from('x'),
        'application/pdf',
      ),
    ).rejects.toThrow(/R2 storage is not configured/)
  })

  it('never falls back to environment credentials for the r2 driver', async () => {
    const storage = createStorageAdapter({ driver: 'r2' })

    expect((await storage.healthCheck()).mode).toBe('unconfigured')
  })

  it('rejects an r2 driver with incomplete explicit credentials', async () => {
    const storage = createStorageAdapter({
      driver: 'r2',
      credentials: { accountId: 'account' },
    })

    expect((await storage.healthCheck()).mode).toBe('unconfigured')
  })

  it('treats an explicit empty credentials object as unconfigured', async () => {
    const storage = createStorageAdapter({
      nodeEnv: 'production',
      credentials: {},
    })

    expect((await storage.healthCheck()).mode).toBe('unconfigured')
  })

  it('never selects R2 for auto even with complete explicit credentials', async () => {
    const storage = createStorageAdapter({
      nodeEnv: 'test',
      credentials: {
        accountId: 'test-account',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucketName: 'test-bucket',
      },
    })

    // A test must opt in with driver: 'r2' deliberately; auto never builds a
    // cloud client during a test run.
    expect((await storage.healthCheck()).mode).toBe('memory')
  })

  it('allows memory storage to be requested explicitly', async () => {
    const storage = createStorageAdapter({
      nodeEnv: 'production',
      driver: 'memory',
    })

    expect((await storage.healthCheck()).mode).toBe('memory')
  })

  it('allows an unconfigured adapter to be requested explicitly', async () => {
    const storage = createStorageAdapter({
      nodeEnv: 'test',
      driver: 'unconfigured',
    })

    expect((await storage.healthCheck()).mode).toBe('unconfigured')
  })
})
