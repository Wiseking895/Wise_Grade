import {
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  School,
  Table2,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ROLE_LABELS, type SchoolRole } from '../auth/types'
import { useAuth } from '../auth/use-auth'
import LocationIndicator from './LocationIndicator'
import { apiAssetUrl } from '../lib/api'
import { schoolLogoSrc } from '../schools/logo'
import { useSchool } from '../schools/use-school'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  roles: SchoolRole[]
}

const ADMIN_ROLES: SchoolRole[] = ['SCHOOL_ADMIN']
const TEACHER_ROLES: SchoolRole[] = ['CLASS_TEACHER', 'SUBJECT_TEACHER']
const CLASS_TEACHER_ROLES: SchoolRole[] = ['CLASS_TEACHER']
const ALL_SCHOOL_ROLES: SchoolRole[] = [
  'SCHOOL_ADMIN',
  'CLASS_TEACHER',
  'SUBJECT_TEACHER',
]

/**
 * The school workspace is deliberately narrow. School administrators own
 * academic review and acceptance; the platform owns report generation. Teachers
 * enter scores and manage their assigned classes. School administrators keep
 * read-only class/subject/pupil visibility, teacher registration and
 * administrative information.
 */
const NAV_ITEMS: NavItem[] = [  {
    to: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    end: true,
    roles: ALL_SCHOOL_ROLES,
  },
  {
    to: '/dashboard/school',
    label: 'School profile',
    icon: School,
    roles: ADMIN_ROLES,
  },
  {
    to: '/dashboard/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    roles: ALL_SCHOOL_ROLES,
  },
  {
    to: '/dashboard/classes',
    label: 'Classes',
    icon: Users,
    roles: ['SUBJECT_TEACHER'],
  },
  {
    to: '/dashboard/pupils',
    label: 'Pupils',
    icon: UserRound,
    roles: CLASS_TEACHER_ROLES,
  },
  {
    to: '/dashboard/attendance',
    label: 'Attendance',
    icon: CalendarCheck,
    roles: CLASS_TEACHER_ROLES,
  },
  {
    to: '/dashboard/teacher-remarks',
    label: "Teacher's remarks",
    icon: MessageSquareText,
    roles: CLASS_TEACHER_ROLES,
  },
  {
    to: '/dashboard/attitude',
    label: 'Attitude',
    icon: HeartHandshake,
    roles: CLASS_TEACHER_ROLES,
  },
  {
    to: '/dashboard/teachers',
    label: 'Teachers',
    icon: GraduationCap,
    roles: ADMIN_ROLES,
  },
  {
    to: '/dashboard/billing',
    label: 'Billing & payments',
    icon: Wallet,
    roles: ADMIN_ROLES,
  },
  {
    to: '/dashboard/assessments/scores',
    label: 'Score entry',
    icon: Table2,
    roles: TEACHER_ROLES,
  },
  {
    to: '/dashboard/assessments/submissions',
    label: 'Submissions',
    icon: ClipboardList,
    roles: ['SCHOOL_ADMIN', 'CLASS_TEACHER', 'SUBJECT_TEACHER'],
  },
  {
    to: '/dashboard/assessments/review',
    label: 'Result review',
    icon: ClipboardCheck,
    roles: ADMIN_ROLES,
  },
  {
    to: '/dashboard/reports',
    label: 'Reports',
    icon: FileText,
    roles: ADMIN_ROLES,
  },
]

/**
 * A restricted subject access-code session only ever sees its own workspace:
 * the overview, score entry and submissions. Every other school endpoint is
 * denied by the backend regardless of navigation.
 */
const SUBJECT_SESSION_PATHS = [
  '/dashboard',
  '/dashboard/assessments/scores',
  '/dashboard/assessments/submissions',
]

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Renders the active school's own logo. When no logo exists (or it cannot be
 * loaded) a neutral initials mark is shown; the Wise Grade mark is never
 * substituted for a school logo.
 */
function SchoolLogo({
  name,
  logoUrl,
  className = 'size-10',
}: {
  name: string
  logoUrl: string | null
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const logoSrc = schoolLogoSrc(logoUrl, failedUrl)

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}
    >
      {logoSrc ? (
        // The API is a separate origin from the web app. The logo route returns
        // `Cross-Origin-Resource-Policy: cross-origin` and participates in the
        // API's credentialed CORS allow-list, so this authenticated image loads
        // without exposing the private storage key.
        <img
          src={apiAssetUrl(logoSrc)}
          alt={`${name} logo`}
          crossOrigin="use-credentials"
          className="h-full w-full object-contain"
          onError={() => setFailedUrl(logoSrc)}
        />
      ) : (
        <span
          aria-hidden="true"
          className="text-xs font-bold text-gradely-navy"
        >
          {initialsFor(name) || 'SC'}
        </span>
      )}
    </span>
  )
}

