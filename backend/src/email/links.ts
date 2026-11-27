import { env } from '../config/env.js'

/** Joins the configured frontend origin with an application path. */
export function frontendUrl(path: string): string {
  const base = env.FRONTEND_URL.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

export function verificationUrl(token: string): string {
  return frontendUrl(`/verify-email?token=${encodeURIComponent(token)}`)
}

export function resetPasswordUrl(token: string): string {
  return frontendUrl(`/reset-password?token=${encodeURIComponent(token)}`)
}

export function dashboardUrl(): string {
  return frontendUrl('/dashboard')
}

export function loginUrl(): string {
  return frontendUrl('/login')
}

export function changePasswordUrl(): string {
  return frontendUrl('/change-password')
}

export function accessCodeUrl(): string {
  return frontendUrl('/access-code')
}
