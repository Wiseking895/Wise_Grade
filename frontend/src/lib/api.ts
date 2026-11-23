import type {
  AuthSession,
  AuthUser,
  LoginInput,
  RegisterSchoolInput,
  RegisterSchoolResult,
  SubjectSession,
} from '../auth/types'
import { resolveApiBaseUrl } from './api-url'

const apiBaseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  import.meta.env.PROD,
)

/**
 * Set when the bundle was built without a usable API origin. `main.tsx` renders
 * a configuration screen instead of an application that would call localhost.
 */
export const API_CONFIGURATION_ERROR = apiBaseUrl.error

/** Shared, validated API origin used by every browser request. */
export const API_BASE_URL = apiBaseUrl.baseUrl

/** Resolves a private API asset path to the configured backend origin. */
export function apiAssetUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE_URL}${path}`
}

const SUBJECT_SESSION_HINT_KEY = 'gradely.subjectSessionHint'

/**
 * The restricted subject-session cookie is HttpOnly and belongs to the API
 * origin, which is a different host from the web app in production. Browser
 * JavaScript can therefore never inspect it. Instead the client records a
 * non-secret marker in its own origin's storage after a successful access-code
 * entry, so `loadAuthState` only pays for the `/subject-teacher/me` probe when a
 * subject session can plausibly exist.
 */
export function rememberSubjectSessionHint(): void {
  try {
    window.localStorage.setItem(SUBJECT_SESSION_HINT_KEY, '1')
  } catch {
    // A browser with storage disabled simply falls back to no probe.
  }
}

/** True when this browser entered a subject access code on this origin. */
export function hasSubjectSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SUBJECT_SESSION_HINT_KEY) === '1'
  } catch {
    return false
  }
}

/** Clears a stale marker after the restricted session endpoint rejects us. */
export function clearSubjectSessionHint(): void {
  try {
    window.localStorage.removeItem(SUBJECT_SESSION_HINT_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export interface ApiFieldError {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  readonly details: ApiFieldError[]
  /**
   * Stable backend reason such as `session_expired`, `csrf_origin_missing`,
   * `password_invalid` or `email_in_use`. Prose is safe to show, but the code
   * lets a screen distinguish causes that share an HTTP status.
   */
  readonly code: string | null

  constructor(
    status: number,
    message: string,
    details: ApiFieldError[] = [],
    code: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
    this.code = code
  }
}

export type ApiFailureKind =
  | 'network'
  | 'server'
  | 'auth'
  | 'forbidden'
  | 'client'

export interface ApiFailure {
  kind: ApiFailureKind
  status: number
  path: string
}

const failureListeners = new Set<(failure: ApiFailure) => void>()

/** Subscribes to failures that a global recovery surface may need to show. */
export function subscribeApiFailures(
  listener: (failure: ApiFailure) => void,
): () => void {
  failureListeners.add(listener)
  return () => failureListeners.delete(listener)
}

function classifyFailure(status: number): ApiFailureKind {
  if (status === 0) return 'network'
  if (status >= 500) return 'server'
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  return 'client'
}

function reportFailure(path: string, status: number): void {
  const failure: ApiFailure = {
    kind: classifyFailure(status),
    status,
    path,
  }

  for (const listener of failureListeners) {
    try {
      listener(failure)
    } catch {
      // A recovery surface must never break the request that reported it.
    }
  }
}

let inFlightMutations = 0
const busyListeners = new Set<(busy: boolean) => void>()

function notifyBusy(): void {
  const busy = inFlightMutations > 0

  for (const listener of busyListeners) {
    try {
      listener(busy)
    } catch {
      // Ignore listener failures.
    }
  }
}

/** True while a save, upload or other state-changing request is in progress. */
export function hasInFlightMutations(): boolean {
  return inFlightMutations > 0
}

/**
 * Notifies when the number of in-flight state-changing requests crosses zero.
 * The inactivity guard uses this to avoid signing out in the middle of an
 * upload or save while still keeping the session's absolute expiry.
 */
export function subscribeApiBusy(
  listener: (busy: boolean) => void,
): () => void {
  busyListeners.add(listener)
  return () => busyListeners.delete(listener)
}

interface ApiErrorBody {
  error?: {
    message?: string
    code?: string
    details?: ApiFieldError[]
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  /**
   * State-changing requests count as busy by default so the idle guard can wait
   * for them. Background pings opt out.
   */
  busy?: boolean
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  // A misconfigured production bundle must fail with an explicit message
  // rather than silently calling a relative path or a developer machine.
  if (API_CONFIGURATION_ERROR) {
    throw new ApiError(0, API_CONFIGURATION_ERROR)
  }

  const method = options.method ?? 'GET'
  const countsAsBusy = options.busy !== false && method !== 'GET'

  if (countsAsBusy) {
    inFlightMutations += 1
    notifyBusy()
  }

  let response: Response

  try {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        // The API authenticates with an HttpOnly cookie, so every browser call
        // must opt in to sending credentials.
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch {
      reportFailure(path, 0)
      throw new ApiError(
        0,
        'We could not connect to Wise Grade. Check your internet connection and try again.',
      )
    }
  } finally {
    if (countsAsBusy) {
      inFlightMutations = Math.max(0, inFlightMutations - 1)
      notifyBusy()
    }
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json')
  const payload = isJson
    ? ((await response.json()) as { data?: T } & ApiErrorBody)
    : null

  if (!response.ok) {
    reportFailure(path, response.status)
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details ?? [],
      payload?.error?.code ?? null,
    )
  }

  return payload?.data as T
}

export function fetchSession(): Promise<AuthSession> {
  return apiRequest<AuthSession>('/api/auth/me')
}

export function loginRequest(input: LoginInput): Promise<AuthSession> {
  return apiRequest<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: input,
  })
}

export function registerSchoolRequest(
  input: RegisterSchoolInput,
): Promise<RegisterSchoolResult> {
  return apiRequest<RegisterSchoolResult>('/api/auth/register-school', {
    method: 'POST',
    body: input,
  })
}

export function logoutRequest(): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/api/auth/logout', {
    method: 'POST',
    busy: false,
  })
}

/**
 * Records genuine activity on the server so the server-side idle window stays
 * current while the user is working. It does not extend the absolute session
 * expiry.
 */
export function heartbeatRequest(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/auth/heartbeat', {
    method: 'POST',
    busy: false,
  })
}

/**
 * Confirms a single-use administrator email-verification link. The token is
 * sent in the request body, never in a URL the browser writes to logs.
 */
export function confirmEmailVerificationRequest(
  token: string,
): Promise<{ message: string; user: AuthUser | null }> {
  return apiRequest<{ message: string; user: AuthUser | null }>(
    '/api/auth/email-verification/confirm',
    { method: 'POST', body: { token } },
  )
}

/** Requests a fresh verification link; the previous link stops working. */
export function resendEmailVerificationRequest(): Promise<{
  message: string
}> {
  return apiRequest<{ message: string }>(
    '/api/auth/email-verification/resend',
    { method: 'POST' },
  )
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/** Replaces the signed-in user's password and clears forced rotation. */
export function changePasswordRequest(
  input: ChangePasswordInput,
): Promise<{ message: string; user: AuthUser | null }> {
  return apiRequest<{ message: string; user: AuthUser | null }>(
    '/api/auth/change-password',
    { method: 'POST', body: input },
  )
}

/**
 * Opens a restricted subject-teacher session with a reusable access code. The
 * code is exchanged for an HttpOnly session cookie; no account is created.
 */
export function enterAccessCodeRequest(
  code: string,
): Promise<{ subjectSession: SubjectSession }> {
  return apiRequest<{ subjectSession: SubjectSession }>(
    '/api/auth/subject-teacher/access-code',
    { method: 'POST', body: { code } },
  )
}

export function fetchSubjectSession(): Promise<{
  subjectSession: SubjectSession
}> {
  return apiRequest<{ subjectSession: SubjectSession }>(
    '/api/auth/subject-teacher/me',
  )
}

export function subjectLogoutRequest(): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    '/api/auth/subject-teacher/logout',
    { method: 'POST' },
  )
}

/**
 * Downloads a non-JSON response (CSV exports) with credentials and custom
 * headers. The caller is responsible for triggering the browser download.
 */
export async function downloadFile(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; fileName: string | null }> {
  if (API_CONFIGURATION_ERROR) {
    throw new ApiError(0, API_CONFIGURATION_ERROR)
  }

  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: { ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    reportFailure(path, 0)
    throw new ApiError(
      0,
      'We could not connect to Wise Grade. Check your internet connection and try again.',
    )
  }

  if (!response.ok) {
    const isJson = response.headers
      .get('content-type')
      ?.includes('application/json')
    const payload = isJson
      ? ((await response.json()) as ApiErrorBody)
      : null

    reportFailure(path, response.status)
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details ?? [],
      payload?.error?.code ?? null,
    )
  }

  const disposition = response.headers.get('content-disposition')
  const match = disposition?.match(/filename="([^"]+)"/)

  return {
    blob: await response.blob(),
    fileName: match?.[1] ?? null,
  }
}
