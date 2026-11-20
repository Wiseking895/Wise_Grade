/**
 * Resolves the API base URL used by every browser request.
 *
 * The value comes from `VITE_API_URL`, which Vite inlines into the bundle at
 * build time.
 *
 * Three deployment shapes are supported:
 *
 * - A direct backend origin (for example `https://api.example.com`). Requests
 *   are cross-site, so the API must allow the web origin through CORS and its
 *   session cookie must survive third-party-cookie blocking. This is why iOS
 *   Safari can reject the session even though login appeared to succeed.
 * - Same-origin proxy mode (`same-origin`, or no value in a production build).
 *   Requests go to `/api/...` on the page's own origin and the host rewrites
 *   them to the backend. The session cookie is then first-party and is not
 *   subject to Safari's cross-site cookie blocking.
 * - Localhost during development when no value is configured.
 *
 * Silently falling back to localhost in production would ship a client that can
 * never reach the API, so that case is impossible: production defaults to
 * same-origin, which either works through the configured host rewrite or fails
 * with a normal network error.
 */

export const LOCAL_API_URL = 'http://localhost:4000'

/** Explicit opt-in to the same-origin `/api` proxy mode. */
export const SAME_ORIGIN_SENTINEL = 'same-origin'

/** Empty base URL means "use this page's origin", i.e. relative `/api` calls. */
export const SAME_ORIGIN_BASE_URL = ''

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

/**
 * Validates and normalizes a configured API base URL.
 *
 * Development keeps a localhost default so `npm run dev` works with no
 * configuration. A production build with no value uses same-origin proxy mode:
 * every call is a relative `/api/...` request that the host must rewrite to the
 * backend. An explicit production origin must be HTTPS and not a loopback
 * address; those values are still validated as before so a direct-origin
 * deployment cannot silently point at a developer machine.
 */
export function resolveApiBaseUrl(
  rawValue: string | undefined,
  isProduction: boolean,
): ApiBaseUrlResolution {
  const raw = rawValue?.trim() ?? ''

  if (raw === SAME_ORIGIN_SENTINEL) {
    return { baseUrl: SAME_ORIGIN_BASE_URL, error: null }
  }

  if (!raw) {
    return isProduction
      ? { baseUrl: SAME_ORIGIN_BASE_URL, error: null }
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
 * A missing value or the explicit `same-origin` sentinel is valid: the deployed
 * host is expected to rewrite `/api` to the backend, and the build cannot verify
 * that rewrite from here. A malformed direct origin stops the build, because the
 * deployed site would have no API to call. A loopback or plain-HTTP URL only
 * warns: it is valid for a local production-mode build, while the runtime guard
 * refuses to call it from a deployed page.
 */
export function checkDeployableApiUrl(
  rawValue: string | undefined,
): DeployableApiUrlCheck {
  const raw = rawValue?.trim() ?? ''

  if (!raw || raw === SAME_ORIGIN_SENTINEL) {
    return { error: null, warning: null }
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
