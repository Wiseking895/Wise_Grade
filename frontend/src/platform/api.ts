import type { RegisterSchoolInput } from '../auth/types'
import { apiRequest, downloadFile } from '../lib/api'
import type {
  PlatformAccount,
  PlatformAccountSession,
  PlatformAuditPage,
  PlatformAuditSource,
  PlatformMonitoring,
  PlatformOverview,
  PlatformSchoolCalendar,
  PlatformSchoolDetail,
  PlatformSchoolStatusFilter,
  PlatformSchoolSummary,
  PlatformSchoolUpdate,
  PlatformSettings,
} from './types'

function queryString(
  values: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value))
    }
  }

  return params.size > 0 ? `?${params.toString()}` : ''
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function getPlatformOverview() {
  return apiRequest<PlatformOverview>('/api/platform/overview')
}

// ---------------------------------------------------------------------------
// Schools
// ---------------------------------------------------------------------------

export function listPlatformSchools(filter: {
  search?: string
  status?: PlatformSchoolStatusFilter
} = {}) {
  return apiRequest<{ schools: PlatformSchoolSummary[] }>(
    `/api/platform/schools${queryString(filter)}`,
  )
}

export function getPlatformSchool(schoolId: string) {
  return apiRequest<{ school: PlatformSchoolDetail }>(
    `/api/platform/schools/${schoolId}`,
  )
}

export function createPlatformSchool(
  input: RegisterSchoolInput,
  reauthToken?: string,
) {
  return apiRequest<{
    school: PlatformSchoolSummary
    administrator: { email: string; firstName: string; lastName: string }
  }>('/api/platform/schools', {
    method: 'POST',
    body: input,
    headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
  })
}

export function updatePlatformSchool(
  schoolId: string,
  input: PlatformSchoolUpdate,
) {
  return apiRequest<{ school: PlatformSchoolDetail }>(
    `/api/platform/schools/${schoolId}`,
    { method: 'PATCH', body: input },
  )
}

