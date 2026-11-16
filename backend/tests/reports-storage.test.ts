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
      accountId: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      bucketName: undefined,
    })

    await expect(
      storage.putObject('schools/school-1/report.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow(/R2 storage is not configured/)
  })

  it('uses local private storage outside production when R2 is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gradely-storage-'))
    temporaryDirectories.push(root)
    const storage = createStorageAdapter({
      nodeEnv: 'test',
      accountId: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      bucketName: undefined,
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
