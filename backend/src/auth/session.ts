import type { CookieOptions } from 'express'
import { env } from '../config/env.js'
import { SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME } from '../lib/cookies.js'

export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return cookieOptions(expiresAt)
}

export function subjectSessionCookieOptions(expiresAt: Date): CookieOptions {
  return cookieOptions(expiresAt)
}

function cookieOptions(expiresAt: Date): CookieOptions {
  const isProduction = env.NODE_ENV === 'production'

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

export function clearSessionCookieOptions(): CookieOptions {
  const isProduction = env.NODE_ENV === 'production'

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  }
}

export { SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME }
