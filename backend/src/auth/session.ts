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

function sameSiteFor(nodeEnv: string): CookieOptions['sameSite'] {
  // The explicit override exists so production can be tightened to `lax`
  // after the same-origin `/api` deployment is verified. It is ignored only
  // for local development when it would prevent an http://localhost cookie
  // from being stored.
  if (nodeEnv === 'production' && env.AUTH_COOKIE_SAMESITE) {
    return env.AUTH_COOKIE_SAMESITE
  }

  return nodeEnv === 'production' ? 'none' : 'lax'
}

function cookieOptions(expiresAt: Date, nodeEnv: string): CookieOptions {
  const isProduction = nodeEnv === 'production'

  return {
    httpOnly: true,
    secure: isProduction,
    // Production frontends often live on a different site than the API, which
    // requires SameSite=None (and therefore Secure). Local development uses
    // Lax because http://localhost is not a secure context. A host-only
    // cookie (no Domain) is always used so the same-origin rewrite keeps the
    // cookie first-party.
    sameSite: sameSiteFor(nodeEnv),
    path: '/',
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  }
}

export function clearSessionCookieOptions(
  nodeEnv: string = env.NODE_ENV,
): CookieOptions {
  const isProduction = nodeEnv === 'production'

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: sameSiteFor(nodeEnv),
    path: '/',
  }
}

export { SESSION_COOKIE_NAME, SUBJECT_SESSION_COOKIE_NAME }
