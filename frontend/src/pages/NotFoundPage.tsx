import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import BrandMark from '../components/BrandMark'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-gradely-white">
        <div className="mx-auto w-full max-w-6xl px-5 py-4 sm:px-8">
          <BrandMark />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-16">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-gradely-white p-8 text-center shadow-xl shadow-gradely-navy/5">
          <p className="text-sm font-semibold tracking-wider text-gradely-blue uppercase">
            404
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-gradely-navy">
            Page not found
          </h1>
          <p className="mt-3 text-base leading-relaxed text-gradely-muted">
            This part of Wise Grade has not been built yet.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-gradely-white transition-colors hover:bg-[#123c80]"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to the foundation page
          </Link>
        </div>
      </main>
    </div>
  )
}
