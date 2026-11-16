export const SESSION_COOKIE_NAME = 'gradely_session'
export const SUBJECT_SESSION_COOKIE_NAME = 'gradely_subject_session'

/**
 * Minimal cookie-header parser. `cookie-parser` is unnecessary here: the API
 * only reads one cookie and Express already provides `res.cookie`.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {}
  }

  const cookies: Record<string, string> = {}

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')

    if (separator < 0) {
      continue
    }

    const name = part.slice(0, separator).trim()
    const rawValue = part.slice(separator + 1).trim()

    if (!name || name in cookies) {
      continue
    }

    try {
      cookies[name] = decodeURIComponent(rawValue)
    } catch {
      cookies[name] = rawValue
    }
  }

  return cookies
}
