import {
  Bell,
  BellOff,
  CheckCheck,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { formatDateTime } from '../../lib/format'
import {
  listPlatformNotifications,
  markAllPlatformNotificationsRead,
  markPlatformNotificationRead,
} from '../../platform/api'
import type {
  PlatformNotification,
  PlatformNotificationPage,
  PlatformNotificationSeverity,
} from '../../platform/types'

function severityTone(
  severity: PlatformNotificationSeverity,
): 'success' | 'warning' | 'info' | 'neutral' {
  if (severity === 'SUCCESS') return 'success'
  if (severity === 'WARNING' || severity === 'CRITICAL') return 'warning'
  if (severity === 'INFO') return 'info'
  return 'neutral'
}

export default function PlatformNotificationsPage() {
  const [page, setPage] = useState<PlatformNotificationPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAll, setBusyAll] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [severity, setSeverity] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setPage(
        await listPlatformNotifications({
          unreadOnly: unreadOnly || undefined,
          severity: severity || undefined,
          search: search.trim() || undefined,
          limit: 50,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load platform notifications.',
      )
    } finally {
      setLoading(false)
    }
  }, [unreadOnly, severity, search])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function markRead(notification: PlatformNotification) {
    if (notification.read) return

    setBusyId(notification.id)

    try {
      await markPlatformNotificationRead(notification.id)
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not mark the notification as read.',
      )
    } finally {
      setBusyId(null)
    }
  }

  async function markAllRead() {
    setBusyAll(true)

    try {
      await markAllPlatformNotificationsRead()
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not mark all notifications as read.',
      )
    } finally {
      setBusyAll(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Operational events raised by the platform, billing, report release, account security and the academic scheduler. Email and SMS delivery is not claimed."
        actions={
          <>
            <Button variant="secondary" onClick={() => void load()} loading={loading}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button
              onClick={() => void markAllRead()}
              loading={busyAll}
              disabled={!page || page.unreadCount === 0}
            >
              <CheckCheck aria-hidden="true" className="size-4" />
              Mark all read
            </Button>
          </>
        }
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Inbox"
            value={unreadOnly ? 'unread' : 'all'}
            onChange={(event) => setUnreadOnly(event.target.value === 'unread')}
          >
            <option value="all">All notifications</option>
            <option value="unread">Unread only</option>
          </SelectField>
          <SelectField
            label="Severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="">Any severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="SUCCESS">Success</option>
            <option value="INFO">Info</option>
          </SelectField>
          <div>
            <label
              htmlFor="notification-search"
              className="block text-sm font-semibold text-gradely-text"
            >
              Search
            </label>
            <input
              id="notification-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title or body"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-gradely-text shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/25"
            />
          </div>
        </div>
        {page ? (
          <p className="mt-3 text-xs text-gradely-muted">
            {page.total} notification(s) · {page.unreadCount} unread
          </p>
        ) : null}
      </Panel>

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
      {loading && !page ? (
        <LoadingPanel label="Loading notifications…" />
      ) : null}

      {page && page.notifications.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications"
          description="Operational events will appear here as they occur."
        />
      ) : null}

      {page && page.notifications.length > 0 ? (
        <ul className="space-y-3">
          {page.notifications.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm ${
                notification.read
                  ? 'border-slate-200'
                  : 'border-gradely-blue/40'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bell
                      aria-hidden="true"
                      className="size-4 text-gradely-blue"
                    />
                    <p className="font-semibold text-gradely-text">
                      {notification.title}
                    </p>
                    <Badge tone={severityTone(notification.severity)}>
                      {notification.severity}
                    </Badge>
                    {!notification.read ? (
                      <Badge tone="info">Unread</Badge>
                    ) : null}
                  </div>
                  {notification.body ? (
                    <p className="mt-1.5 text-sm leading-relaxed text-gradely-muted">
                      {notification.body}
                    </p>
                  ) : null}
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gradely-muted">
                    <span>{formatDateTime(notification.createdAt)}</span>
                    {notification.schoolName ? (
                      <span>School: {notification.schoolName}</span>
                    ) : null}
                    {notification.entityType ? (
                      <span>
                        {notification.entityType}
                        {notification.entityId ? ` · ${notification.entityId}` : ''}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {notification.link ? (
                    <Link
                      to={notification.link}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-gradely-navy hover:bg-gradely-light"
                    >
                      Open
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </Link>
                  ) : null}
                  {!notification.read ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busyId === notification.id}
                      onClick={() => void markRead(notification)}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
