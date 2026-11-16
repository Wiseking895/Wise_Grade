import type { ReactNode } from 'react'
import BrandMark from './BrandMark'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-gradely-light">
      <header className="border-b border-slate-200 bg-gradely-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-3 sm:px-8">
          <BrandMark />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 sm:py-14">
        <div className="w-full max-w-lg">
          <section
            aria-labelledby="auth-heading"
            className="overflow-hidden rounded-3xl border border-slate-200 bg-gradely-white shadow-xl shadow-gradely-navy/5"
          >
            <div
              aria-hidden="true"
              className="h-1.5 bg-gradient-to-r from-gradely-navy via-gradely-blue to-gradely-green"
            />
            <div className="px-6 py-8 sm:px-10 sm:py-10">
              <h1
                id="auth-heading"
                className="text-2xl font-extrabold tracking-tight text-gradely-navy sm:text-3xl"
              >
                {title}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-gradely-muted sm:text-base">
                {subtitle}
              </p>

              <div className="mt-8">{children}</div>
            </div>
          </section>

          {footer ? <div className="mt-6 text-center">{footer}</div> : null}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-gradely-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-4 text-center text-sm text-gradely-muted sm:px-8">
          Wise Grade &mdash; Smarter Reports. Better Learning.
        </div>
      </footer>
    </div>
  )
}
