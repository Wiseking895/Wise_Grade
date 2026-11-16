import { GraduationCap, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ROLE_LABELS } from '../auth/types'
import { useAuth } from '../auth/use-auth'
import AppHeader from '../components/AppHeader'

export default function DashboardPage() {
  const { user, memberships } = useAuth()

  if (!user) {
    return null
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradely-light">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <div className="flex flex-col gap-2">
          <p className="inline-flex w-fit items-center gap-2 rounded-full bg-gradely-green/10 px-3 py-1 text-xs font-semibold tracking-wider text-[#137026] uppercase">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            Phase 2 preview
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight text-gradely-navy sm:text-4xl">
            Welcome, {user.firstName}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-gradely-muted">
            You are signed in as <span className="font-medium text-gradely-text">{user.email}</span>.
            This placeholder replaces the future school dashboard.
          </p>
        </div>

        <section aria-labelledby="schools-heading" className="mt-10">
          <h2
            id="schools-heading"
            className="text-lg font-bold tracking-tight text-gradely-text"
          >
            Your schools
          </h2>

          {memberships.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-gradely-white p-6 text-sm text-gradely-muted">
              No school membership is attached to this account. School
              membership is required for school-scoped access.
            </p>
          ) : (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {memberships.map((membership) => (
                <li
                  key={membership.id}
                  className="rounded-2xl border border-slate-200 bg-gradely-white p-5 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-gradely-blue/10 p-2">
                      <GraduationCap
                        aria-hidden="true"
                        className="size-5 text-gradely-blue"
                      />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-gradely-text">
                        {membership.schoolName}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-gradely-muted">
                        {membership.schoolSlug}
                      </p>
                    </div>
                  </div>

                  <dl className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-gradely-navy/5 px-2.5 py-1 font-semibold text-gradely-navy">
                      <dt className="sr-only">Role</dt>
                      <dd>{ROLE_LABELS[membership.role]}</dd>
                    </div>
                    <div
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${
                        membership.status === 'ACTIVE'
                          ? 'bg-gradely-green/10 text-[#137026]'
                          : 'bg-gradely-gold/15 text-[#7a5400]'
                      }`}
                    >
                      <dt className="sr-only">Status</dt>
                      <dd>
                        {membership.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-gradely-gold/30 bg-gradely-gold/10 p-5 text-sm leading-relaxed text-[#6b4a00]">
          <p className="font-semibold">What is not built yet</p>
          <p className="mt-1">
            Teacher invitations, classes, pupils, subjects, assessments, and
            report cards arrive in later phases. This page exists to verify
            authentication and tenant-scoped membership.
          </p>
          <Link
            to="/"
            className="mt-3 inline-block font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
          >
            Back to the Wise Grade overview
          </Link>
        </section>
      </main>
    </div>
  )
}
