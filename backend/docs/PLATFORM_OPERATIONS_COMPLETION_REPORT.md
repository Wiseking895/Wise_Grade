# Platform Operations Completion Report

Phase: Super Admin operational control, security, monitoring, notifications,
reconciliation, exports and testing.

Scope: strengthen the existing Wise Grade Platform Super Admin dashboard. This
was a gap-remediation phase, not a rebuild. The existing `/api/platform` API,
`/platform` UI, `User.isPlatformAdmin` identity, cookie sessions, audit trail,
billing, report release and calendar automation were extended rather than
duplicated.

Tagline preserved: **Smarter Reports. Better Learning.**

---

## 1. Audit: what already existed

### Fully implemented before this phase

- Platform identity and authorization: `User.isPlatformAdmin`,
  `authenticate` → `requirePlatformAdmin()` → trusted-origin checks. School
  memberships never satisfy platform routes.
- Platform dashboard navigation and pages: overview, schools list/detail,
  private school logo streaming, school status, allow-listed platform settings,
  unified audit history, academic monitoring, platform account, password change,
  sign-in email change, session listing and "revoke other sessions".
- School onboarding from the platform dashboard: `POST /api/platform/schools`
  reused `registerSchoolSchema` and `createSchoolWithAdmin`, validated the
  profile, created one school plus its first administrator, and did not create
  subjects, pupils or teachers.
- Billing: versioned per-pupil pricing, invoice snapshots, manual payments,
  provider-neutral online payments, payment verification, webhooks, private
  payment evidence and billing audit history.
- Report release: school submission, platform review, approve/return/hold/
  unhold/release, separate approval and release actions, private report
  previews and downloads.
- Calendar automation: scheduled term opening/closing, report preparation,
  completion checks, year promotion and academic history preservation.
- Storage: private local storage in development/test and private Cloudflare R2
  in production.
- Authentication: scrypt password hashes, opaque cookie sessions stored as
  SHA-256 hashes, password reset tokens, per-IP/email login rate limiting,
  CSRF origin checks and audit logging.
- Assessment policies: configurable weighted components and grading bands, with
  a built-in NaCCA 30% SBA / 70% exam standard, editable example policies
  (including a 40% SBA / 60% exam example) and historical result snapshots.
  Existing school-specific policies, including any configured 60% SBA / 40%
  exam weighting, remain authoritative.

### Partially implemented

- Health: only the public `GET /api/health` existed. It intentionally reports
  `database: "not_checked"` and is not an operational health dashboard.
- Notifications: billing, release and school events were written to audit
  history, but there was no platform inbox, read state, filtering or retry
  deduplication.
- Security: password change, password recovery and "revoke other sessions"
  existed, but there was no MFA, no persistent account lockout, no security
  event view and no reauthentication for sensitive actions.
- Payment operations: payments could be verified, but there was no
  cross-school reconciliation view or acknowledgement workflow.
- Data portability: no platform-admin export surface.

### Missing

- Authenticated Platform Health covering database, Prisma, migrations, storage,
  scheduler, payment provider and webhooks.
- Platform notification inbox with school/record references and links.
- Persistent brute-force lockout and login monitoring.
- Optional MFA with recovery codes.
- Purpose-bound, single-use reauthentication for high-impact actions.
- Payment reconciliation issue detection and audited acknowledgement.
- Authorized, privacy-minimized, audited data exports.
- Documented backup and recovery procedure.

### Security weaknesses and operational risks found

- A high-impact platform action (school suspension, settings change, payment
  verification, report release) could be performed with only a live session.
- Login throttling was in-process only and did not survive an API restart.
- No second factor protected the platform owner account.
- There was no operational view of failed migrations, storage outages,
  scheduler failures or webhook silence.
- Retried jobs could duplicate operational notifications.
- There was no controlled way to inspect reconciliation anomalies or export
  platform data for review.

---

## 2. What was implemented

### 2.1 Platform Health

`GET /api/platform/health` is platform-admin only and returns a non-destructive
health report:

- **PostgreSQL**: read-only `SELECT 1`.
- **Prisma client**: verifies the generated client exposes expected models.
- **Migrations**: compares `_prisma_migrations` with
  `backend/prisma/migrations`, reports applied/expected counts, latest applied
  migration and pending migration names.
