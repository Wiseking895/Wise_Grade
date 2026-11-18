import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  // Liveness must reflect the current process, not a cached edge response.
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    status: 'ok',
    service: 'gradely-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database: 'not_checked',
  })
})
