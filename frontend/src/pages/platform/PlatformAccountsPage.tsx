import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  ShieldOff,
  Trash2,
  UserCheck,
  Users,
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
  deletePlatformAccount,
  listPlatformAccounts,
  setPlatformAccountStatus,
} from '../../platform/api'
import { usePlatformReauth } from '../../platform/reauth-context'
import type {
  PlatformAccountPage,
  PlatformAccountRole,
  PlatformAccountRoleFilter,
  PlatformAccountStatusFilter,
  PlatformManagedAccount,
} from '../../platform/types'

const PAGE_SIZE = 25

const ROLE_LABELS: Record<PlatformAccountRole, string> = {
  PLATFORM_SUPER_ADMIN: 'Platform Super Admin',
  SCHOOL_ADMIN: 'School administrator',
  CLASS_TEACHER: 'Class teacher',
  SUBJECT_TEACHER: 'Subject teacher',
  NO_SCHOOL_MEMBERSHIP: 'No school membership',
}

interface AccountFilters {
  search: string
  role: PlatformAccountRoleFilter
  status: PlatformAccountStatusFilter
}

const EMPTY_FILTERS: AccountFilters = {
  search: '',
  role: 'all',
  status: 'all',
}

function accountStatus(account: PlatformManagedAccount) {
  if (account.deletedAt) {
    return <Badge tone="warning">Archived</Badge>
  }

  return account.isActive ? (
    <Badge tone="success">Active</Badge>
  ) : (
    <Badge tone="warning">Suspended</Badge>
  )
}

