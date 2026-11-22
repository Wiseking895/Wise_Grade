import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
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
  Modal,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import {
  listPlatformDeletedAccounts,
  restorePlatformDeletedAccount,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import type {
  PlatformAccountRole,
  PlatformDeletedAccount,
  PlatformDeletedAccountPage,
  PlatformDeletedAccountStatusFilter,
} from '../../platform/types'

const PAGE_SIZE = 25

const ROLE_LABELS: Record<PlatformAccountRole, string> = {
  PLATFORM_SUPER_ADMIN: 'Platform Super Admin',
  SCHOOL_ADMIN: 'School administrator',
  CLASS_TEACHER: 'Class teacher',
  SUBJECT_TEACHER: 'Subject teacher',
  NO_SCHOOL_MEMBERSHIP: 'No school membership',
}

interface HistoryFilters {
  search: string
  status: PlatformDeletedAccountStatusFilter
}

const EMPTY_FILTERS: HistoryFilters = { search: '', status: 'all' }

export default function PlatformDeletedAccountsPage() {
  const { ensureReauth } = usePlatformReauth()
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<HistoryFilters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<PlatformDeletedAccountPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [restoreTarget, setRestoreTarget] =
    useState<PlatformDeletedAccount | null>(null)
  const [restoreReason, setRestoreReason] = useState('')
  const [restoreConfirm, setRestoreConfirm] = useState('')
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await listPlatformDeletedAccounts({
        search: applied.search || undefined,
        status: applied.status,
        limit: PAGE_SIZE,
        offset,
      })
      setPage(response)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the Deleted Accounts History.',
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

  function openRestore(record: PlatformDeletedAccount) {
    setRestoreTarget(record)
    setRestoreReason('')
    setRestoreConfirm('')
    setRestoreError(null)
  }

  function closeRestore() {
    if (restoring) {
      return
    }

    setRestoreTarget(null)
    setRestoreReason('')
    setRestoreConfirm('')
    setRestoreError(null)
  }

  async function confirmRestore() {
    if (!restoreTarget || restoring) {
      return
    }

    setRestoreError(null)
    setRestoring(true)

    try {
      const token = await ensureReauth(
        'ACCOUNT_RESTORE',
        `Restore ${restoreTarget.email}. Email and phone conflicts are checked first.`,
      )

      if (!token) {
        return
      }

      await restorePlatformDeletedAccount(
        restoreTarget.id,
        {
          reason: restoreReason.trim() || undefined,
          confirmEmail: restoreConfirm.trim(),
        },
        token,
      )

      setRestoreTarget(null)
      setRestoreReason('')
      setRestoreConfirm('')
      await load()
    } catch (cause) {
      setRestoreError(
        cause instanceof Error
          ? cause.message
          : 'Could not restore this account.',
      )
    } finally {
      setRestoring(false)
    }
  }

  const records = page?.accounts ?? []
  const total = page?.total ?? 0
  const hasPrevious = offset > 0
  const hasNext = offset + PAGE_SIZE < total
  const restoreReady =
    restoreTarget !== null &&
    restoreConfirm.trim().toLowerCase() === restoreTarget.email.toLowerCase()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deleted Accounts History"
        description="Permanent archive of platform-managed accounts removed by a Platform Super Admin. Records cannot be edited or removed from this dashboard."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      <Panel>
        <div className="flex items-start gap-3">
          <Lock
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-gradely-blue"
          />
          <div>
            <h2 className="text-base font-bold text-gradely-text">
              Immutable deletion history
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gradely-muted">
              Each record keeps the account holder&apos;s name, email, original
              role, school association, deletion time, acting administrator and
              reason. Restoration appends its own audit information; it never
              erases the original record.
            </p>
          </div>
        </div>
      </Panel>

      <Panel>
        <form
          onSubmit={applyFilters}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="lg:col-span-2">
            <FormField
              label="Search"
              name="search"
              placeholder="Name, email, school or reason"
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
            label="Archival status"
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target
                  .value as PlatformDeletedAccountStatusFilter,
              }))
            }
          >
            <option value="all">All records</option>
            <option value="ARCHIVED">Archived</option>
            <option value="RESTORED">Restored</option>
          </SelectField>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit" variant="secondary">
              <Search aria-hidden="true" className="size-4" />
              Apply filters
            </Button>
            <Button type="button" variant="ghost" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </form>
      </Panel>

      {loading ? <LoadingPanel label="Loading Deleted Accounts History…" /> : null}

      {!loading && records.length === 0 ? (
        <EmptyState
          title="No deleted accounts match this filter"
          description="Deleted accounts appear here with their permanent audit information."
          icon={ArchiveRestore}
        />
      ) : null}

      {records.length > 0 ? (
        <Panel>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gradely-muted">
                  <th className="px-3 py-2 font-semibold">Account</th>
                  <th className="px-3 py-2 font-semibold">Original role</th>
                  <th className="px-3 py-2 font-semibold">School</th>
                  <th className="px-3 py-2 font-semibold">Deleted</th>
                  <th className="px-3 py-2 font-semibold">Deleted by</th>
                  <th className="px-3 py-2 font-semibold">Reason</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((record) => (
                  <tr key={record.id} className="align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-gradely-text">
                        {`${record.firstName} ${record.lastName}`.trim() ||
                          'Unnamed account'}
                      </p>
                      <p className="break-all text-xs text-gradely-muted">
                        {record.email}
                      </p>
                      {record.phone ? (
                        <p className="text-xs text-gradely-muted">{record.phone}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-gradely-muted">
                      {ROLE_LABELS[record.role]}
                    </td>
                    <td className="px-3 py-3 text-gradely-muted">
                      {record.schoolName ?? 'Platform'}
                      {record.memberships.length > 1 ? (
                        <p className="text-xs">
                          +{record.memberships.length - 1} other school
                          {record.memberships.length - 1 === 1 ? '' : 's'}
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-gradely-muted">
                      {formatDateTime(record.deletedAt)}
                    </td>
                    <td className="px-3 py-3 text-gradely-muted">
                      <p>{record.deletedByName ?? 'Unknown administrator'}</p>
                      {record.deletedByEmail ? (
                        <p className="break-all text-xs">{record.deletedByEmail}</p>
                      ) : null}
                    </td>
                    <td className="max-w-xs px-3 py-3 text-gradely-muted">
                      <p className="break-words">{record.reason}</p>
                    </td>
                    <td className="px-3 py-3">
                      {record.status === 'RESTORED' ? (
                        <>
                          <Badge tone="success">Restored</Badge>
                          {record.restoredAt ? (
                            <p className="mt-1 whitespace-nowrap text-xs text-gradely-muted">
                              {formatDateTime(record.restoredAt)}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <Badge tone="warning">Archived</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {record.status === 'ARCHIVED' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openRestore(record)}
                        >
                          <ArchiveRestore
                            aria-hidden="true"
                            className="size-3.5"
                          />
                          Restore
                        </Button>
                      ) : (
                        <span className="text-xs text-gradely-muted">—</span>
                      )}
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

      <Modal
        open={restoreTarget !== null}
        onClose={closeRestore}
        title="Restore account"
        description="Restoration is checked against current account conflicts before it is applied."
      >
        {restoreTarget ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-gradely-light px-4 py-3">
              <p className="text-sm font-bold text-gradely-text">
                {`${restoreTarget.firstName} ${restoreTarget.lastName}`.trim() ||
                  'Unnamed account'}
              </p>
              <p className="break-all text-xs text-gradely-muted">
                {restoreTarget.email}
              </p>
              <p className="mt-1 text-xs text-gradely-muted">
                {ROLE_LABELS[restoreTarget.role]}
                {restoreTarget.schoolName
                  ? ` · ${restoreTarget.schoolName}`
                  : ' · Platform'}
              </p>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <p className="font-semibold">What restoration does</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                <li>
                  The email and phone number are checked against every other
                  account first. A conflict stops the restore and is explained.
                </li>
                <li>
                  The account becomes active again, but old sessions are not
                  recreated and email verification is never granted.
                </li>
                <li>
                  School memberships remain suspended, so restoration does not
                  grant access to a school automatically.
                </li>
              </ul>
            </div>

            {restoreError ? <ErrorNotice message={restoreError} /> : null}

            <FormField
              label="Restoration note (optional)"
              hint="Recorded in the audit trail alongside the original deletion."
              value={restoreReason}
              maxLength={500}
              onChange={(event) => setRestoreReason(event.target.value)}
            />

            <FormField
              label="Type the account email to confirm"
              hint={restoreTarget.email}
              value={restoreConfirm}
              autoComplete="off"
              onChange={(event) => setRestoreConfirm(event.target.value)}
              required
            />

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={closeRestore}
                disabled={restoring}
              >
                Cancel
              </Button>
              <Button
                type="button"
                loading={restoring}
                disabled={!restoreReady}
                onClick={() => void confirmRestore()}
              >
                <ArchiveRestore aria-hidden="true" className="size-4" />
                Restore account
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
