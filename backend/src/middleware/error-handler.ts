import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { HttpError } from '../errors/http-error.js'
import { DatabaseNotConfiguredError } from '../lib/prisma.js'

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
    console.error('[gradely-api] unhandled error:', error)
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
