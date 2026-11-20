import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
} from '../lib/api'
import { AuthContext } from './auth-context'
import type { AuthState, RegisterSchoolInput } from './types'

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
    // Only a 401 means "no account session". A network or server error must
    // not turn into an unrelated subject-session request.
    if (!(error instanceof ApiError) || error.status !== 401) {
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
    }

    return ANONYMOUS
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(LOADING)

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

  const logout = useCallback(async () => {
    const subjectSession = state.subjectSession

    try {
      if (subjectSession) {
        await subjectLogoutRequest()
      } else {
        await logoutRequest()
      }
    } finally {
      clearSubjectSessionHint()
      // Clear local state even if the network call failed so the UI cannot
      // remain stuck in an authenticated shell.
      setState(ANONYMOUS)
    }
  }, [state.subjectSession])

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
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
