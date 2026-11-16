import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import BrandMark from './BrandMark'

export default function AppHeader() {
  const { status, user, logout } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function handleLogout() {
    setSigningOut(true)

    try {
      await logout()
    } catch {
      // AuthProvider clears local state even when the request fails; the
      // server session expires on its own if it could not be revoked.
    } finally {
      setSigningOut(false)
      navigate('/login', { replace: true })
    }
  }

  return (
    <header className="border-b border-slate-200 bg-gradely-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <BrandMark />

        <nav
          aria-label="Account"
          className="flex items-center gap-2 sm:gap-3"
        >
          {status === 'loading' ? (
            <span
              aria-hidden="true"
              className="h-9 w-24 animate-pulse rounded-xl bg-slate-100"
            />
          ) : null}

          {status === 'anonymous' ? (
            <>
              <Link
                to="/login"
                className="rounded-xl px-3 py-2 text-sm font-semibold text-gradely-navy transition-colors hover:bg-gradely-light"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-xl bg-gradely-navy px-3 py-2 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] sm:px-4"
              >
                Create school account
              </Link>
            </>
          ) : null}

          {status === 'authenticated' && user ? (
            <>
              <span className="hidden text-sm text-gradely-muted sm:inline">
                {user.firstName} {user.lastName}
              </span>
              <Link
                to="/dashboard"
                className="rounded-xl border border-gradely-navy/15 px-3 py-2 text-sm font-semibold text-gradely-navy transition-colors hover:bg-gradely-light"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={signingOut}
                className="inline-flex items-center gap-1.5 rounded-xl px-2 py-2 text-sm font-semibold text-gradely-muted transition-colors hover:bg-gradely-light hover:text-gradely-text disabled:cursor-wait disabled:opacity-60 sm:px-3"
              >
                {signingOut ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                ) : null}
                Sign out
              </button>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  )
}
