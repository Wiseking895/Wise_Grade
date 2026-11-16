import {
  ChevronLeft,
  ChevronRight,
  FileClock,
  Lock,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import { formatDateTime, statusLabel } from '../../lib/format'
import { listPlatformAudit } from '../../platform/api'
import { SourceBadge } from '../../platform/components'
import type {
  PlatformAuditEntry,
  PlatformAuditPage,
  PlatformAuditSource,
} from '../../platform/types'

const PAGE_SIZE = 50

interface AuditFilters {
  search: string
  source: PlatformAuditSource | 'all'
  from: string
  to: string
}

const EMPTY_FILTERS: AuditFilters = {
  search: '',
  source: 'all',
  from: '',
  to: '',
}

function metadataSummary(entry: PlatformAuditEntry): string {
  if (entry.metadata === null || entry.metadata === undefined) {
    return '—'
  }

  if (typeof entry.metadata === 'string') {
    return entry.metadata
  }

  try {
    const serialized = JSON.stringify(entry.metadata)

    return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized
  } catch {
    return '—'
  }
}

export default function PlatformAuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<PlatformAuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await listPlatformAudit({
        search: applied.search || undefined,
        source: applied.source,
        from: applied.from || undefined,
        to: applied.to || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setPage(response)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the platform audit log.',
      )
    } finally {
      setLoading(false)
    }
  }, [applied, offset])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOffset(0)
    setApplied(filters)
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setOffset(0)
  }

  const entries = page?.entries ?? []
  const total = page?.total ?? 0
  const hasPrevious = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        description="Append-only history across platform, billing and calendar sources. Entries can never be edited or deleted from this dashboard."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      <Panel>
        <form
          onSubmit={applyFilters}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <div className="lg:col-span-2">
            <FormField
              label="Search"
              name="search"
              placeholder="Action, school, actor or metadata"
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
            />
          </div>
          <SelectField
            label="Source"
            value={filters.source}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                source: event.target.value as PlatformAuditSource | 'all',
              }))
            }
          >
            <option value="all">All sources</option>
            <option value="AUDIT_LOG">Platform</option>
            <option value="BILLING">Billing</option>
            <option value="CALENDAR">Calendar</option>
          </SelectField>
          <FormField
            label="From"
            type="date"
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                from: event.target.value,
              }))
            }
          />
          <FormField
            label="To"
            type="date"
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                to: event.target.value,
              }))
            }
          />
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit" variant="secondary">
              <Search aria-hidden="true" className="size-4" />
              Apply filters
            </Button>
            <Button type="button" variant="ghost" onClick={resetFilters}>
              Reset
            </Button>
            <span className="ml-auto text-xs text-gradely-muted">
              {total} entr{total === 1 ? 'y' : 'ies'} · page{' '}
              {Math.floor(offset / PAGE_SIZE) + 1}
            </span>
          </div>
        </form>
      </Panel>

      <Panel>
        <div className="flex items-start gap-3">
          <Lock
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-gradely-blue"
          />
          <div>
            <h2 className="text-base font-bold text-gradely-text">
              Immutable history
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
              This view is read-only by design. There are no controls to edit or
              delete an audit entry.
            </p>
          </div>
        </div>
      </Panel>

      {loading ? <LoadingPanel label="Loading audit history…" /> : null}

      {!loading && entries.length === 0 ? (
        <EmptyState
          title="No audit entries match this filter"
          description="Adjust the search, source or date range."
          icon={FileClock}
        />
      ) : null}

      {entries.length > 0 ? (
        <Panel>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gradely-muted">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">School</th>
                  <th className="px-3 py-2 font-semibold">Actor</th>
                  <th className="px-3 py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={`${entry.source}:${entry.id}`} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 text-gradely-muted">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <SourceBadge source={entry.source} />
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-gradely-text">
                        {statusLabel(entry.action)}
                      </p>
                      <p className="text-xs text-gradely-muted">
                        {entry.entityType}
                        {entry.entityId ? ` · ${entry.entityId}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-gradely-muted">
                      {entry.schoolName ?? 'Platform'}
                    </td>
                    <td className="px-3 py-2.5 text-gradely-muted">
                      <p>{entry.actorName ?? 'System'}</p>
                      {entry.actorEmail ? (
                        <p className="text-xs">{entry.actorEmail}</p>
                      ) : null}
                    </td>
                    <td className="max-w-xs px-3 py-2.5">
                      <p className="break-words font-mono text-xs text-gradely-muted">
                        {metadataSummary(entry)}
                      </p>
                      {entry.ipAddress ? (
                        <Badge tone="neutral">IP {entry.ipAddress}</Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasPrevious || loading}
              onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
              Previous
            </Button>
            <span className="text-xs text-gradely-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasNext || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}
