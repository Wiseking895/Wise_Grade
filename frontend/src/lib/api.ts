import type {
  AuthSession,
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

  constructor(status: number, message: string, details: ApiFieldError[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

interface ApiErrorBody {
  error?: {
    message?: string
    details?: ApiFieldError[]
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
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

  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
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
    throw new ApiError(
      0,
      'Could not reach the Wise Grade API. Check that the backend is running.',
    )
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json')
  const payload = isJson
    ? ((await response.json()) as { data?: T } & ApiErrorBody)
    : null

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details ?? [],
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
  })
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
    throw new ApiError(
      0,
      'Could not reach the Wise Grade API. Check that the backend is running.',
    )
  }

  if (!response.ok) {
    const isJson = response.headers
      .get('content-type')
      ?.includes('application/json')
    const payload = isJson
      ? ((await response.json()) as ApiErrorBody)
      : null

    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details ?? [],
    )
  }

  const disposition = response.headers.get('content-disposition')
  const match = disposition?.match(/filename="([^"]+)"/)

  return {
    blob: await response.blob(),
    fileName: match?.[1] ?? null,
  }
}
