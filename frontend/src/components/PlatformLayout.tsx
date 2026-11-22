import {
  Activity,
  ArchiveRestore,
  Bell,
  Building2,
  CalendarDays,
  Download,
  FileCheck2,
  FileClock,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Scale,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import BrandMark from '../components/BrandMark'
import { PlatformReauthProvider } from '../platform/reauth'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  end?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/platform/schools', label: 'Schools', icon: Building2 },
      { to: '/platform/accounts', label: 'Accounts', icon: Users },
      { to: '/platform/monitoring', label: 'Academic monitoring', icon: Activity },
      { to: '/platform/health', label: 'Platform health', icon: HeartPulse },
      { to: '/platform/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Academics',
    items: [
      { to: '/platform/reports', label: 'Report requests', icon: FileCheck2 },
      { to: '/platform/calendar', label: 'Academic calendar', icon: CalendarDays },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/platform/billing', label: 'Payments', icon: ReceiptText },
      { to: '/platform/reconciliation', label: 'Reconciliation', icon: Scale },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/platform/security', label: 'Security & sessions', icon: ShieldCheck },
      { to: '/platform/exports', label: 'Data exports', icon: Download },
      { to: '/platform/settings', label: 'Platform settings', icon: Settings },
      { to: '/platform/audit', label: 'Audit logs', icon: FileClock },
      {
        to: '/platform/accounts/deleted',
        label: 'Deleted Accounts History',
        icon: ArchiveRestore,
      },
      { to: '/platform/account', label: 'My account', icon: UserRound },
    ],
  },
]

const PAGE_HEADINGS: Record<string, { title: string; subtitle: string }> = {
  '/platform': {
    title: 'Platform overview',
    subtitle: 'Live figures across every Wise Grade school',
  },
  '/platform/schools': {
    title: 'Schools',
    subtitle: 'Register, inspect and control school tenants',
  },
  '/platform/accounts': {
    title: 'Accounts',
    subtitle: 'Suspend, delete and review platform-managed accounts',
  },
  '/platform/accounts/deleted': {
    title: 'Deleted Accounts History',
    subtitle: 'Permanent archive of deleted accounts and their restoration record',
  },
  '/platform/monitoring': {
    title: 'Academic monitoring',
    subtitle: 'Result entry, school academic review and report readiness',
  },
  '/platform/health': {
    title: 'Platform health',
    subtitle: 'Database, migrations, storage, scheduler and payment integrations',
  },
  '/platform/notifications': {
    title: 'Notifications',
    subtitle: 'Operational inbox with read state and school references',
  },
  '/platform/reports': {
    title: 'Report requests',
    subtitle: 'Administrator-accepted requests and report generation',
  },
  '/platform/calendar': {
    title: 'Academic calendar',
    subtitle: 'Centrally managed academic years and terms',
  },
  '/platform/billing': {
    title: 'Payments',
    subtitle: 'Pricing, invoices, payment verification and audit',
  },
  '/platform/reconciliation': {
    title: 'Payment reconciliation',
    subtitle: 'Detect and acknowledge mismatched, duplicate and stale payments',
  },
  '/platform/security': {
    title: 'Security & sessions',
    subtitle: 'Multi-factor authentication, login monitoring and session control',
  },
  '/platform/exports': {
    title: 'Data exports',
    subtitle: 'Privacy-minimized CSV extracts with audit logging',
  },
  '/platform/settings': {
    title: 'Platform settings',
    subtitle: 'Operational platform-wide configuration',
  },
  '/platform/audit': {
    title: 'Audit logs',
    subtitle: 'Append-only platform, billing and calendar history',
  },
  '/platform/account': {
    title: 'My account',
    subtitle: 'Your platform identity and security',
  },
}

function resolveHeading(pathname: string): { title: string; subtitle: string } {
  const exact = PAGE_HEADINGS[pathname]

  if (exact) {
    return exact
  }

  if (pathname.startsWith('/platform/reports')) {
    return PAGE_HEADINGS['/platform/reports']
  }

  if (pathname.startsWith('/platform/schools')) {
    return PAGE_HEADINGS['/platform/schools']
  }

  return PAGE_HEADINGS['/platform']
}

export default function PlatformLayout() {
  const { user, memberships, logout } = useAuth()
  const { pathname } = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const heading = resolveHeading(pathname)

  async function handleLogout() {
    setSigningOut(true)

    try {
      await logout()
    } finally {
      setSigningOut(false)
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-4">
        <BrandMark />
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close navigation"
          className="rounded-lg p-1.5 text-gradely-muted hover:bg-slate-100 lg:hidden"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="mx-4 rounded-xl border border-gradely-navy/10 bg-gradely-light px-3 py-2.5">
        <p className="flex items-center gap-2 text-sm font-bold text-gradely-navy">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Platform administration
        </p>
        <p className="mt-0.5 text-xs text-gradely-muted">
          Super administrator
        </p>
      </div>

      <nav
        aria-label="Platform dashboard"
        className="mt-4 flex-1 space-y-4 overflow-y-auto px-3 pb-4"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gradely-muted">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
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
            </div>
          </div>
        ))}

        {memberships.length > 0 ? (
          <div>
            <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gradely-muted">
              Personal
            </p>
            <Link
              to="/dashboard"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-gradely-navy/5 hover:text-gradely-navy"
            >
              <LayoutDashboard aria-hidden="true" className="size-4.5 shrink-0" />
              School dashboard
            </Link>
          </div>
        ) : null}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-sm font-semibold text-gradely-text">
          {user ? `${user.firstName} ${user.lastName}` : 'Platform admin'}
        </p>
        <p className="truncate text-xs text-gradely-muted">{user?.email}</p>
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={signingOut}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-gradely-text transition-colors hover:bg-gradely-light disabled:opacity-60"
        >
          <LogOut aria-hidden="true" className="size-4" />
          {signingOut ? 'Signing out…' : 'Log out'}
        </button>
      </div>
    </div>
  )

  return (
    <PlatformReauthProvider>
      <div className="min-h-screen bg-gradely-light">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-white lg:block">
        {sidebar}
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
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

      <div className="flex min-h-screen flex-col lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
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
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-gradely-navy">
                  {heading.title}
                </p>
                <p className="text-xs text-gradely-muted">{heading.subtitle}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-gradely-muted sm:px-6">
          Wise Grade · Platform administration
        </footer>
      </div>
      </div>
    </PlatformReauthProvider>
  )
}
