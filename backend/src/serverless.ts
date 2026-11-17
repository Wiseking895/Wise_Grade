import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Express } from 'express'
import { createApp } from './app.js'

export type ServerlessHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void

let cachedApp: Express | undefined

/**
 * Returns the Express application for the serverless runtime.
 *
 * Creating the app is cheap and opens no database connection: Prisma, storage
 * and payment clients are all lazily initialised on first use. The instance is
 * cached per warm function invocation so Neon connections and other clients are
 * reused instead of being recreated on every request.
 */
export function getServerlessApp(): Express {
  cachedApp ??= createApp()
  return cachedApp
}

/**
 * Adapts the existing Express application factory to a Vercel Node function
 * without calling `listen`, starting the interval scheduler or changing any
 * middleware order. Express remains the single request handler, so routing,
 * cookie authentication, raw webhook bodies, CSRF checks and error handling are
 * exactly the same as the long-running server.
 */
export function createServerlessHandler(
  resolveApp: () => Express = getServerlessApp,
): ServerlessHandler {
  return function serverlessHandler(req, res) {
    resolveApp()(req, res)
  }
}
