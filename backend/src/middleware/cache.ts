import type { RequestHandler } from 'express'

/**
 * Marks a response as uncacheable by browsers and intermediary caches.
 *
 * Authenticated account data (sessions, profiles, teacher directories) must
 * never be stored by a shared cache, and a browser must not serve a stale copy
 * after a sign-out, email change or membership change. Routes that serve
 * genuinely public assets opt out of this middleware instead.
 */
export const noStore: RequestHandler = function noStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store')
  next()
}
