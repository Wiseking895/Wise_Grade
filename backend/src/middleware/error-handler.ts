import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import { DatabaseNotConfiguredError } from '../lib/prisma.js'

/**
 * Redacts credential and private-object identifiers from a log message.
 *
 * AWS SDK error messages can echo the bucket name, the object key and request
 * identifiers. The access key and secret are also scrubbed defensively in case
 * a third-party error interpolates them.
 */
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA|A3T[A-Z0-9])[A-Z0-9]{12,20}\b/g
const PRIVATE_STORAGE_KEY_PATTERN =
  /\b(?:schools|billing)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g

function redactSensitive(value: string): string {
  let output = value

  for (const secret of [env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY]) {
    if (secret && secret.length >= 8) {
      output = output.split(secret).join('[redacted]')
    }
  }

  return output
    .replace(AWS_ACCESS_KEY_PATTERN, '[redacted-access-key]')
    .replace(PRIVATE_STORAGE_KEY_PATTERN, '[redacted-storage-key]')
    .slice(0, 500)
}

function isAwsSdkError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      '$metadata' in error &&
      typeof (error as { $metadata?: unknown }).$metadata === 'object',
  )
}

export interface SafeErrorLogEntry {
  name: string
  message?: string
  httpStatusCode?: number
}

/**
 * Builds a log-safe descriptor for a 5xx error.
 *
 * AWS SDK errors are reduced to their name and HTTP status, never their raw
 * message (which may include the bucket, object key or request details). Other
 * errors keep a redacted, length-limited message.
 */
export function safeErrorLogEntry(error: unknown): SafeErrorLogEntry {
  if (isAwsSdkError(error)) {
    const candidate = error as {
      name?: unknown
      $metadata?: { httpStatusCode?: unknown }
    }
    const name =
      typeof candidate.name === 'string' && candidate.name.length > 0
        ? candidate.name
        : 'AwsSdkError'
    const status = candidate.$metadata?.httpStatusCode

    return typeof status === 'number'
      ? { name, httpStatusCode: status }
      : { name }
  }

  if (error instanceof Error) {
    return { name: error.name, message: redactSensitive(error.message) }
  }

  return { name: 'UnknownError' }
}

function isInvalidJsonError(
  error: unknown,
): error is SyntaxError & { status: number } {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as { status?: unknown }).status === 400
  )
}

function isInvalidUuidError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : ''

  return (
    code === 'P2007' &&
    /invalid input syntax for type uuid/i.test(message)
  )
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: 'Route not found',
      path: req.originalUrl,
    },
  })
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error)
    return
  }

  if (isInvalidJsonError(error)) {
    res.status(400).json({
      error: {
        message: 'Invalid JSON payload',
      },
    })
    return
  }

  if (isInvalidUuidError(error)) {
    res.status(400).json({
      error: {
        message: 'Invalid identifier',
      },
    })
    return
  }

  if (error instanceof DatabaseNotConfiguredError) {
    res.status(503).json({
      error: {
        message:
          'Database is not configured. Set DATABASE_URL before using this feature.',
      },
    })
    return
  }

  const isHttpError = error instanceof HttpError
  const statusCode = isHttpError ? error.statusCode : 500

  if (statusCode >= 500) {
    console.error(
      '[gradely-api] unhandled error:',
      safeErrorLogEntry(error),
    )
  }

  const message =
    statusCode >= 500 && env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error instanceof Error
        ? error.message
        : 'Internal server error'

  res.status(statusCode).json({
    error: {
      message,
      ...(isHttpError && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
  })
}
