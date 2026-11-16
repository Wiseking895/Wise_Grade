import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/use-auth'
import type { Membership } from '../auth/types'
import { getSchoolProfile } from './api'
import { SchoolContext, type SchoolContextValue } from './school-context'
import type { SchoolProfile } from './types'

const STORAGE_KEY = 'gradely.dashboard.schoolId'

function readStoredSchoolId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function SchoolProvider({ children }: { children: ReactNode }) {
  const { memberships, subjectSession } = useAuth()
  // A restricted subject session has no membership row. A display-only
  // membership is synthesised so the shared workspace chrome can render, but it
  // grants nothing: every API call is authorised from the session cookie.
  const subjectMembership = useMemo<Membership | null>(() => {
    if (!subjectSession) return null

    return {
      id: `subject-session:${subjectSession.sessionId}`,
      schoolId: subjectSession.schoolId,
      schoolName: subjectSession.schoolName,
      schoolSlug: subjectSession.schoolSlug,
      role: 'SUBJECT_TEACHER',
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
    }
  }, [subjectSession])

  const activeMemberships = useMemo(
    () =>
      subjectMembership
        ? [subjectMembership]
        : memberships.filter((membership) => membership.status === 'ACTIVE'),
    [memberships, subjectMembership],
  )
  const [storedSchoolId, setStoredSchoolId] = useState<string | null>(
    readStoredSchoolId,
  )
  const [school, setSchool] = useState<SchoolProfile | null>(null)
  const [schoolLoading, setSchoolLoading] = useState(false)

  const membership =
    activeMemberships.find((item) => item.schoolId === storedSchoolId) ??
    activeMemberships[0] ??
    null

  const schoolId = membership?.schoolId ?? null

  const refreshSchool = useCallback(async () => {
    if (!schoolId) {
      setSchool(null)
      return
    }

    try {
      const { school: profile } = await getSchoolProfile(schoolId)
      setSchool(profile)
    } catch {
      // The dashboard remains usable even if the profile request fails; the
      // branding area falls back to initials and the name from the membership.
    }
  }, [schoolId])

  useEffect(() => {
    if (!schoolId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSchool(null)
      return
    }

    let cancelled = false
    setSchoolLoading(true)

    void getSchoolProfile(schoolId)
      .then(({ school: profile }) => {
        if (!cancelled) {
          setSchool(profile)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSchool(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSchoolLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [schoolId])

  const selectSchool = useCallback((nextSchoolId: string) => {
    setStoredSchoolId(nextSchoolId)

    try {
      window.localStorage.setItem(STORAGE_KEY, nextSchoolId)
    } catch {
      // Private browsing can reject storage; the in-memory selection remains.
    }
  }, [])

  const value = useMemo<SchoolContextValue>(
    () => ({
      memberships: activeMemberships,
      membership,
      schoolId,
      role: membership?.role ?? null,
      isAdmin: membership?.role === 'SCHOOL_ADMIN',
      isSubjectSession: subjectSession !== null,
      subjectSession,
      school,
      logoUrl: school?.logoUrl ?? null,
      // Only signal incompleteness once the profile has actually loaded.
      profileComplete: school ? school.profileComplete : true,
      schoolLoading,
      refreshSchool,
      selectSchool,
    }),
    [
      activeMemberships,
      membership,
      schoolId,
      school,
      schoolLoading,
      refreshSchool,
      selectSchool,
      subjectSession,
    ],
  )

  return (
    <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>
  )
}