- **Private storage**: adapter `healthCheck()`; R2 uses `HeadBucketCommand`,
  local storage verifies its private directory, unconfigured storage is
  reported as `not_configured`.
- **Scheduler**: enabled state, interval, last run, last successful run,
  consecutive failures and stale-run detection.
- **Payment provider**: configured provider name, whether the webhook secret is
  present, last webhook time and outcome.
- **Webhooks**: separate check derived from webhook configuration and the last
  recorded provider event.

No credentials, connection strings, object keys or secrets are returned. No
probe writes or deletes application data; the local storage adapter may create
its own private directory. The UI shows explicit `ok`, `degraded`,
`not_configured`, `unknown` and `error` states rather than decorative stats.

### 2.2 Notifications

- Additive `PlatformNotification` model with type, severity, title, body,
  school reference, entity type/id, link, metadata, read state and timestamps.
- Unique optional `dedupeKey` so retried jobs cannot create duplicates.
- API: list with pagination, unread/severity/type/school filters and search;
  unread count; mark one read; mark all read.
- UI: inbox with timestamps, school and record references, internal links,
  severity styling, filters, search, read/unread state and pagination.
- Notification producers: school registration (public and platform), school
  suspension/reactivation, manual payment submitted, online payment initiated,
  payment verified/rejected, report submitted/approved/returned/held/unheld/
  released, platform-admin login lockout and scheduler failure.
- Wording is explicit that this is an in-app inbox and does **not** claim email
  or SMS delivery.

### 2.3 School onboarding from the platform dashboard

- Reuses `registerSchoolSchema` and `createSchoolWithAdmin`; no second
  registration system.
- Validates school name, administrator identity, email, password, landmark,
  address, Ghana mobile number and logo.
- Creates one school and its first administrator only. It does not create
  subjects, pupils or teachers.
- Audits `SCHOOL_REGISTERED_BY_PLATFORM` and raises a deduplicated
  `SCHOOL_REGISTERED` notification.
- Now requires a reauthentication grant before creating the tenant and
  administrator.

### 2.4 Payment reconciliation

- Read-only cross-school reconciliation over recent payments.
- Detects: mismatched references used across schools, duplicate provider
  references, repeated submissions in a short window, failed/rejected
  verification states, inconsistent amounts, currency mismatches,
  overpayments, unreconciled verified payments and wrong school/term.
- Preserves per-pupil pricing and invoice snapshots; reconciliation never
  rewrites settlement state.
- Audited acknowledgement records `reconciledAt`, the platform user and an
  optional note without deleting or editing the payment.
- UI provides filters, severity summary and an explicit acknowledgement action
  guarded by reauthentication.

### 2.5 Security and sessions

- **Optional MFA**: dependency-free TOTP (RFC 6238), base32 secret, QR-compatible
  `otpauth://` URI, 10 single-use recovery codes. Secrets are encrypted at rest
  with AES-256-GCM derived from `AUTH_SECRET`; recovery codes are stored only as
  SHA-256 hashes and shown once. Enrollment is optional so the existing owner
  account cannot be locked out.
- **Login MFA**: the login route accepts `mfaCode` and verifies TOTP or a
  recovery code; recovery codes are consumed once.
- **Persistent lockout**: five failed attempts lock the account for 15 minutes
  (HTTP 423), surviving API restarts. The per-IP rate limiter remains the first
  line of defence. Lockouts of platform administrators raise a notification;
  school-account failures remain audited without flooding the inbox.
- **Security overview**: MFA state, recovery-code count, failed logins in 24
  hours, locked accounts, recent security events and sessions.
- **Sessions**: list with current-session marker, IP, user agent, creation,
  last-used and expiry; revoke a specific session with reauthentication; current
  session cannot be revoked through that action.
- **Reauthentication**: password + MFA when enabled issues a short-lived
  (5 minute), single-use opaque grant bound to a purpose. Grants are stored as
  hashes and consumed atomically. Purposes: `SENSITIVE_ACTION`, `DATA_EXPORT`,
  `PAYMENT_RECONCILIATION`, `SECURITY_SETTINGS`, `SESSION_REVOKE`.
