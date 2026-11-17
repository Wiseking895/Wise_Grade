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
        message: `Private R2 bucket check failed: ${storageFailureMessage(error)}`,
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

/**
 * Maps an R2/HeadBucket failure to a fixed, administrator-safe message.
 *
 * The raw SDK error is deliberately never returned: it can contain the bucket
 * name, the endpoint host, the object key and request identifiers. Only the
 * error name and HTTP status code are used to choose a safe explanation.
 */
export function storageFailureMessage(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name ?? '')
      : ''

  let httpStatusCode: number | undefined

  if (error && typeof error === 'object' && '$metadata' in error) {
    const metadata = (error as { $metadata?: { httpStatusCode?: unknown } })
      .$metadata

    if (metadata && typeof metadata.httpStatusCode === 'number') {
      httpStatusCode = metadata.httpStatusCode
    }
  }

  if (name === 'NoSuchBucket' || httpStatusCode === 404) {
    return 'The configured private R2 bucket was not found. Check R2_BUCKET_NAME.'
  }

  if (name === 'InvalidAccessKeyId') {
    return 'The configured R2 access key ID was rejected. Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.'
  }

  if (name === 'SignatureDoesNotMatch') {
    return 'The configured R2 secret access key was rejected. Check R2_SECRET_ACCESS_KEY.'
  }

  if (
    name === 'AccessDenied' ||
    name === 'Forbidden' ||
    httpStatusCode === 403
  ) {
    return 'The configured R2 credentials are not authorized to access the private bucket.'
  }

  if (
    name === 'TimeoutError' ||
    name === 'RequestTimeout' ||
    name === 'AbortError' ||
    name === 'ETIMEDOUT'
  ) {
    return 'The private R2 bucket check timed out. Check network access and try again.'
  }

  return 'The private R2 bucket could not be reached. Check the R2 configuration and the server logs.'
}

export type StorageDriver = 'auto' | 'r2' | 'local' | 'memory' | 'unconfigured'

export interface StorageCredentials {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
}

export interface StorageFactoryOptions {
  nodeEnv?: string
  /**
   * Explicit adapter selection. `auto` keeps the production behaviour: R2 when
   * complete credentials are available, otherwise local storage outside
   * production and a loudly unconfigured adapter in production.
   */
  driver?: StorageDriver
  /**
   * Explicit credentials. Supplying this object — even an empty one — disables
   * the environment fallback completely, so callers can force an unconfigured
   * adapter without inheriting process credentials.
   */
  credentials?: Partial<StorageCredentials>
  localRoot?: string
}

/**
 * True when this process is an automated test run.
 *
 * Vitest sets both `NODE_ENV=test` and `VITEST=true`; checking both keeps the
 * guard effective even when a caller overrides `nodeEnv` explicitly.
 */
function isTestRuntime(nodeEnv: string): boolean {
  return (
    nodeEnv === 'test' ||
    Boolean(process.env.VITEST) ||
    process.env.VITEST_WORKER_ID !== undefined
  )
}

function hasCompleteCredentials(
  credentials: Partial<StorageCredentials>,
): credentials is StorageCredentials {
  return Boolean(
    credentials.accountId &&
      credentials.accessKeyId &&
      credentials.secretAccessKey &&
      credentials.bucketName,
  )
}

/**
 * Creates the private storage adapter.
 *
 * Safety rules:
 * - In a test runtime the environment is never consulted for credentials, so a
 *   developer's real `.env` cannot point automated tests at production R2.
 * - `auto` never selects R2 in a test runtime; tests must inject a
 *   `MemoryStorageAdapter` or explicitly request `driver: 'r2'` with explicit
 *   credentials.
 * - `driver: 'r2'` only ever uses `options.credentials`, never the environment.
 */
export function createStorageAdapter(
  options: StorageFactoryOptions = {},
): StorageAdapter {
  const nodeEnv = options.nodeEnv ?? env.NODE_ENV
  const testRuntime = isTestRuntime(nodeEnv)
  const driver = options.driver ?? 'auto'

  if (driver === 'memory') {
    return new MemoryStorageAdapter()
  }

  if (driver === 'unconfigured') {
    return new UnconfiguredStorageAdapter()
  }

  if (driver === 'local') {
    return new LocalStorageAdapter(options.localRoot)
  }

  // An explicitly supplied credentials object (even `{}`) always wins and
  // disables the environment fallback. A test runtime ignores the environment
  // entirely, which is what keeps the production bucket out of reach.
  const credentials: Partial<StorageCredentials> =
    options.credentials !== undefined
      ? options.credentials
      : testRuntime
        ? {}
        : {
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            bucketName: env.R2_BUCKET_NAME,
          }

  if (driver === 'r2') {
    return hasCompleteCredentials(credentials)
      ? new R2StorageAdapter(credentials)
      : new UnconfiguredStorageAdapter()
  }

  // Automatic selection. R2 is only considered outside a test runtime, so a
  // configured `.env` can never make an integration test use the live bucket.
  if (!testRuntime && hasCompleteCredentials(credentials)) {
    return new R2StorageAdapter(credentials)
  }

  if (nodeEnv === 'production') {
    return new UnconfiguredStorageAdapter()
  }

  if (testRuntime) {
    return new MemoryStorageAdapter()
  }

  return new LocalStorageAdapter(options.localRoot)
}

export function storageMode(): StorageMode {
  const adapter = createStorageAdapter()

  if (adapter instanceof R2StorageAdapter) {
    return 'r2'
  }

  if (adapter instanceof MemoryStorageAdapter) {
    return 'memory'
  }

  if (adapter instanceof LocalStorageAdapter) {
    return 'local'
  }

  return 'unconfigured'
}
