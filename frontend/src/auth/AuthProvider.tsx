import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiError,
  changePasswordRequest,
  clearSubjectSessionHint,
  confirmEmailVerificationRequest,
  enterAccessCodeRequest,
  fetchSession,
  fetchSubjectSession,
  hasSubjectSessionHint,
  loginRequest,
  logoutRequest,
  registerSchoolRequest,
  rememberSubjectSessionHint,
  resendEmailVerificationRequest,
  subjectLogoutRequest,
  subscribeApiFailures,
} from '../lib/api'
import { clearRecoveryAttempts } from '../lib/recovery'
import { AuthContext } from './auth-context'
import type {
  AuthState,
  RegisterSchoolInput,
  SessionEndReason,
} from './types'

const ANONYMOUS: AuthState = {
  status: 'anonymous',
  user: null,
  memberships: [],
  subjectSession: null,
}

const LOADING: AuthState = {
  status: 'loading',
  user: null,
  memberships: [],
  subjectSession: null,
}

/**
 * Authentication could not be resolved because the API was unreachable or
 * returned a server error. This is deliberately distinct from `anonymous`: a
 * temporary outage must not look like "you are signed out" and must never send
 * the user through a sign-in they do not need.
 */
const ERROR_STATE: AuthState = {
  status: 'error',
  user: null,
  memberships: [],
  subjectSession: null,
}

/**
 * Resolves whichever session cookie the browser holds. A normal account session
 * is checked first; a restricted subject session is a separate cookie and is
 * only consulted when no account session exists.
 */
async function loadAuthState(): Promise<AuthState> {
  try {
    const session = await fetchSession()
    return {
      status: 'authenticated',
      user: session.user,
      memberships: session.memberships,
      subjectSession: null,
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      return ERROR_STATE
    }

    // A network failure or 5xx means the account state is unknown. Do not
    // pretend the user is anonymous.
    if (error.status === 0 || error.status >= 500) {
      return ERROR_STATE
    }

    // Only a 401 means "no account session". A 403 (for example a required
    // password change) is handled by the route guards after a successful load.
    if (error.status !== 401) {
      return ANONYMOUS
    }
  }

  // A normal account never records the marker, so it never provokes the
  // guaranteed 401 from the restricted endpoint. The HttpOnly subject session
  // remains the only credential that endpoint accepts.
  if (!hasSubjectSessionHint()) {
    return ANONYMOUS
  }

  try {
    const { subjectSession } = await fetchSubjectSession()
    rememberSubjectSessionHint()
    return {
      status: 'authenticated',
      user: null,
      memberships: [],
      subjectSession,
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSubjectSessionHint()
      return ANONYMOUS
    }

    if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
      return ERROR_STATE
    }

    return ANONYMOUS
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(LOADING)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const stateRef = useRef(state)
  const logoutInFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const refresh = useCallback(async () => {
    setState(await loadAuthState())
  }, [])

  useEffect(() => {
    let cancelled = false

    loadAuthState().then((next) => {
      if (!cancelled) {
        setState(next)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  // The recovery counter is cleared only after authentication has actually
  // resolved, not merely because the HTML document loaded.
  useEffect(() => {
    if (state.status === 'authenticated' || state.status === 'anonymous') {
      clearRecoveryAttempts()
    }
  }, [state.status])

  // A genuine 401 from a protected endpoint means the session ended. Sign out
  // once, centrally, and show the controlled recovery notice. The login,
  // session-probe and heartbeat endpoints are excluded because their 401s are
  // expected states, not a lost session.
  useEffect(() => {
    return subscribeApiFailures((failure) => {
      if (failure.kind !== 'auth') return
      if (failure.path.startsWith('/api/auth/')) return
      if (stateRef.current.status !== 'authenticated') return

      setSessionNotice('Your session has ended. Please sign in again to continue.')
      setState(ANONYMOUS)
      clearSubjectSessionHint()
    })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const session = await loginRequest({ email, password })

    // The login response only proves the server created a session. Confirm the
    // browser actually stored and returned the cookie before showing an
    // authenticated UI. Safari can silently drop a third-party cookie, which
    // otherwise surfaces later as a misleading "Authentication required" on the
    // first state-changing request.
    try {
      await fetchSession()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw new ApiError(
          401,
          'Sign-in succeeded, but this browser did not keep the session cookie.',
          [],
          'session_cookie_blocked',
        )
      }

      throw error
    }

    // An account session takes precedence over a restricted subject session,
    // so drop any stale subject marker.
    clearSubjectSessionHint()
    setSessionNotice(null)
    setState({
      status: 'authenticated',
      user: session.user,
      memberships: session.memberships,
      subjectSession: null,
    })
    return session
  }, [])

  const registerSchool = useCallback(async (input: RegisterSchoolInput) => {
    const session = await registerSchoolRequest(input)
    clearSubjectSessionHint()
    setSessionNotice(null)
    setState({
      status: 'authenticated',
      user: session.user,
      memberships: session.memberships,
      subjectSession: null,
    })
  }, [])

  const enterAccessCode = useCallback(async (code: string) => {
    const { subjectSession } = await enterAccessCodeRequest(code.trim())
    rememberSubjectSessionHint()
    setSessionNotice(null)
    setState({
      status: 'authenticated',
      user: null,
      memberships: [],
      subjectSession,
    })
    return subjectSession
  }, [])

  const confirmEmailVerification = useCallback(
    async (token: string) => {
      const result = await confirmEmailVerificationRequest(token)
      // The endpoint works with or without a session. Refresh only when this
      // browser actually holds the account session whose flags changed.
      if (state.status === 'authenticated' && state.user) {
        await refresh()
      }
      return result.message
    },
    [refresh, state.status, state.user],
  )

  const resendEmailVerification = useCallback(async () => {
    const result = await resendEmailVerificationRequest()
    return result.message
  }, [])

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await changePasswordRequest({ currentPassword, newPassword })
      await refresh()
    },
    [refresh],
  )

  const logout = useCallback(
    (reason: SessionEndReason = 'manual'): Promise<void> => {
      // Several simultaneous 401s (or a timer racing a manual click) must send
      // exactly one sign-out request. Callers share the same promise.
      if (logoutInFlightRef.current) {
        return logoutInFlightRef.current
      }

      const subjectSession = stateRef.current.subjectSession

      const run = (async () => {
        try {
          if (subjectSession) {
            await subjectLogoutRequest()
          } else {
            await logoutRequest()
          }
        } catch {
          // The local session is cleared even when the network call fails; the
          // server session still expires on its own absolute/idle limit.
        } finally {
          clearSubjectSessionHint()
          setState(ANONYMOUS)

          if (reason === 'idle') {
            setSessionNotice(
              'You were signed out because there was no activity for 60 seconds. Sign in again to continue.',
            )
          } else if (reason === 'expired') {
            setSessionNotice('Your session has ended. Please sign in again to continue.')
          }
        }
      })()

      logoutInFlightRef.current = run

      return run.finally(() => {
        logoutInFlightRef.current = null
      })
    },
    [],
  )

  const dismissSessionNotice = useCallback(() => {
    setSessionNotice(null)
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      login,
      registerSchool,
      enterAccessCode,
      confirmEmailVerification,
      resendEmailVerification,
      changePassword,
      logout,
      refresh,
      sessionNotice,
      dismissSessionNotice,
    }),
    [
      state,
      login,
      registerSchool,
      enterAccessCode,
      confirmEmailVerification,
      resendEmailVerification,
      changePassword,
      logout,
      refresh,
      sessionNotice,
      dismissSessionNotice,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