export default function PlatformAccountsPage() {
  const { ensureReauth } = usePlatformReauth()
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<AccountFilters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<PlatformAccountPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<PlatformManagedAccount | null>(
    null,
  )
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await listPlatformAccounts({
        search: applied.search || undefined,
        role: applied.role,
        status: applied.status,
        limit: PAGE_SIZE,
        offset,
      })
      setPage(response)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the account directory.',
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

  function openDelete(account: PlatformManagedAccount) {
    setDeleteTarget(account)
    setDeleteReason('')
    setDeleteConfirm('')
    setDeleteError(null)
  }

  function closeDelete() {
    if (deleting) {
      return
    }

    setDeleteTarget(null)
    setDeleteReason('')
    setDeleteConfirm('')
    setDeleteError(null)
  }

  async function toggleStatus(account: PlatformManagedAccount) {
    const suspending = account.isActive
    const label = `${account.firstName} ${account.lastName}`.trim() || account.email
    setActionError(null)
    setBusyId(account.id)

    try {
      const token = await ensureReauth(
        suspending ? 'ACCOUNT_SUSPEND' : 'ACCOUNT_ACTIVATE',
        suspending
          ? `Suspend ${label} (${account.email}). Active sessions will be revoked.`
          : `Reactivate ${label} (${account.email}).`,
      )

      if (!token) {
        return
      }

      await setPlatformAccountStatus(
        account.id,
        !suspending,
        undefined,
        token,
      )
      await load()
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'Could not change the account status.',
      )
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) {
      return
    }

    setDeleteError(null)
    setDeleting(true)

    try {
      const token = await ensureReauth(
        'ACCOUNT_DELETE',
        `Archive ${deleteTarget.email}. This revokes access but keeps all academic, report and audit history.`,
      )

      if (!token) {
        return
      }

      await deletePlatformAccount(
        deleteTarget.id,
        {
          reason: deleteReason.trim(),
          confirmEmail: deleteConfirm.trim(),
        },
        token,
      )

      setDeleteTarget(null)
      setDeleteReason('')
      setDeleteConfirm('')
      await load()
    } catch (cause) {
      setDeleteError(
        cause instanceof Error
          ? cause.message
          : 'Could not delete this account.',
      )
    } finally {
      setDeleting(false)
    }
  }

  const accounts = page?.accounts ?? []
  const total = page?.total ?? 0
  const hasPrevious = offset > 0
  const hasNext = offset + PAGE_SIZE < total
  const deleteReady =
    deleteTarget !== null &&
    deleteReason.trim().length >= 5 &&
    deleteConfirm.trim().toLowerCase() === deleteTarget.email.toLowerCase()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Platform-managed school administrators, teachers and platform administrators. Suspend an account to remove access temporarily, or delete it to archive it with a permanent history record."
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {actionError ? <ErrorNotice message={actionError} /> : null}

      <Panel>
        <form
          onSubmit={applyFilters}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <div className="lg:col-span-2">
            <FormField
              label="Search"
              name="search"
              placeholder="Name, email or school"
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
            label="Role"
            value={filters.role}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                role: event.target.value as PlatformAccountRoleFilter,
              }))
            }
          >
            <option value="all">All roles</option>
            <option value="PLATFORM_SUPER_ADMIN">Platform Super Admin</option>
            <option value="SCHOOL_ADMIN">School administrator</option>
            <option value="CLASS_TEACHER">Class teacher</option>
            <option value="SUBJECT_TEACHER">Subject teacher</option>
            <option value="NO_SCHOOL_MEMBERSHIP">No school membership</option>
          </SelectField>
          <SelectField
            label="Status"
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value as PlatformAccountStatusFilter,
              }))
            }
          >
            <option value="all">Active and suspended</option>
            <option value="active">Active only</option>
            <option value="suspended">Suspended only</option>
            <option value="deleted">Archived only</option>
          </SelectField>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit" variant="secondary">
              <Search aria-hidden="true" className="size-4" />
              Apply filters
            </Button>
            <Button type="button" variant="ghost" onClick={resetFilters}>
              Reset
            </Button>
            <span className="ml-auto text-xs text-gradely-muted">
              {total} account{total === 1 ? '' : 's'} · page{' '}
              {Math.floor(offset / PAGE_SIZE) + 1}
            </span>
          </div>
        </form>
      </Panel>

      {loading ? <LoadingPanel label="Loading accounts…" /> : null}

      {!loading && accounts.length === 0 ? (
        <EmptyState
          title="No accounts match this filter"
          description="Adjust the search, role or status."
          icon={Users}
        />
      ) : null}

      {accounts.length > 0 ? (
        <Panel>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gradely-muted">
                  <th className="px-3 py-2 font-semibold">Account</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">School</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Last sign-in</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => (
                  <tr key={account.id} className="align-top">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-gradely-text">
                        {`${account.firstName} ${account.lastName}`.trim() ||
                          'Unnamed account'}
                      </p>
                      <p className="break-all text-xs text-gradely-muted">
                        {account.email}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-gradely-muted">
                      {ROLE_LABELS[account.role]}
                    </td>
                    <td className="px-3 py-3 text-gradely-muted">
                      {account.schoolName ?? 'Platform'}
                    </td>
                    <td className="px-3 py-3">{accountStatus(account)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gradely-muted">
                      {account.lastLoginAt
                        ? formatDateTime(account.lastLoginAt)
                        : 'Never'}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {account.deletedAt ? (
                          <span className="text-xs text-gradely-muted">
                            Archived
                          </span>
                        ) : (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busyId === account.id}
                              onClick={() => void toggleStatus(account)}
                            >
                              {account.isActive ? (
                                <>
                                  <ShieldOff
                                    aria-hidden="true"
                                    className="size-3.5"
                                  />
                                  Suspend
                                </>
                              ) : (
                                <>
                                  <UserCheck
                                    aria-hidden="true"
                                    className="size-3.5"
                                  />
                                  Activate
                                </>
                              )}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={busyId === account.id}
                              onClick={() => openDelete(account)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5" />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
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
        open={deleteTarget !== null}
        onClose={closeDelete}
        title="Delete account"
        description="This archives the account and permanently removes its active access."
      >
        {deleteTarget ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-gradely-light px-4 py-3">
              <p className="text-sm font-bold text-gradely-text">
                {`${deleteTarget.firstName} ${deleteTarget.lastName}`.trim() ||
                  'Unnamed account'}
              </p>
              <p className="break-all text-xs text-gradely-muted">
                {deleteTarget.email}
              </p>
              <p className="mt-1 text-xs text-gradely-muted">
                {ROLE_LABELS[deleteTarget.role]}
                {deleteTarget.schoolName
                  ? ` · ${deleteTarget.schoolName}`
                  : ' · Platform'}
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">What deletion does</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
                <li>The account can no longer sign in or use protected routes.</li>
                <li>Every active session is revoked immediately.</li>
                <li>
                  Name, email, role and school association are preserved in the
                  Deleted Accounts History.
                </li>
                <li>
                  Academic records, assessments, report cards, audit records and
                  school relationships are not deleted.
                </li>
              </ul>
            </div>

            {deleteError ? <ErrorNotice message={deleteError} /> : null}

            <FormField
              label="Deletion reason"
              hint="Recorded permanently with the acting administrator. At least 5 characters."
              value={deleteReason}
              maxLength={500}
              onChange={(event) => setDeleteReason(event.target.value)}
              required
            />

            <FormField
              label="Type the account email to confirm"
              hint={deleteTarget.email}
              value={deleteConfirm}
              autoComplete="off"
              onChange={(event) => setDeleteConfirm(event.target.value)}
              required
            />

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={closeDelete}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={deleting}
                disabled={!deleteReady}
                onClick={() => void confirmDelete()}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Delete account
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
