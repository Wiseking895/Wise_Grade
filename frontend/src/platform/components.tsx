import type { ReactNode } from 'react'
import { Badge } from '../components/ui'

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'neutral' | 'success' | 'warning' | 'info'
  icon?: ReactNode
}) {
  const tones = {
    neutral: 'border-slate-200 bg-white',
    success: 'border-gradely-green/25 bg-gradely-green/5',
    warning: 'border-gradely-gold/40 bg-gradely-gold/10',
    info: 'border-gradely-blue/25 bg-gradely-blue/5',
  }

  return (
    <div className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
          {label}
        </p>
        {icon ? <span className="text-gradely-blue">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-gradely-navy">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-gradely-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export function SchoolStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge tone={isActive ? 'success' : 'warning'}>
      {isActive ? 'Active' : 'Suspended'}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    AUDIT_LOG: 'Platform',
    BILLING: 'Billing',
    CALENDAR: 'Calendar',
  }

  return <Badge tone="info">{labels[source] ?? source}</Badge>
}

export function EmptyPanel({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-gradely-muted">
      <p className="font-semibold text-gradely-text">{title}</p>
      {description ? <p className="mt-1">{description}</p> : null}
    </div>
  )
}