- **Protected actions**: school creation/status, platform settings, pricing
  create/activate/retire, invoice create/issue/cancel, payment verify, report
  approve/return/hold/unhold/release, MFA disable/recovery-code regeneration,
  session revocation, exports and reconciliation acknowledgement.
- **Confirmation**: destructive or financially significant actions use explicit
  confirmation dialogs and reauthentication. No general delete buttons were
  added; historical records remain intact.

### 2.6 Data exports

- Platform-admin only, reauthenticated and rate limited.
- Datasets: schools, payments, invoices, audit trail and notifications.
- Server-generated CSV streamed on demand; no persisted sensitive artifact.
- Excludes secrets, password hashes, MFA material, evidence files, payer phone
  numbers, IP addresses and user agents.
- Neutralizes spreadsheet formula injection (`=`, `+`, `-`, `@`, tab, CR) and
  quotes CSV cells correctly.
- Sets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and an
  attachment filename.
- Audits every download with dataset, row count and truncation state.
- UI explains that exports are privacy-minimized, audited and **not a backup**.

### 2.7 Navigation and UX

New navigation entries, keeping the existing Wise Grade shell and responsive
layout:

- Platform health
- Notifications
- Security & sessions
- Data exports
- Reconciliation (Finance section)

The existing overview, schools, payments, reports, calendar, monitoring,
settings, audit and account sections remain.

---

## 3. Files changed

### Backend — new

- `backend/prisma/migrations/20261114120000_platform_operations/migration.sql`
- `backend/src/auth/mfa.ts`
- `backend/src/platform/operations-types.ts`
- `backend/src/platform/operations-repository.ts`
- `backend/src/platform/prisma-operations-repository.ts`
- `backend/src/platform/notifications.ts`
- `backend/src/platform/health.ts`
- `backend/src/platform/security.ts`
- `backend/src/platform/reauth.ts`
- `backend/src/platform/exports.ts`
- `backend/src/platform/operations-routes.ts`
- `backend/tests/helpers/fake-operations-repository.ts`
- `backend/tests/platform-operations.test.ts`
- `backend/docs/BACKUP_AND_RECOVERY.md`
- `backend/docs/PLATFORM_OPERATIONS_COMPLETION_REPORT.md`

### Backend — modified

- `backend/prisma/schema.prisma`
- `backend/src/app.ts`
- `backend/src/index.ts`
- `backend/src/calendar/scheduler.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/billing.ts`
- `backend/src/routes/report-release.ts`
- `backend/src/platform/routes.ts`
- `backend/src/platform/validation.ts`
- `backend/src/auth/repository.ts`
- `backend/src/auth/prisma-repository.ts`
- `backend/src/storage/storage.ts`
- `backend/src/config/env.ts`
- `backend/.env.example`
- `backend/README.md`
- `backend/tests/helpers/fake-auth-repository.ts`

### Frontend — new

- `frontend/src/platform/reauth.tsx`
- `frontend/src/platform/reauth-context.ts`
- `frontend/src/platform/reauth-purpose.ts`
- `frontend/src/pages/platform/PlatformHealthPage.tsx`
- `frontend/src/pages/platform/PlatformNotificationsPage.tsx`
- `frontend/src/pages/platform/PlatformSecurityPage.tsx`
- `frontend/src/pages/platform/PlatformExportsPage.tsx`
- `frontend/src/pages/platform/PlatformReconciliationPage.tsx`
- `frontend/tests/platform-operations.test.ts`

### Frontend — modified

- `frontend/src/lib/api.ts`
- `frontend/src/platform/api.ts`
- `frontend/src/platform/types.ts`
- `frontend/src/billing/api.ts`
- `frontend/src/reports/api.ts`
- `frontend/src/components/PlatformLayout.tsx`
- `frontend/src/App.tsx`
- `frontend/src/pages/platform/PlatformSchoolsPage.tsx`
- `frontend/src/pages/platform/PlatformSettingsPage.tsx`
- `frontend/src/pages/platform/PlatformBillingPage.tsx`
- `frontend/src/pages/platform/PlatformReportsPage.tsx`
- `frontend/package.json`

---

## 4. Database migration

Migration: `20261114120000_platform_operations`

Additive and data-preserving:

