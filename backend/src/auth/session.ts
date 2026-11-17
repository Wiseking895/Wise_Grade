import type { CookieOptions } from 'express'
import { env } from '../config/env.js'
import { SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME } from '../lib/cookies.js'

export function sessionCookieOptions(
  expiresAt: Date,
  nodeEnv: string = env.NODE_ENV,
): CookieOptions {
  return cookieOptions(expiresAt, nodeEnv)
}

export function subjectSessionCookieOptions(
  expiresAt: Date,
  nodeEnv: string = env.NODE_ENV,
): CookieOptions {
  return cookieOptions(expiresAt, nodeEnv)
}

function cookieOptions(expiresAt: Date, nodeEnv: string): CookieOptions {
  const isProduction = nodeEnv === 'production'

  return {
    httpOnly: true,
    secure: isProduction,
    // Production frontends often live on a different site than the API, which
    // requires SameSite=None (and therefore Secure). Local development uses
    // Lax because http://localhost is not a secure context.
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    expires: expiresAt,
  }
}

export function clearSessionCookieOptions(
  nodeEnv: string = env.NODE_ENV,
): CookieOptions {
  const isProduction = nodeEnv === 'production'

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  }
}

export { SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME }
