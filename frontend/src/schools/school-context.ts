import { createContext } from 'react'
import type { Membership, SchoolRole, SubjectSession } from '../auth/types'
import type { SchoolProfile } from './types'

export interface SchoolContextValue {
  memberships: Membership[]
  membership: Membership | null
  schoolId: string | null
  role: SchoolRole | null
  isAdmin: boolean
  /** True when the active identity is a restricted subject access-code session. */
  isSubjectSession: boolean
  subjectSession: SubjectSession | null
  school: SchoolProfile | null
  logoUrl: string | null
  profileComplete: boolean
  schoolLoading: boolean
  refreshSchool(): Promise<void>
  selectSchool(schoolId: string): void
}

export const SchoolContext = createContext<SchoolContextValue | null>(null)