- `User`: `mfaEnabled`, `mfaSecret`, `mfaPendingSecret`, `mfaRecoveryCodes`,
  `mfaEnabledAt`, `failedLoginCount`, `lastFailedLoginAt`, `lockedUntil`, plus
  an index on `lockedUntil`.
- `Payment`: `reconciledAt`, `reconciledByUserId`, `reconciliationNote`, plus
  indexes and a `SET NULL` foreign key to `User`.
- New `PlatformNotification` with indexes and optional school/read-by foreign
  keys.
- New `SchedulerRun` with indexes.
- New `PlatformReauthGrant` with unique token hash and expiry indexes.

No existing column was dropped or rewritten. Existing schools, users, sessions,
pupils, results, invoices, payments, reports and audit rows are untouched.

The migration was applied successfully to the development database and the
dedicated test database. No database reset was performed.

---

## 5. Environment variables and dependencies

### New dependencies

None. TOTP, base32, AES-256-GCM encryption and hashing use Node's built-in
`node:crypto`.

### Environment variables

No new required variable was introduced. Existing variables gained operational
meaning:

| Variable | Change |
| --- | --- |
| `AUTH_SECRET` | Now also derives the AES-256-GCM key for MFA secrets. Required in production before MFA enrollment; development uses a clearly non-production fallback. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Reported by Platform Health through a non-destructive `HeadBucket` probe. |
| `CALENDAR_SCHEDULER_ENABLED`, `CALENDAR_SCHEDULER_INTERVAL_MINUTES` | Reported by Platform Health; scheduler runs are persisted. |
| `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET` | Reported by Platform Health, including last webhook time/outcome. |
| `PLATFORM_REAUTH_ENFORCED` | Test-only escape hatch. When `NODE_ENV=test`, reauthentication is bypassed unless this is `true`. Never set it in production. |

`backend/.env.example` was updated to document the MFA use of `AUTH_SECRET`.

---

## 6. Security improvements

- Optional TOTP MFA for the platform owner, with encrypted secrets and hashed,
  single-use recovery codes.
- Persistent five-attempt / 15-minute lockout that survives restarts.
- Login monitoring: failed logins, lockouts, successful logins and security
  events.
- Short-lived, single-use, purpose-bound reauthentication grants for sensitive
  actions.
- Per-session revocation with reauthentication; current session protected from
  self-revocation through that endpoint.
- Platform Health and exports are platform-admin only, trusted-origin checked
  and rate limited.
- Export privacy minimization, formula-injection neutralization, `no-store`
  caching and audit logging.
- Notifications never claim email/SMS delivery.
- No general delete routes; historical records, audit entries, payments,
  results and released reports remain append-only from the application's
  perspective.
- Existing assessment calculation, policy configuration and historical result
  snapshots were not changed. The built-in NaCCA standard remains 30% SBA / 70%
  exam, and any school-specific policy (including 60% SBA / 40% exam) remains
  authoritative.

---

## 7. Operational scenario coverage

The requested 18 scenarios are covered as follows.

| # | Scenario | Coverage |
| --- | --- | --- |
| 1 | Platform dashboard is inaccessible to school users and anonymous callers | `platform-http.test.ts`, `platform-operations.test.ts` |
| 2 | Platform Health checks PostgreSQL connectivity | `platform-operations.test.ts` |
| 3 | Platform Health checks Prisma and migration state | `platform-operations.test.ts` |
| 4 | Platform Health checks private storage without destructive actions or secret exposure | `platform-operations.test.ts` |
| 5 | Platform Health reports scheduler state, last run and failures | `platform-operations.test.ts`, scheduler run test |
| 6 | Platform Health reports payment-provider and webhook state | `platform-operations.test.ts` |
| 7 | Platform school onboarding reuses registration and creates only the school and administrator | `platform-operations.test.ts`, `auth-registration.test.ts` |
| 8 | Onboarding validates the profile and preserves tenant isolation; no subjects, pupils or teachers are auto-created | `auth-registration.test.ts`, `school-management.test.ts`, `tenant-isolation.test.ts` |
| 9 | Notifications list, filter, search, paginate, and expose school/record references and links | `platform-operations.test.ts` |
| 10 | Notifications support read/unread state, timestamps and mark-all-read | `platform-operations.test.ts` |
| 11 | Notifications deduplicate on job retries | `platform-operations.test.ts` |
| 12 | MFA enrollment, confirmation, encrypted storage and recovery codes | `platform-operations.test.ts` |
| 13 | Login requires a second factor and consumes recovery codes once | `platform-operations.test.ts` |
| 14 | Persistent brute-force lockout and platform-admin lockout notification | `platform-operations.test.ts` |
| 15 | Security overview, session listing/expiry and session revocation | `platform-operations.test.ts`, `platform-http.test.ts` |
| 16 | Sensitive actions require a single-use, purpose-bound reauthentication grant | `platform-operations.test.ts` |
| 17 | Exports are authorized, privacy-minimized, audited and formula-safe | `platform-operations.test.ts` |
| 18 | Reconciliation detects every issue class and audits acknowledgement | `platform-operations.test.ts` |

