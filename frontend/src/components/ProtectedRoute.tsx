import { Loader2 } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/use-auth'
import { useSchool } from '../schools/use-school'

const AUTH_LOADING_LABEL = 'Checking your session...'

export function SessionLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradely-light px-5">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-gradely-white px-5 py-4 text-sm font-medium text-gradely-muted shadow-sm"
      >
        <Loader2
          aria-hidden="true"
          className="size-5 animate-spin text-gradely-blue"
        />
        {AUTH_LOADING_LABEL}
      </div>
    </div>
  )
}

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <SessionLoadingScreen />
  }

  if (status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  return <>{children}</>
}

/**
 * Platform-wide administration is separate from school membership. A school
 * administrator can never satisfy this guard, even if they also hold a school
 * role, because the API checks `isPlatformAdmin` independently.
 */
export function PlatformProtectedRoute({
  children,
}: {
  children: ReactNode
}) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <SessionLoadingScreen />
  }

  if (status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  if (!user?.isPlatformAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

/** School configuration and teacher management are limited to school administrators. */
export function SchoolAdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useSchool()

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

/**
 * Score entry, drafts and submission status belong to teaching staff only.
 * A school administrator cannot enter or submit assessment scores.
 */
export function TeacherRoute({ children }: { children: ReactNode }) {
  const { role } = useSchool()

  if (role !== 'CLASS_TEACHER' && role !== 'SUBJECT_TEACHER') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

/** Pupil registration and management belong to the assigned class teacher. */
export function ClassTeacherRoute({ children }: { children: ReactNode }) {
  const { role } = useSchool()

  if (role !== 'CLASS_TEACHER') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

/**
 * The standalone class listing is a read-only reference for subject teachers.
 * Class teachers manage their own class from the Class Dashboard instead, and a
 * restricted subject access-code session has no standalone listing at all.
 */
export function SubjectTeacherRoute({ children }: { children: ReactNode }) {
  const { role, isSubjectSession } = useSchool()

  if (isSubjectSession || role !== 'SUBJECT_TEACHER') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

/**
 * Calendar and released-report browsing belong to full school members. A
 * restricted subject session is redirected to its own workspace; the API also
 * rejects these endpoints independently.
 */
export function FullSchoolMemberRoute({
  children,
}: {
  children: ReactNode
}) {
  const { isSubjectSession } = useSchool()

  if (isSubjectSession) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
