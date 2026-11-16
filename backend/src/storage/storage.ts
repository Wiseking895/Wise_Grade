import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '../config/env.js'

export interface StoredObjectMetadata {
  key: string
  checksum: string
  byteSize: number
}

export type StorageMode = 'r2' | 'local' | 'memory' | 'unconfigured'

/**
 * Result of a non-destructive storage probe. It never returns credentials,
 * bucket contents or object keys.
 */
export interface StorageHealth {
  mode: StorageMode
  ok: boolean
  message: string
}

/**
 * Private object storage boundary. No adapter returns or persists a public URL;
 * callers stream bytes through an authorized backend route.
 */
export interface StorageAdapter {
  putObject(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<StoredObjectMetadata>
  getObject(key: string): Promise<Buffer | null>
  deleteObject(key: string): Promise<void>
  /** Non-destructive availability probe used by Platform Health. */
  healthCheck(): Promise<StorageHealth>
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function assertSafeStorageKey(key: string): string {
  const normalized = key.trim()

  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('\\') ||
    normalized.includes('..') ||
    normalized.includes('\\') ||
    normalized.includes('\0')
  ) {
    throw new Error('Unsafe storage key')
  }

  return normalized
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly objects = new Map<
    string,
    { data: Buffer; contentType: string }
  >()

  async putObject(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<StoredObjectMetadata> {
    const safeKey = assertSafeStorageKey(key)
    this.objects.set(safeKey, { data: Buffer.from(data), contentType })
    return { key: safeKey, checksum: sha256(data), byteSize: data.length }
  }

  async getObject(key: string): Promise<Buffer | null> {
    const entry = this.objects.get(assertSafeStorageKey(key))
    return entry ? Buffer.from(entry.data) : null
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(assertSafeStorageKey(key))
  }

  async healthCheck(): Promise<StorageHealth> {
    return {
      mode: 'memory',
      ok: true,
      message: 'In-memory storage is available for this process.',
    }
  }

  /** Test-only inspection helper. */
  has(key: string): boolean {
    return this.objects.has(assertSafeStorageKey(key))
  }
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly root = resolve(process.cwd(), '.storage'),
  ) {}

  private pathFor(key: string): string {
    const safeKey = assertSafeStorageKey(key)
    const target = resolve(this.root, safeKey)

    if (!target.startsWith(`${resolve(this.root)}${sep}`)) {
      throw new Error('Storage key escapes the private storage root')
    }

    return target
  }

  async putObject(
    key: string,
    data: Buffer,
    _contentType: string,
  ): Promise<StoredObjectMetadata> {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    return { key: assertSafeStorageKey(key), checksum: sha256(data), byteSize: data.length }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key))
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null
      }

      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  async healthCheck(): Promise<StorageHealth> {
    try {
      await mkdir(this.root, { recursive: true })
      return {
        mode: 'local',
        ok: true,
        message: 'Local private storage directory is writable.',
      }
    } catch (error) {
      return {
        mode: 'local',
        ok: false,
        message: `Local private storage is unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      }
    }
  }
}

export class R2StorageAdapter implements StorageAdapter {
  private readonly client: S3Client

  constructor(
    private readonly config: {
      accountId: string
      accessKeyId: string
      secretAccessKey: string
      bucketName: string
    },
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  async putObject(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<StoredObjectMetadata> {
    const safeKey = assertSafeStorageKey(key)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: safeKey,
        Body: data,
        ContentType: contentType,
        CacheControl: 'private, no-store',
      }),
    )

    return { key: safeKey, checksum: sha256(data), byteSize: data.length }
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucketName,
          Key: assertSafeStorageKey(key),
        }),
      )

      if (!response.Body) {
        return null
      }

      return Buffer.from(await response.Body.transformToByteArray())
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error.name === 'NoSuchKey' || error.name === 'NotFound')
      ) {
        return null
      }

      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: assertSafeStorageKey(key),
      }),
    )
  }

  async healthCheck(): Promise<StorageHealth> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.config.bucketName }),
      )
      return {
        mode: 'r2',
        ok: true,
        message: 'Private R2 bucket is reachable with the configured credentials.',
      }
    } catch (error) {
      return {
        mode: 'r2',
        ok: false,
        message: `Private R2 bucket check failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      }
    }
  }
}

class UnconfiguredStorageAdapter implements StorageAdapter {
  private fail(): never {
    throw new Error(
      'Private R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME before generating or serving report files.',
    )
  }

  async putObject(): Promise<StoredObjectMetadata> {
    return this.fail()
  }

  async getObject(): Promise<Buffer | null> {
    return this.fail()
  }

  async deleteObject(): Promise<void> {
    this.fail()
  }

  async healthCheck(): Promise<StorageHealth> {
    return {
      mode: 'unconfigured',
      ok: false,
      message:
        'Private object storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME.',
    }
  }
}

export interface StorageFactoryOptions {
  nodeEnv?: string
  accountId?: string
  accessKeyId?: string
  secretAccessKey?: string
  bucketName?: string
  localRoot?: string
}

/**
 * Uses R2 whenever all four private credentials are present. Otherwise a
 * local private directory is used outside production, and production fails
 * loudly rather than silently writing to an ephemeral disk.
 */
export function createStorageAdapter(
  options: StorageFactoryOptions = {},
): StorageAdapter {
  const accountId = options.accountId ?? env.R2_ACCOUNT_ID
  const accessKeyId = options.accessKeyId ?? env.R2_ACCESS_KEY_ID
  const secretAccessKey =
    options.secretAccessKey ?? env.R2_SECRET_ACCESS_KEY
  const bucketName = options.bucketName ?? env.R2_BUCKET_NAME
  const nodeEnv = options.nodeEnv ?? env.NODE_ENV

  if (accountId && accessKeyId && secretAccessKey && bucketName) {
    return new R2StorageAdapter({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
    })
  }

  if (nodeEnv === 'production') {
    return new UnconfiguredStorageAdapter()
  }

  return new LocalStorageAdapter(options.localRoot)
}

export function storageMode(): 'r2' | 'local' | 'unconfigured' {
  if (
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME
  ) {
    return 'r2'
  }

  return env.NODE_ENV === 'production' ? 'unconfigured' : 'local'
}
