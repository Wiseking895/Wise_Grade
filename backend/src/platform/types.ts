/**
 * Shared types for the central Platform Super Admin dashboard.
 *
 * The platform identity is `User.isPlatformAdmin`; it is never represented by a
 * SchoolMembership. These types therefore carry no school role and no tenant
 * scope, and every platform route is guarded by `requirePlatformAdmin`.
 */

export type PlatformSchoolStatusFilter = 'all' | 'active' | 'suspended'

export interface PlatformSchoolFilter {
  search?: string
  status?: PlatformSchoolStatusFilter
}

export interface PlatformOverviewSchools {
  total: number
  active: number
  suspended: number
}

export interface PlatformOverviewPeople {
  pupils: number
  teachers: number
  activeUsers: number
}

export interface PlatformOverviewAcademics {
  academicYears: number
  activeTerms: number
  currentTermName: string | null
  currentAcademicYearName: string | null
}

export interface PlatformOverviewReports {
  prepared: number
  awaitingApproval: number
  approvedAwaitingRelease: number
  released: number
  onHold: number
}

export interface PlatformOverviewPayments {
  awaitingVerification: number
  verifiedCount: number
  verifiedMinor: number
  outstandingMinor: number
  currency: string
}

export interface PlatformOverview {
  schools: PlatformOverviewSchools
  people: PlatformOverviewPeople
  academics: PlatformOverviewAcademics
  reports: PlatformOverviewReports
  payments: PlatformOverviewPayments
  recentActivity: PlatformAuditEntry[]
  generatedAt: string
}

export interface PlatformSchoolSummary {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  address: string | null
  landmark: string | null
  timezone: string
  isActive: boolean
  logoUrl: string | null
  createdAt: string
  pupilCount: number
  teacherCount: number
  classCount: number
  currentAcademicYearName: string | null
  currentTermName: string | null
  currentTermStatus: string | null
  outstandingMinor: number
  currency: string
  reportsPrepared: number
  reportsAwaitingRelease: number
  reportsReleased: number
}

export interface PlatformSchoolMember {
  userId: string
  firstName: string
  lastName: string
  email: string
  role: string
  status: string
  joinedAt: string
}

export interface PlatformSchoolClass {
  id: string
  name: string
  level: string | null
  pupilCount: number
}

export interface PlatformSchoolTerm {
  id: string
  name: string
  sequence: number
  status: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
}

export interface PlatformSchoolYear {
  id: string
  name: string
  isCurrent: boolean
  startsOn: string
  endsOn: string
  terms: PlatformSchoolTerm[]
}

export interface PlatformSchoolPayment {
  id: string
  invoiceId: string
  invoiceNumber: string
  termName: string
  academicYearName: string
  method: string
  source: string
  status: string
  amountMinor: number
  currency: string
  paymentReference: string
  paidAt: string
  submittedAt: string
  verifiedAt: string | null
  rejectionReason: string | null
}

export interface PlatformSchoolReportBatch {
  id: string
  academicYearName: string
  termName: string
  className: string | null
  generationStatus: string
  releaseStatus: string
  reportCount: number
  submittedAt: string | null
  releasedAt: string | null
}

export interface PlatformSchoolDetail extends PlatformSchoolSummary {
  profileComplete: boolean
  updatedAt: string
  administrators: PlatformSchoolMember[]
  teachers: PlatformSchoolMember[]
  classes: PlatformSchoolClass[]
  academicYears: PlatformSchoolYear[]
  payments: PlatformSchoolPayment[]
  reportBatches: PlatformSchoolReportBatch[]
}

export interface PlatformSchoolUpdate {
  name?: string
  email?: string | null
  phone?: string | null
  address?: string | null
  landmark?: string | null
  isActive?: boolean
}

export type PlatformAuditSource = 'AUDIT_LOG' | 'BILLING' | 'CALENDAR'

export interface PlatformAuditEntry {
  id: string
  source: PlatformAuditSource
  action: string
  entityType: string
  entityId: string | null
  schoolId: string | null
  schoolName: string | null
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  metadata: unknown
  ipAddress: string | null
  createdAt: string
}

export interface PlatformAuditFilter {
  search?: string
  action?: string
  schoolId?: string
  source?: PlatformAuditSource | 'all'
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface PlatformAuditPage {
  entries: PlatformAuditEntry[]
  total: number
  limit: number
  offset: number
}

export interface PlatformMonitoringSchool {
  schoolId: string
  schoolName: string
  count: number
  detail: string
}

export interface PlatformMonitoringBucket {
  count: number
  schools: PlatformMonitoringSchool[]
}

export interface PlatformMonitoring {
  notSubmitted: PlatformMonitoringBucket
  awaitingReview: PlatformMonitoringBucket
  returnedForCorrection: PlatformMonitoringBucket
  acceptedAwaitingReports: PlatformMonitoringBucket
  reportsAwaitingPayment: PlatformMonitoringBucket
  paymentsAwaitingVerification: PlatformMonitoringBucket
  reportsAwaitingRelease: PlatformMonitoringBucket
  approachingDeadlines: PlatformMonitoringBucket
  incompleteEndOfYear: PlatformMonitoringBucket
  generatedAt: string
}

export interface PlatformSettings {
  supportEmail: string | null
  registrationEnabled: boolean
  updatedAt: string | null
  updatedByName: string | null
}

export interface PlatformSettingsUpdate {
  supportEmail?: string | null
  registrationEnabled?: boolean
}

export interface PlatformAccount {
  id: string
  email: string
  firstName: string
  lastName: string
  isPlatformAdmin: boolean
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PlatformAccountSession {
  id: string
  current: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export interface PlatformAuditContext {
  ipAddress?: string | null
  userAgent?: string | null
}
