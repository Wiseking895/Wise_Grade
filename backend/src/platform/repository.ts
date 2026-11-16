import type {
  PlatformAccount,
  PlatformAccountSession,
  PlatformAuditContext,
  PlatformAuditEntry,
  PlatformAuditFilter,
  PlatformAuditPage,
  PlatformMonitoring,
  PlatformOverview,
  PlatformSchoolDetail,
  PlatformSchoolFilter,
  PlatformSchoolSummary,
  PlatformSchoolUpdate,
  PlatformSettings,
  PlatformSettingsUpdate,
} from './types.js'

export interface PlatformRepository {
  /** Real aggregate figures for the overview; never hardcoded. */
  overview(): Promise<PlatformOverview>

  listSchools(filter: PlatformSchoolFilter): Promise<PlatformSchoolSummary[]>

  getSchool(schoolId: string): Promise<PlatformSchoolDetail | null>

  /** Private logo metadata for the authenticated platform viewer. */
  getSchoolLogo(
    schoolId: string,
  ): Promise<{ storageKey: string; mimeType: string } | null>

  /** Platform-level intervention: activate or suspend a school tenant. */
  setSchoolActive(
    actorUserId: string,
    schoolId: string,
    isActive: boolean,
    audit: PlatformAuditContext,
  ): Promise<PlatformSchoolDetail>

  updateSchool(
    actorUserId: string,
    schoolId: string,
    input: PlatformSchoolUpdate,
    audit: PlatformAuditContext,
  ): Promise<PlatformSchoolDetail>

  /** Unified, read-only view over the append-only audit sources. */
  listAudit(filter: PlatformAuditFilter): Promise<PlatformAuditPage>

  monitoring(): Promise<PlatformMonitoring>

  getSettings(): Promise<PlatformSettings>

  updateSettings(
    actorUserId: string,
    input: PlatformSettingsUpdate,
    audit: PlatformAuditContext,
  ): Promise<PlatformSettings>

  getAccount(userId: string): Promise<PlatformAccount | null>

  updateAccountProfile(
    userId: string,
    input: { firstName: string; lastName: string },
    audit: PlatformAuditContext,
  ): Promise<PlatformAccount>

  updateAccountEmail(
    userId: string,
    email: string,
    audit: PlatformAuditContext,
  ): Promise<PlatformAccount>

  updateAccountPassword(
    userId: string,
    passwordHash: string,
    audit: PlatformAuditContext,
  ): Promise<void>

  listAccountSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<PlatformAccountSession[]>

  revokeOtherAccountSessions(
    userId: string,
    currentSessionId: string,
    audit: PlatformAuditContext,
  ): Promise<number>

  /**
   * True when public school registration is enabled. Defaults to true when no
   * platform setting has been written yet, preserving existing behaviour.
   */
  isRegistrationEnabled(): Promise<boolean>

  /** Writes one platform audit entry (append-only). */
  recordAudit(entry: {
    schoolId?: string | null
    actorUserId?: string | null
    action: string
    entityType: string
    entityId?: string | null
    metadata?: Record<string, unknown> | null
    ipAddress?: string | null
    userAgent?: string | null
  }): Promise<void>
}

export type { PlatformAuditEntry }