export default function DashboardLayout() {
  const { user, subjectSession, logout } = useAuth()
  const {
    membership,
    memberships,
    role,
    selectSchool,
    logoUrl,
    profileComplete,
    isAdmin,
    isSubjectSession,
  } = useSchool()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const displayName = subjectSession
    ? `${subjectSession.teacher.firstName} ${subjectSession.teacher.lastName}`.trim()
    : user
      ? `${user.firstName} ${user.lastName}`.trim()
      : ''
  const displayEmail = subjectSession
    ? (subjectSession.teacher.email ?? 'Access-code session')
    : (user?.email ?? '')

  async function handleLogout() {
    setSigningOut(true)

    try {
      await logout()
    } finally {
      setSigningOut(false)
    }
  }

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (isSubjectSession) {
      return SUBJECT_SESSION_PATHS.includes(item.to)
    }

    return role !== null && item.roles.includes(role)
  }).map((item) =>
    item.to === '/dashboard' && role === 'CLASS_TEACHER'
      ? { ...item, label: 'Class Dashboard' }
      : item,
  )

  if (!membership || (!user && !subjectSession)) {
    return (
      <div className="flex min-h-screen flex-col bg-gradely-light">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
            <span className="text-lg font-bold text-gradely-navy">
              Wise Grade
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gradely-muted hover:bg-gradely-light"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </button>
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-16">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <span className="mx-auto inline-flex rounded-2xl bg-gradely-gold/15 p-3">
              <School aria-hidden="true" className="size-6 text-[#7a5400]" />
            </span>
            <h1 className="mt-4 text-xl font-bold text-gradely-text">
              No active school membership
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-gradely-muted">
              Your account is signed in, but it is not attached to an active
              school. Ask a school administrator or the platform team to review
              your membership.
            </p>
          </div>
        </main>
      </div>
    )
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <SchoolLogo
            name={membership.schoolName}
            logoUrl={logoUrl}
            className="size-11"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gradely-navy">
              {membership.schoolName}
            </p>
            <p className="mt-0.5 text-xs text-gradely-muted">
              {ROLE_LABELS[membership.role]}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
          className="rounded-lg p-1.5 text-gradely-muted hover:bg-slate-100 lg:hidden"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <nav
        aria-label="School dashboard"
        className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4"
      >
        {visibleItems.map((item) => {
          const Icon = item.icon

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-gradely-navy text-white shadow-sm'
                    : 'text-slate-600 hover:bg-gradely-navy/5 hover:text-gradely-navy'
                }`
              }
            >
              <Icon aria-hidden="true" className="size-4.5 shrink-0" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-sm font-semibold text-gradely-text">
          {displayName || 'Subject teacher'}
        </p>
        <p className="truncate text-xs text-gradely-muted">{displayEmail}</p>
        {subjectSession ? (
          <p className="mt-1 truncate text-xs font-medium text-gradely-blue">
            {subjectSession.className} · {subjectSession.subjectName}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={signingOut}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-gradely-text transition-colors hover:bg-gradely-light disabled:opacity-60"
        >
          {signingOut ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <LogOut aria-hidden="true" className="size-4" />
          )}
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradely-light print:bg-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-white lg:block print:hidden">
        {sidebar}
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-slate-900/50"
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl">
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col lg:pl-72 print-reset">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
                className="rounded-xl border border-slate-300 p-2 text-gradely-text hover:bg-gradely-light lg:hidden"
              >
                <Menu aria-hidden="true" className="size-5" />
              </button>
              <SchoolLogo
                name={membership.schoolName}
                logoUrl={logoUrl}
                className="size-9"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gradely-navy">
                  {membership.schoolName}
                </p>
                <p className="text-xs text-gradely-muted">
                  {ROLE_LABELS[membership.role]}
                </p>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {memberships.length > 1 ? (
                <label className="flex items-center gap-2 text-xs font-semibold text-gradely-muted">
                  <span className="hidden sm:inline">School</span>
                  <select
                    aria-label="Switch school"
                    value={membership.schoolId}
                    onChange={(event) => selectSchool(event.target.value)}
                    className="max-w-48 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-gradely-text shadow-sm"
                  >
                    {memberships.map((item) => (
                      <option key={item.schoolId} value={item.schoolId}>
                        {item.schoolName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <LocationIndicator />
            </div>
          </div>
        </header>

        <main className="print-main mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 print:max-w-none print:p-0">
          {!profileComplete && !isSubjectSession ? (
            <div
              role="status"
              className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2">
                <School
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>
                  Complete your school profile — logo, landmark, postal address
                  and mobile number — before terminal reports can be generated.
                </span>
              </p>
              {isAdmin ? (
                <Link
                  to="/dashboard/school"
                  className="shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
                >
                  Complete profile
                </Link>
              ) : null}
            </div>
          ) : null}
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-gradely-muted sm:px-6 print:hidden">
          Wise Grade · Smarter Reports. Better Learning.
        </footer>
      </div>
    </div>
  )
}
