/**
 * Resolves the API base URL used by every browser request.
 *
 * The value comes from `VITE_API_URL`, which Vite inlines into the bundle at
 * build time. A production bundle must therefore be built with the deployed API
 * origin; silently falling back to localhost would ship a client that can never
 * reach the API, so that case is reported as a configuration error instead.
 */

export const LOCAL_API_URL = 'http://localhost:4000'

const LOOPBACK_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
])

export interface ApiBaseUrlResolution {
  /** Normalized origin without a trailing slash, or an empty string on error. */
  baseUrl: string
  /** Human-readable configuration problem, or null when the value is valid. */
  error: string | null
}

const MISSING_PRODUCTION_URL =
  'VITE_API_URL is not configured for this production build. Set it to the ' +
  'deployed backend origin (for example https://api.example.com) in the ' +
  'frontend hosting environment and redeploy.'

/**
 * Validates and normalizes a configured API base URL.
 *
 * Development keeps a localhost default so `npm run dev` works with no
 * configuration. Production requires an explicit HTTPS origin that is not a
 * loopback address; the returned error is surfaced to the user instead of
 * quietly calling the developer machine.
 */
export function resolveApiBaseUrl(
  rawValue: string | undefined,
  isProduction: boolean,
): ApiBaseUrlResolution {
  const raw = rawValue?.trim() ?? ''

  if (!raw) {
    return isProduction
      ? { baseUrl: '', error: MISSING_PRODUCTION_URL }
      : { baseUrl: LOCAL_API_URL, error: null }
  }

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return {
      baseUrl: '',
      error: `VITE_API_URL must be an absolute URL such as https://api.example.com (received "${raw}").`,
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      baseUrl: '',
      error: 'VITE_API_URL must use http or https.',
    }
  }

  if (url.username || url.password) {
    return {
      baseUrl: '',
      error: 'VITE_API_URL must not contain credentials.',
    }
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    return {
      baseUrl: '',
      error:
        'VITE_API_URL must be an origin only, with no path, query or fragment.',
    }
  }

  if (isProduction) {
    if (url.protocol !== 'https:') {
      return {
        baseUrl: '',
        error: 'VITE_API_URL must use https in a production build.',
      }
    }

    if (LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) {
      return {
        baseUrl: '',
        error: `VITE_API_URL points at ${url.origin}, which is a local address and cannot be reached by deployed browsers. Configure the deployed backend origin.`,
      }
    }
  }

  return { baseUrl: url.origin, error: null }
}

export interface DeployableApiUrlCheck {
  /** Blocking problem: the build cannot produce a working bundle. */
  error: string | null
  /** Non-blocking problem: the build works only on a developer machine. */
  warning: string | null
}

/**
 * Build-time check used by `vite.config.ts`.
 *
 * A missing or malformed URL stops the build, because the deployed site would
 * have no API to call. A loopback or plain-HTTP URL only warns: it is valid for
 * a local production-mode build, while the runtime guard refuses to call it
 * from a deployed page.
 */
export function checkDeployableApiUrl(
  rawValue: string | undefined,
): DeployableApiUrlCheck {
  const raw = rawValue?.trim() ?? ''

  if (!raw) {
    return { error: MISSING_PRODUCTION_URL, warning: null }
  }

  // Structural validation only; production reachability is checked below.
  const structural = resolveApiBaseUrl(raw, false)

  if (structural.error) {
    return { error: structural.error, warning: null }
  }

  const url = new URL(structural.baseUrl)

  if (
    url.protocol !== 'https:' ||
    LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())
  ) {
    return {
      error: null,
      warning:
        `VITE_API_URL is ${url.origin}. This build can only reach a local ` +
        'backend; set VITE_API_URL to the deployed HTTPS API origin before ' +
        'deploying it.',
    }
  }

  return { error: null, warning: null }
}