export function setPlatformSchoolStatus(
  schoolId: string,
  isActive: boolean,
  reason?: string,
  reauthToken?: string,
) {
  return apiRequest<{ school: PlatformSchoolDetail }>(
    `/api/platform/schools/${schoolId}/status`,
    {
      method: 'POST',
      body: { isActive, reason },
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

// ---------------------------------------------------------------------------
// Monitoring and audit
// ---------------------------------------------------------------------------

export function getPlatformMonitoring() {
  return apiRequest<PlatformMonitoring>('/api/platform/monitoring')
}

export function listPlatformAudit(filter: {
  search?: string
  action?: string
  schoolId?: string
  source?: PlatformAuditSource | 'all'
  from?: string
  to?: string
  limit?: number
  offset?: number
} = {}) {
  return apiRequest<PlatformAuditPage>(
    `/api/platform/audit${queryString(filter)}`,
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getPlatformSettings() {
  return apiRequest<PlatformSettings>('/api/platform/settings')
}

export function updatePlatformSettings(input: {
  supportEmail?: string | null
  registrationEnabled?: boolean
}, reauthToken?: string) {
  return apiRequest<PlatformSettings>('/api/platform/settings', {
    method: 'PATCH',
    body: input,
    headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
  })
}

// ---------------------------------------------------------------------------
// My account
// ---------------------------------------------------------------------------

export function getPlatformAccount() {
  return apiRequest<{ account: PlatformAccount }>('/api/platform/account')
}

export function updatePlatformAccountProfile(input: {
  firstName: string
  lastName: string
}) {
  return apiRequest<{ account: PlatformAccount }>('/api/platform/account', {
    method: 'PATCH',
    body: input,
  })
}

export function changePlatformAccountEmail(input: {
  email: string
  currentPassword: string
}) {
  return apiRequest<{ account: PlatformAccount }>(
    '/api/platform/account/email',
    { method: 'POST', body: input },
  )
}

export function changePlatformAccountPassword(input: {
  currentPassword: string
  newPassword: string
}) {
  return apiRequest<{ message: string }>('/api/platform/account/password', {
    method: 'POST',
    body: input,
  })
}

export function listPlatformAccountSessions() {
  return apiRequest<{ sessions: PlatformAccountSession[] }>(
    '/api/platform/account/sessions',
  )
}

export function revokeOtherPlatformAccountSessions() {
  return apiRequest<{ revoked: number }>(
    '/api/platform/account/sessions/revoke-others',
    { method: 'POST' },
  )
}

// ---------------------------------------------------------------------------
// Central academic calendar
// ---------------------------------------------------------------------------

export function listPlatformCalendars() {
  return apiRequest<{ calendars: PlatformSchoolCalendar[] }>(
    '/api/platform/calendar',
  )
}

export function getPlatformSchoolCalendar(schoolId: string) {
  return apiRequest<{
    calendar: PlatformSchoolCalendar
    transitions: import('./types').PlatformCalendarTransition[]
  }>(`/api/platform/calendar/${schoolId}`)
}

export function runPlatformCalendarForSchool(schoolId: string) {
  return apiRequest<{ calendar: PlatformSchoolCalendar }>(
    `/api/platform/calendar/${schoolId}/sync`,
    { method: 'POST' },
  )
}

export function updatePlatformTermDates(
  schoolId: string,
  termId: string,
  input: { startsOn: string; endsOn: string },
) {
  return apiRequest<{ term: unknown }>(
    `/api/platform/calendar/${schoolId}/terms/${termId}/dates`,
    { method: 'POST', body: input },
  )
}

export function closePlatformTerm(schoolId: string, termId: string) {
  return apiRequest<unknown>(
    `/api/platform/calendar/${schoolId}/terms/${termId}/close`,
    { method: 'POST' },
  )
}

// ---------------------------------------------------------------------------
// Platform operations
// ---------------------------------------------------------------------------

export function getPlatformHealth() {
  return apiRequest<import('./types').PlatformHealth>('/api/platform/health')
}

export function listPlatformNotifications(filter: {
  unreadOnly?: boolean
  severity?: string
  type?: string
  schoolId?: string
  search?: string
  limit?: number
  offset?: number
} = {}) {
  return apiRequest<import('./types').PlatformNotificationPage>(
    `/api/platform/notifications${queryString({
      unreadOnly:
        filter.unreadOnly === undefined ? undefined : String(filter.unreadOnly),
      severity: filter.severity,
      type: filter.type,
      schoolId: filter.schoolId,
      search: filter.search,
      limit: filter.limit,
      offset: filter.offset,
    })}`,
  )
}

export function markPlatformNotificationRead(notificationId: string) {
  return apiRequest<{ notification: import('./types').PlatformNotification }>(
    `/api/platform/notifications/${notificationId}/read`,
    { method: 'POST' },
  )
}

export function markAllPlatformNotificationsRead() {
  return apiRequest<{ updated: number }>('/api/platform/notifications/read-all', {
    method: 'POST',
  })
}

export function getPlatformSecurity() {
  return apiRequest<import('./types').PlatformSecurityOverview>(
    '/api/platform/security',
  )
}

export function issuePlatformReauth(input: {
  password: string
  code?: string
  purpose: string
}) {
  return apiRequest<{ token: string; purpose: string; expiresAt: string }>(
    '/api/platform/security/reauth',
    { method: 'POST', body: input },
  )
}

export function startPlatformMfaEnrollment() {
  return apiRequest<{ secret: string; otpauthUri: string; issuer: string }>(
    '/api/platform/security/mfa/enroll',
    { method: 'POST' },
  )
}

export function confirmPlatformMfaEnrollment(code: string) {
  return apiRequest<{ recoveryCodes: string[]; enabledAt: string }>(
    '/api/platform/security/mfa/confirm',
    { method: 'POST', body: { code } },
  )
}

export function disablePlatformMfa(
  input: { password: string; code: string },
  reauthToken: string,
) {
  return apiRequest<{ message: string }>('/api/platform/security/mfa/disable', {
    method: 'POST',
    body: input,
    headers: { 'X-Platform-Reauth': reauthToken },
  })
}

export function regeneratePlatformRecoveryCodes(
  code: string,
  reauthToken: string,
) {
  return apiRequest<{ recoveryCodes: string[] }>(
    '/api/platform/security/mfa/recovery-codes',
    {
      method: 'POST',
      body: { code },
      headers: { 'X-Platform-Reauth': reauthToken },
    },
  )
}

export function revokePlatformSession(
  sessionId: string,
  reauthToken: string,
) {
  return apiRequest<{ revoked: boolean }>(
    `/api/platform/security/sessions/${sessionId}/revoke`,
    {
      method: 'POST',
      headers: { 'X-Platform-Reauth': reauthToken },
    },
  )
}

export function getPlatformReconciliation(filter: {
  code?: string
  severity?: string
  schoolId?: string
} = {}) {
  return apiRequest<import('./types').ReconciliationPage>(
    `/api/platform/reconciliation${queryString(filter)}`,
  )
}

export function acknowledgePlatformPayment(
  paymentId: string,
  note: string | null,
  reauthToken: string,
) {
  return apiRequest<{ payment: import('./types').ReconciliationIssue }>(
    `/api/platform/reconciliation/${paymentId}/acknowledge`,
    {
      method: 'POST',
      body: { note },
      headers: { 'X-Platform-Reauth': reauthToken },
    },
  )
}

export function listPlatformExportDatasets() {
  return apiRequest<{
    datasets: import('./types').ExportDatasetDefinition[]
  }>('/api/platform/exports')
}

export function downloadPlatformExport(dataset: string, reauthToken: string) {
  return downloadFile(`/api/platform/exports/${dataset}`, {
    headers: { 'X-Platform-Reauth': reauthToken },
  })
}