Additional frontend static regression tests protect navigation, routes,
reauth provider usage, privacy wording, backup disclaimer and branding.

---

## 8. Verification results

Run from `backend/` and `frontend/`:

| Check | Result |
| --- | --- |
| Backend test suite | 505 passed, 3 skipped (the 3 are the `database-unconfigured` suite, skipped by design when `DATABASE_URL` is set) |
| Backend TypeScript (`tsc --noEmit`) | Passed |
| Backend ESLint | Passed |
| Prisma schema validation | Passed |
| Backend production build | Passed |
| Frontend test suite | 112 passed |
| Frontend TypeScript | Passed |
| Frontend ESLint | Passed |
| Frontend production build | Passed |

The frontend build warning about a chunk larger than 500 kB is pre-existing and
does not fail the build. The build also warns that `VITE_API_URL` points at
`http://localhost:4000`; it must be set to the deployed HTTPS API origin before
deployment.

No database reset was performed. No existing records were deleted.

---

## 9. External configuration required

Before production:

1. Set a strong `AUTH_SECRET` in the secret manager. Without it, production MFA
   enrollment is intentionally unavailable.
2. Configure all four R2 values and keep the bucket private. Verify Platform
   Health reports storage `ok`.
3. Configure `CORS_ORIGINS` and `FRONTEND_URL` as HTTPS origins.
4. Configure PostgreSQL automated backups and point-in-time recovery, and run a
   restore drill. See `backend/docs/BACKUP_AND_RECOVERY.md`.
5. Configure R2 versioning or replication and verify object restoration.
6. If online payments are enabled, configure `PAYMENT_PROVIDER` and
   `PAYMENT_WEBHOOK_SECRET` and confirm webhooks are received.
7. Confirm the calendar scheduler is enabled and its runs appear in Platform
   Health.
8. Set `VITE_API_URL` to the deployed HTTPS API origin before building the
   frontend.
9. Enroll MFA for the platform owner and store recovery codes offline.
10. Review audit retention, export access and incident-response ownership.

---

## 10. Production readiness

The operational, security and reconciliation features are implemented,
backend-backed and tested. The codebase passes type checking, linting, Prisma
validation, production builds and the full automated suites.

Production readiness is **conditional** on the external configuration above.
Specifically:

- Backups are **not** configured or verified by this repository. Do not claim a
  recovery point objective until the hosting provider's backups and a restore
  drill are verified.
- Email and SMS delivery are **not** implemented or claimed. Notifications are
  in-app only.
- Online payments remain provider-neutral; a real provider and webhook secret
  must be configured and tested before accepting money.
- MFA is optional and depends on `AUTH_SECRET`; it must be enrolled and tested
  in the deployed environment.
- Data Exports are operational reporting tools, **not** a backup or restore
  mechanism.

With those items configured and verified, the platform is ready for a
controlled production rollout.

---

## 11. Known limitations

- TOTP secrets are encrypted with a key derived from `AUTH_SECRET`. Rotating
  `AUTH_SECRET` requires MFA re-enrollment.
- Reauthentication grants are stored in PostgreSQL and cleaned up lazily by
  expiry checks; no background purge job was added.
- Platform Health reports the last webhook event but does not actively call the
  payment provider.
- Exports are capped by the repository query and report a `truncated` flag; they
  are not a full logical dump.
- There is no browser-based restore, CSV import or general delete action by
  design.
