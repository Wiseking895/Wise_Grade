import {
  Building2,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/use-auth'
import AppHeader from '../components/AppHeader'

const foundationItems = [
  {
    icon: Building2,
    title: 'Multi-school schema',
    description:
      'Schools, memberships, academic years and terms are modelled with tenant-scoped indexes.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure authentication',
    description:
      'School registration, sign-in, hashed passwords, opaque sessions and login rate limiting.',
  },
  {
    icon: Users,
    title: 'Tenant isolation',
    description:
      'Every school-scoped request is checked against the signed-in user’s membership.',
  },
]

export default function PlaceholderPage() {
  const { status } = useAuth()

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8 sm:py-16">
        <div className="w-full max-w-4xl">
          <section
            aria-labelledby="gradely-heading"
            className="overflow-hidden rounded-3xl border border-slate-200 bg-gradely-white shadow-xl shadow-gradely-navy/5"
          >
            <div
              aria-hidden="true"
              className="h-1.5 bg-gradient-to-r from-gradely-navy via-gradely-blue to-gradely-green"
            />

            <div className="px-6 py-10 text-center sm:px-12 sm:py-14">
              <h1
                id="gradely-heading"
                className="text-5xl font-extrabold tracking-tight text-gradely-navy sm:text-6xl"
              >
                Wise Grade
              </h1>

              <p className="mt-3 text-xl font-semibold text-gradely-text sm:text-2xl">
                Smarter Reports. Better Learning.
              </p>

              <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-gradely-muted">
                School registration, sign-in, roles, and tenant-scoped access
                are in place. Classes, pupils, assessments, and report cards
                will arrive in later phases.
              </p>

              <ul className="mt-10 grid gap-3 text-left sm:grid-cols-3">
                {foundationItems.map(({ icon: Icon, title, description }) => (
                  <li
                    key={title}
                    className="rounded-2xl border border-slate-200 bg-gradely-light p-4"
                  >
                    <Icon
                      aria-hidden="true"
                      className="size-5 text-gradely-blue"
                    />
                    <h2 className="mt-3 text-sm font-semibold text-gradely-text">
                      {title}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
                      {description}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                {status === 'authenticated' ? (
                  <Link
                    to="/dashboard"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-gradely-navy px-5 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] sm:w-auto"
                  >
                    Open your dashboard
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/register"
                      className="inline-flex w-full items-center justify-center rounded-xl bg-gradely-navy px-5 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80] sm:w-auto"
                    >
                      Register your school
                    </Link>
                    <Link
                      to="/login"
                      className="inline-flex w-full items-center justify-center rounded-xl border border-gradely-navy/20 bg-gradely-white px-5 py-2.5 text-sm font-semibold text-gradely-navy transition-colors hover:bg-gradely-light sm:w-auto"
                    >
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-gradely-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-5 text-sm text-gradely-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Wise Grade &mdash; Smarter Reports. Better Learning.</p>
          <p>Copyright © 2026</p>
        </div>
      </footer>
    </div>
  )
}
