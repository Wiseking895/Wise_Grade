# Wise Grade Backend

Node.js, TypeScript, Express, Prisma, and PostgreSQL API for Wise Grade.

Tagline: **Smarter Reports. Better Learning.**

The backend now covers Phases 1–5: identity and tenant isolation, the school
management foundation, configurable assessment and review workflows, and
internal report card generation with versioned snapshots, server-rendered A4
PDFs, private storage, and protected previews, plus Phase 6A per-pupil billing,
invoices, manual and provider-neutral online payment foundations, and platform
billing administration. Report approval and release to pupils or families remain
out of scope until Phase 6B.

## Requirements

- Node.js 20.19+ (Node.js 24 LTS recommended)
- npm 10+
- PostgreSQL only for database-backed work. The API and its health endpoint
  start without a database and without `DATABASE_URL`.

## Setup

Run these from `backend/`:

```bash
npm install
# Optional for local database work; never commit the resulting .env
Copy-Item .env.example .env
npm run prisma:generate
npm run dev
```

The API listens on `http://localhost:4000` by default.

Health check:

```bash
curl http://localhost:4000/api/health
```

```json
{
  "status": "ok",
  "service": "gradely-api",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "uptimeSeconds": 3,
  "database": "not_checked"
}
```

`database: "not_checked"` is intentional. Application startup is deliberately
separate from database connectivity, so this endpoint proves the HTTP process
is alive without requiring PostgreSQL to be running.

## Scripts

```bash
npm run dev                    # tsx watch mode
npm run build                  # generate Prisma Client, then compile to dist/
npm start                      # run the compiled server
npm run lint                   # ESLint
npm run typecheck              # generate Prisma Client, then TypeScript check
npm test                       # unit/HTTP suite; live tests skip without TEST_DATABASE_URL
npm run test:integration       # live PostgreSQL suite only (dedicated test DB)
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:deploy  # apply committed migrations (safe for fresh DB)
npm run prisma:migrate:status  # show applied/pending migrations
npm run prisma:migrate         # dev only: create a migration from schema changes
```

## Environment variables

Copy `.env.example` to `.env` for local development and replace placeholders
when real values are available. `.env` is git-ignored. No real credentials are
included here.

Environment profiles are explicit:

| File | Purpose | Loaded automatically |
| ---- | ------- | -------------------- |
| `.env` | Local development database and URLs | Yes |
| `.env.production.local` | Production/Neon values for local tooling only | No |
| `.env.test` | Optional test-only overrides | No |

Set `GRADELY_ENV_FILE=.env.production.local` to use the production profile for
read-only checks or approved Prisma tooling. Duplicate keys inside one file are
rejected at load time, so a file can never silently contain both local and
production database URLs. Vercel does not read `.env` files; configure variables
in the Vercel project instead.

| Variable                    | Required          | Default                 | Purpose                                              |
| --------------------------- | ----------------- | ----------------------- | ---------------------------------------------------- |
| `NODE_ENV`                  | No                | `development`           | `development`, `test`, or `production`               |
| `PORT`                      | No                | `4000`                  | HTTP port                                            |
| `CORS_ORIGINS`              | Yes in production | Dev localhost           | Comma-separated exact browser origins allowed by CORS |
| `FRONTEND_URL`              | Yes in production | `http://localhost:5173` | Public frontend origin used for links, redirects and the origin allow-list |
| `BACKEND_URL`               | Production        | None                    | Public API origin |
| `DATABASE_URL`              | Only for database | None                    | PostgreSQL connection string used by Prisma          |
| `TEST_DATABASE_URL`         | Only for tests    | None                    | Dedicated non-production database for integration tests |
| `AUTH_SECRET`               | Reserved          | `REPLACE_ME`            | Reserved for future token signing / email links      |
| `AUTH_SESSION_TTL_MINUTES`  | No                | `60`                    | Session cookie lifetime in minutes                   |
| `R2_ACCOUNT_ID`             | Production        | None                    | Private Cloudflare R2 account for report storage     |
| `R2_ACCESS_KEY_ID`          | Production        | None                    | Private R2 access key ID                             |
| `R2_SECRET_ACCESS_KEY`      | Production        | None                    | Private R2 secret access key                         |
| `R2_BUCKET_NAME`            | Production        | None                    | Private R2 bucket; never expose it publicly          |
| `EMAIL_ENABLED`             | Production        | `false`                 | Enables Brevo SMTP delivery                          |
| `SMTP_HOST`                 | With email        | None                    | Brevo SMTP relay host                                |
| `SMTP_PORT`                 | No                | `587`                   | STARTTLS port                                        |
| `SMTP_SECURE`               | No                | `false`                 | `true` only for implicit TLS                         |
| `SMTP_USER` / `SMTP_PASS`   | With email        | None                    | Brevo SMTP login and SMTP key (secret)               |
| `EMAIL_FROM_NAME`           | No                | `WiseGrade`             | Sender display name                                  |
| `EMAIL_FROM_ADDRESS`        | With email        | None                    | Brevo-verified sender address                        |
| `EMAIL_REPLY_TO`            | No                | None                    | Reply-to address                                     |
| `EMAIL_TEST_RECIPIENT`      | SMTP test only    | Caller's address        | Restricts the admin SMTP test endpoint               |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | No          | `24`                    | Administrator verification link lifetime             |
| `SUBJECT_TEACHER_ACCESS_CODE_EXPIRY_DAYS` | No    | `7`                     | Access-code lifetime                                 |
| `CRON_SECRET`               | Production jobs   | None                    | Protects calendar and email outbox cron endpoints    |
| `PAYMENT_PROVIDER`          | No                | None                    | Set to `mock` outside production to enable the development provider |
| `PAYMENT_SECRET_KEY`        | Reserved          | None                    | Reserved for a future real provider; never commit it |
| `PAYMENT_WEBHOOK_SECRET`    | Mock only         | None                    | HMAC secret for the development mock webhook        |
| `REVERSE_GEOCODING_URL`     | No                | OpenStreetMap Nominatim | Server-side reverse-geocoding endpoint; must be Nominatim-compatible |
| `REVERSE_GEOCODING_API_KEY` | Provider only     | None                    | Server-side provider key; never bundled into the frontend |
| `REVERSE_GEOCODING_USER_AGENT` | No             | App name + `FRONTEND_URL` | Identifying User-Agent required by OpenStreetMap's usage policy |

Environment values are validated with Zod in `src/config/env.ts` at startup.
Invalid core values stop the process with a readable message. In production,
`CORS_ORIGINS` must be set and every configured origin must be an HTTPS origin
that is not a localhost address; `FRONTEND_URL` must also be the deployed HTTPS
frontend origin. The API never falls back to a wildcard origin and never trusts
a localhost origin in production.

### Location indicator (privacy)

The school dashboard shows the signed-in user's device timezone, detected with
`Intl.DateTimeFormat().resolvedOptions().timeZone`, and optionally a place name
after the user explicitly grants browser location permission. The frontend calls
`GET /api/location/reverse?latitude=…&longitude=…`; the API is authenticated and
rate-limited and forwards the coordinates once to the configured
Nominatim-compatible provider. Coordinates and results are not stored, and the
indicator never polls for location. If permission is denied, unsupported, or the
provider is unavailable, the device timezone remains visible.

This personal indicator never affects the academic calendar. Academic years,
terms, deadlines and report dates remain governed by the centrally managed
school/platform calendar (`Africa/Accra` in `src/calendar/logic.ts`).

`CORS_ORIGINS` format: comma-separated exact origins (`scheme://host[:port]`),
no trailing slash, no path, no wildcard. Example:

```text
CORS_ORIGINS=https://app.example.com
FRONTEND_URL=https://app.example.com
```

In development the four local Vite origins (`http://localhost:5173`,
`http://localhost:5174`, `http://127.0.0.1:5173`, `http://127.0.0.1:5174`) are
always trusted in addition to the configured values, because Vite falls forward
to port 5174 when 5173 is already in use. These loopback origins are never added
in production.

Reserved variables are accepted as non-empty strings but are not consumed until
their features are implemented.

### Replacing local placeholders

1. `DATABASE_URL` — uncomment it in `.env` and replace `USER`, `PASSWORD`,
   `HOST`, and the database name with the private development database. The API
   and Prisma migration commands use this URL.
2. `TEST_DATABASE_URL` — create a separate database for integration tests whose
   name contains `test`. Never reuse the development database for integration
   tests; the suite refuses to run when both URLs are identical.
3. `AUTH_SECRET` remains reserved and can stay commented out. To exercise
   provider-neutral online payments locally, set `PAYMENT_PROVIDER=mock` and
   `PAYMENT_WEBHOOK_SECRET` to a private random value outside production. This
   mock is not a real provider, holds no real credentials and never claims that
   money moved. Configure all four `R2_*` values together when enabling private
   report storage; otherwise development and test use the local private storage
   adapter.
4. Keep both connection strings private. Do not commit `.env`, share URLs or
   passwords in messages, or include them in screenshots and logs.

R2 credentials can remain unconfigured for local development and tests; the
backend then uses private local storage. Production refuses to store or serve
report files or payment evidence without all four R2 values. The mock payment
provider is disabled in production even if `PAYMENT_PROVIDER=mock`. No real
provider credentials are included. Missing database credentials are safe: the
health endpoint still works, database-backed routes return a clear 503, and the
live integration suite is skipped.

The Prisma CLI needs a syntactically valid URL to load `prisma.config.ts`, so it
uses a localhost-only placeholder for offline commands (`generate`, `validate`,
`migrate diff`). That placeholder is not a credential and cannot connect to a
real database. Migration and `db` commands throw before running when
`DATABASE_URL` is absent, so the placeholder is never used to migrate anything.
Runtime database access returns a clear 503 until `DATABASE_URL` is provided.

## PostgreSQL configuration

Both connection strings are supplied manually by the project owner. Nothing in
this repository contains real credentials.

| Variable            | Used by                                  | Required for                         |
| ------------------- | ---------------------------------------- | ------------------------------------ |
| `DATABASE_URL`      | API runtime and `prisma migrate deploy`  | Database-backed features, migrations |
| `TEST_DATABASE_URL` | Integration suite only                    | `npm run test:integration`           |

Connection string format:

```text
postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE_NAME?sslmode=require
```

- Use `sslmode=require` for hosted providers. For a local Docker PostgreSQL
  instance without TLS, `sslmode=disable` is typical.
- URL-encode special characters in the username or password.
- Keep `TEST_DATABASE_URL` pointed at a **separate** database whose name
  contains `test`. The integration suite refuses to run if the name lacks
  `test`, if it equals `DATABASE_URL`, or if `NODE_ENV=production`.
- Never commit `.env`. It is git-ignored.
- The API never logs connection strings, passwords, or tokens. Database
  failures return a generic message (503 when unconfigured, 500 otherwise in
  production).

PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://USERNAME:PASSWORD@db.example.com:5432/gradely?sslmode=require"
$env:TEST_DATABASE_URL = "postgresql://USERNAME:PASSWORD@db.example.com:5432/gradely_test?sslmode=require"
```

Or copy `.env.example` to `.env` and fill in the values locally.

## Migrations

The committed migration history is:

```text
prisma/migrations/migration_lock.toml
prisma/migrations/20261104120000_init/migration.sql
prisma/migrations/20261104163459_phase3_school_management/migration.sql
prisma/migrations/20261104171000_default_school_timezone/migration.sql
prisma/migrations/20261104204623_phase4_assessment_results/migration.sql
prisma/migrations/20261104210000_phase4_policy_versions/migration.sql
prisma/migrations/20261105120000_phase5_report_cards/migration.sql
prisma/migrations/20261105150000_phase5_report_batch_skipped/migration.sql
prisma/migrations/20261105170000_phase6a_billing_payments/migration.sql
```

The Phase 4 migrations are additive: they create assessment, grading, score,
submission, review, audit-history and class-teacher permission tables, plus the
school-level `classTeacherEntryMode` setting. The Phase 5 migrations are also
additive: they add report settings, inputs, assets, generation batches,
failures, immutable report versions, and a skipped-count column. The Phase 6A
migration adds pricing rules, invoices, invoice lines and pupils, payments,
private evidence metadata, verification decisions, provider events and billing
audit history, with database checks for non-negative balances and valid state
transitions. They do not
drop or rewrite Phase 1–4 data.

Apply migrations to a fresh PostgreSQL database:

```bash
Copy-Item .env.example .env     # fill in DATABASE_URL
npm run prisma:migrate:deploy   # applies pending migrations only
npm run prisma:migrate:status
```

Guidelines:

- `prisma migrate deploy` is the supported path for shared, staging, and
  production databases. It applies committed migrations and never resets data.
- Do **not** use `prisma db push` as a substitute for migration history.
- Do **not** run `prisma migrate reset` against any database you cannot safely
  destroy. It drops all data by design.
- `npm run prisma:migrate` (`migrate dev`) is for local development only; it may
  create a shadow database and generate new migrations.
- Re-running `prisma migrate diff --from-empty --to-schema prisma/schema.prisma
  --script` and comparing the output verifies the schema still matches the
  committed migrations. This check is offline and needs no credentials.

## Database models

- Provider: PostgreSQL
- ORM: Prisma 7 (`prisma-client` generator, ESM output), with
  `@prisma/adapter-pg`
- Client output: `src/generated/prisma/` (generated, git-ignored)
- Schema: `prisma/schema.prisma`

| Model                           | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `School`                        | Tenant root. Unique slug, contact details, timezone, assessment entry mode. |
| `User`                          | Global account. Unique lowercase email, password hash, platform flag.    |
| `SchoolMembership`              | Tenant link between a user and a school with a role and status.         |
| `AcademicYear` / `AcademicTerm` | Centrally managed calendar container and ordered terms.                |
| `AcademicCalendarTransition`    | Append-only transition audit trail, including blocked and failed runs.  |
| `AuditLog`                      | General actor/action/entity audit entries.                              |
| `PasswordResetToken` / `Session`| Hashed, expiring credentials for reset and login.                       |
| `SchoolClass` / `Pupil`         | Classes and pupil records, both school-scoped.                          |
| `PupilEnrollment`               | Pupil-to-class enrollment for an academic year with status.             |
| `Subject` / `ClassSubject`      | Subject catalogue and the subjects offered by a class.                  |
| `ClassTeacherAssignment`        | Active class-teacher assignment with start/end dates.                   |
| `SubjectTeacherAssignment`      | Active subject-teacher assignment for one class and subject.            |
| `ClassTeacherSubjectPermission` | Explicit class-teacher subject grant used in `EXPLICIT_ONLY` mode.      |
| `AssessmentPolicy`              | Versioned, scoped policy (term, level, or class) for one term.          |
| `AssessmentComponent`           | SBA/exam component with maximum score and weight in basis points.       |
| `GradingScheme` / `GradeBand`   | School-owned grading scale and its continuous score bands.              |
| `PupilSubjectScore`             | Durable result snapshot for one pupil, subject, and term.               |
| `AssessmentScore`               | One component score for one pupil; explicit zero is stored, missing is not. |
| `ResultSubmission`              | Draft/submitted/returned/accepted state, version, and policy snapshot.  |
| `ResultReview`                  | Append-only accept/return decisions with reviewer comment.              |
| `ResultAuditHistory`            | Append-only Phase 4 audit trail for configuration, scores, and review.  |
| `PricingRule`                   | Versioned per-pupil GHS price with effective dates and active flag.      |
| `SchoolInvoice`                 | One immutable-price invoice per school, year and term with balances.     |
| `InvoiceLine` / `InvoicePupil`  | Priced lines and the unique eligible pupil population snapshot.          |
| `Payment`                       | Manual/online attempt with source, status, applied and overpayment amounts. |
| `PaymentEvidence`               | Private storage metadata for manual-payment proof; never a public URL.   |
| `PaymentVerification`           | Append-only verify/reject decision with reason and actor.                |
| `BillingAuditHistory`           | Append-only Phase 6A billing audit trail.                                |
| `PaymentProviderEvent`          | Provider event idempotency and processing outcome.                       |

Every school-owned table carries an indexed `schoolId`. Composite unique
constraints prevent duplicate scores, submissions, grade-band order, and
membership rows.

`PLATFORM_SUPER_ADMIN` is a global role vocabulary value represented by
`User.isPlatformAdmin`; it is never stored on `SchoolMembership`, is not
accepted by `requireRole`, and cannot be requested through public registration.
It has no implicit access to any school or pupil data.

## Authentication and school isolation

- `POST /api/auth/register-school` creates `School` + `User` +
  `SchoolMembership(SCHOOL_ADMIN)` + audit entry in one Prisma transaction.
- Passwords are hashed with salted scrypt; session and reset tokens are random
  256-bit values stored only as SHA-256 hashes.
- Sessions use an HttpOnly cookie (`gradely_session`) with `SameSite=Lax` in
  development and `SameSite=None; Secure` in production. Bearer tokens are also
  accepted for API clients.
- Login, registration, and password-reset requests are rate limited per process.
  Registration defaults to 20 attempts per IP per hour. A multi-instance
  deployment must move this interface to a shared store such as Redis; otherwise
  each instance enforces its own window.
- Password reset creates a token but does not send email yet. In development the
  reset link is logged to the server console only.
- `requireSchoolAccess` resolves membership from the authenticated user and the
  `:schoolId` route parameter. There is no implicit cross-tenant access.
- School administrators create teacher accounts with an initial password and the
  credentials are emailed through the transactional outbox. The teacher must
  replace the temporary password at first sign-in; the API enforces this
  server-side on every route except the password-change and verification paths.

School-scoped foundation endpoints include profile, academic years and terms,
classes, pupils and enrollments, subjects, teachers, and teacher assignments.
All are mounted beneath `/api/schools/:schoolId` and require an ACTIVE
membership. Administrator-only operations use `requireRole('SCHOOL_ADMIN')`.

## Automatic academic calendar

Academic years and terms are not created or edited from the school workspace.
Registration initialises the current September-to-August year with Term 1, Term
2 and Term 3, opens the term containing today in `Africa/Accra`, and records
any earlier terms as completed history so the scheduler can never re-open them.
If the scheduler finds an existing school without a calendar, it bootstraps the
current year with the same lifecycle rules.

- `GET /api/schools/:schoolId/calendar` is the read-only calendar for all active
  school members. It returns the current year, current term, next term, opening
  and closing dates, assessment deadlines, examination periods, report
  preparation status and full year history.
- Every school-scoped academic-year or term mutation is rejected with `403`.
- The hourly calendar scheduler opens terms on their configured date, prepares
  reports at term end, closes a term only after all required result submissions
  are accepted, finalizes Term 3 after the academic year ends, promotes pupils
  and archives the previous year without deleting history.
- Platform administrators retain exceptional controls beneath
  `/api/platform/calendar`, including date corrections and manually triggered
  transitions. Closing still runs the completion checks.
- Report preparation uses a platform actor and the existing generation service;
  release remains a separate, payment-dependent workflow.
- Configure the scheduler with `CALENDAR_SCHEDULER_ENABLED` and
  `CALENDAR_SCHEDULER_INTERVAL_MINUTES`. It starts after the first interval so
  API startup does not open a database connection.

## Phase 4 assessment configuration

All Phase 4 routes are mounted beneath `/api/schools/:schoolId/assessments`.
Authentication, school access, and trusted-origin checks run once at the router
boundary. Every score read and write is then re-checked against the actor's
class/subject authorization inside the repository.

### Assessment policies

- A policy belongs to one academic year and term and is scoped to a class, an
  educational level, or the whole term.
- Resolution order is **class-specific → level-specific → term-wide default**.
  Only an active policy for the term is resolved.
- Component weights use basis points and must total exactly **10000** (100.00%).
  Each component needs a maximum score above zero, at least one SBA component,
  and at least one examination component.
- Creating a replacement for a scope starts a new policy version. Existing
  submissions keep the policy and grading snapshot recorded with them.
- Example 40/60 components and example grade bands are editable starting points,
  not a mandated national scale.

### Grading schemes

- A scheme belongs to an academic year and optionally one term.
- Bands must be contiguous from 0.00 to 100.00 with no overlaps and no gaps;
  overlapping or gapped schemes are rejected.
- The server validates bands again when a scheme is saved or attached to a
  policy. The frontend mirrors the rule only for immediate feedback.
- Accepted results retain their grade label and remark snapshots even if the
  school later edits the scheme.

### Calculation and rounding

The calculation library in `src/assessment/calculation.ts` is deterministic and
decimal-safe:

- Scores, maxima, and contributions are stored as integer hundredths.
- Weights are stored as basis points (40.00% = 4000).
- Each component contribution is `score × weight ÷ maximum`, rounded **half-up**
  to two decimal places before contributions are summed.
- Category totals and the final score are exact sums of the already-rounded
  component contributions. No final re-rounding is applied.
- A missing component produces a `null` final score. An explicit `0` is a real,
  complete score. Missing is never coerced to zero.
- A final score is mapped to the first matching band; bands are validated to
  cover the whole 0–100 range.

### Score entry and teacher authorization

- Score entry is a whole-class sheet for one term, class, and subject.
- Drafts can be saved repeatedly. Blank cells stay missing; `0` is preserved.
- Bulk paste accepts tab-separated rows/columns; Enter and arrow keys move
  between pupil rows.
- Submission requires every active pupil to have a complete result.
- `CLASS_TEACHER` needs an active class assignment plus either:
  - `ALL_CLASS_SUBJECTS` mode, or
  - an explicit `ClassTeacherSubjectPermission` in `EXPLICIT_ONLY` mode.
- `SUBJECT_TEACHER` needs an active `SubjectTeacherAssignment` for the exact
  class and subject; explicit class-teacher grants do not widen this.
- `SCHOOL_ADMIN` may enter any active class-subject in its school.
- `PLATFORM_SUPER_ADMIN` and any role without a school membership are denied.
- The class-subject must be active and neither the class nor the subject may be
  archived.

The pure decision matrix lives in `src/assessment/rules.ts` and is unit tested
without a database.

### Submission and review workflow

```text
DRAFT ──submit──▶ SUBMITTED ──accept──▶ ACCEPTED (immutable)
  ▲                    │
  │                    └──return──▶ RETURNED_FOR_CORRECTION
  └──────── correct and resubmit ──────────┘
```

- `DRAFT` and `RETURNED_FOR_CORRECTION` sheets are editable.
- `SUBMITTED` sheets are locked against ordinary edits while under review.
- Only a `SUBMITTED` sheet can be accepted or returned.
- Returning requires a comment; accepting allows an optional comment.
- `ACCEPTED` results are immutable. Later changes require a new assessment
  cycle.
- Every transition stores a `ResultReview` row and append-only
  `ResultAuditHistory` before/after state.
- Score writes and reviews run in Prisma transactions. Submission rows are
  locked, `expectedVersion` detects concurrent edits, and unique constraints
  prevent duplicate submissions.
- Acceptance is an **internal academic review** step. It does not release report
  cards, generate PDFs, trigger payment, or publish results to families.

### Audit trail

Phase 4 writes append-only `ResultAuditHistory` entries for settings changes,
grading-scheme and policy changes, class-teacher permission grants/revokes, score
drafts, submissions, acceptances, and returns. Entries include actor user and
membership (where available), IP address, user agent, timestamps, and redacted
before/after state. They are tenant-scoped and can be listed per submission.

## Phase 4 API endpoints

All paths are relative to `/api/schools/:schoolId/assessments`.

| Method | Path | Access | Purpose |
| ------ | ---- | ------ | ------- |
| `GET` | `/settings` | Any ACTIVE member | Read class-teacher entry mode |
| `PATCH` | `/settings` | `SCHOOL_ADMIN` | Change entry mode |
| `GET` | `/class-teacher-permissions` | `SCHOOL_ADMIN` | List explicit grants |
| `POST` | `/class-teacher-permissions` | `SCHOOL_ADMIN` | Grant a subject |
| `DELETE` | `/class-teacher-permissions/:permissionId` | `SCHOOL_ADMIN` | Revoke a grant |
| `GET` | `/grading-schemes` | Any ACTIVE member | List schemes |
| `POST` | `/grading-schemes` | `SCHOOL_ADMIN` | Create a scheme |
| `PATCH` | `/grading-schemes/:schemeId` | `SCHOOL_ADMIN` | Edit bands or details |
| `POST` | `/grading-schemes/:schemeId/activate` | `SCHOOL_ADMIN` | Activate a scheme |
| `GET` | `/policies` | Any ACTIVE member | List policies |
| `POST` | `/policies` | `SCHOOL_ADMIN` | Create and activate a policy version |
| `PATCH` | `/policies/:policyId` | `SCHOOL_ADMIN` | Edit a policy |
| `POST` | `/policies/:policyId/activate` | `SCHOOL_ADMIN` | Activate a policy |
| `GET` | `/class-subjects` | Authorized teacher or admin | List entries the actor may use |
| `GET` | `/score-entry` | Authorized teacher or admin | Load a score sheet |
| `PUT` | `/score-entry` | Authorized teacher or admin | Save a draft |
| `POST` | `/score-entry/submit` | Authorized teacher or admin | Validate and submit |
| `GET` | `/submissions` | Admin or authorized teacher | Track submissions (teacher results filtered by pair) |
| `GET` | `/submissions/:submissionId` | Admin or authorized teacher | Read one submission |
| `GET` | `/submissions/:submissionId/reviews` | Admin or authorized teacher | List review decisions |
| `GET` | `/submissions/:submissionId/history` | Admin or authorized teacher | List audit entries |
| `POST` | `/submissions/:submissionId/review` | `SCHOOL_ADMIN` | Accept or return for correction |

Validation failures return `400` with `error.details` field issues. Locked,
accepted, stale-version, or duplicate-write conflicts return `409`. Missing or
cross-school resources return `404`/`403` without leaking another tenant's data.

## Phase 5 internal report cards

All paths are relative to `/api/schools/:schoolId/reports`. There is no public
pupil or parent report endpoint. Authentication, school access, and trusted
origin checks run at the router boundary; every read is re-checked against the
caller's class assignment inside the service.

| Method | Path | Access | Purpose |
| ------ | ---- | ------ | ------- |
| `GET` | `/settings` | `SCHOOL_ADMIN` | Read term report settings |
| `PUT` | `/settings` | `SCHOOL_ADMIN` | Save branding, signature, ranking and aggregate rules |
| `GET` | `/assets` | `SCHOOL_ADMIN` | List private branding assets |
| `POST` | `/assets` | `SCHOOL_ADMIN` | Upload PNG/JPEG emblem, crest or signature |
| `GET` | `/assets/:assetId/file` | `SCHOOL_ADMIN` | Stream a private asset |
| `GET` | `/classes` | Assigned teacher or admin | List classes available for reports |
| `GET` | `/inputs` | Assigned teacher or admin | Read authorized report inputs |
| `PUT` | `/inputs` | Class teacher or admin | Save attendance, dates, remarks and attitude |
| `GET` | `/eligibility` | Assigned teacher or admin | Check complete accepted results |
| `POST` | `/generate` | `SCHOOL_ADMIN` | Generate individual, class or term reports |
| `GET` | `/batches` | `SCHOOL_ADMIN` | List generation batches |
| `GET` | `/batches/:batchId` | `SCHOOL_ADMIN` | Inspect failures and versions |
| `POST` | `/batches/:batchId/retry` | `SCHOOL_ADMIN` | Retry failed pupils |
| `GET` | `/cards` | Assigned teacher or admin | List report cards |
| `GET` | `/cards/:reportCardId` | Assigned teacher or admin | Read card, versions and inputs |
| `GET` | `/cards/:reportCardId/preview` | Assigned teacher or admin | Render a private draft PDF |
| `GET` | `/cards/:reportCardId/versions/:version/pdf` | Assigned teacher or admin | Download an exact stored version |

### Report contract

- The PDF is A4 portrait and follows this exact section order:
  `SCHOOL_HEADER`, `PUPIL_INFORMATION`, `ACADEMIC_PERFORMANCE`,
  `PERFORMANCE_SUMMARY`, `REMARKS_ATTITUDE`, `HEADTEACHER_SIGNATURE`,
  `GRADING_SCALE`.
- The header centres the school name, address and contact details, then reserves
  left/centre/right image positions for emblem, crest and pupil photo. Missing
  images leave neutral blank space; Wise Grade never substitutes its own logo.
- Pupil information is one bordered table with three vertical blocks. Academic
  performance is one merged-heading table with seven columns: `SUBJECT`,
  `CLASS/SBA SCORE`, `EXAMINATION SCORE`, `TOTAL SCORE`, `SUBJECT POSITION`,
  `GRADE`, `REMARK`.
- Scores, subject order, grades and grading bands come from the accepted result
  snapshots. Per-subject SBA/exam weights are printed when they differ.
- The summary row has four bordered cells: `AGGREGATE`, `AVERAGE`, `ATTENDANCE`,
  `TOTAL`. Ranking and aggregate policies are configurable; disabled ranking or
  aggregate prints `N/A`.
- Remarks and attitude are two equal boxes filled only from authorized report
  inputs. The signature line uses an optional authorized signature image and a
  configurable label defaulting to `HEADMASTER'S SIGNATURE`.
- Every page carries `INTERNAL DRAFT — NOT RELEASED`. Generation is not release.

### Versioning and storage

- A report card is unique per school, term and pupil. Each material generation
  creates a new immutable `ReportCardVersion` containing the full snapshot,
  stored object key, SHA-256 checksum, byte size and page count.
- Re-running generation with unchanged results and inputs is idempotent: the
  batch records a skip and no new version is created.
- Missing results, unaccepted submissions, invalid attendance, grading
  mismatches and other eligibility failures create a recorded failure or skip;
  they never produce an apparently complete report.
- PDFs and branding assets are private. In production, all four `R2_*` values
  must be configured; objects are addressed by school-scoped keys and served
  only through authenticated backend routes. Development and tests use the
  local private adapter under `backend/.storage` (git-ignored).
- Stored PDF downloads are verified against the recorded checksum before being
  sent. Cross-school and unassigned-class reads are denied.
- Card detail responses expose version metadata only. The full immutable
  snapshot and private storage object key never leave the backend.
- Report settings are readable and writable only by `SCHOOL_ADMIN`; teachers
  can read authorized inputs and preview cards for their assigned classes.

## Phase 6A billing and payments

Phase 6A adds per-pupil billing, invoices, manual payment evidence and a
provider-neutral online-payment foundation. It deliberately does **not** add
report approval or release. Payment verification updates billing state only;
report cards remain internal drafts and Phase 6B remains a separate workflow.

### Pricing rules

- Prices are integer GHS minor units (pesewas), never floating point.
- A pricing rule has `currency`, `amountMinor`, `effectiveFrom`, `effectiveTo`,
  `isActive` and an incrementing `version`.
- Only a platform super administrator may create, activate or deactivate a rule.
- A new rule must start after the latest rule for that currency; the previous
  rule's `effectiveTo` closes the day before the new interval. History is never
  rewritten.
- Invoices freeze the resolved pricing rule id, version, amount and effective
  dates in an immutable snapshot. Later price changes cannot alter issued
  invoices.

### Invoice calculation and state

- Billing counts unique eligible pupils per school, academic year and term.
  Multiple report versions for the same pupil are de-duplicated and never
  multiply the bill.
- The backend calculates `subtotal = unitAmountMinor × uniqueEligiblePupils`
  and `total = subtotal + adjustment`. The client cannot submit its own totals.
- Invoice states are `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID` and `CANCELLED`.
- Allowed transitions are explicit: `DRAFT → ISSUED`, `DRAFT → CANCELLED`, and
  `ISSUED → CANCELLED` only while nothing has been paid. Issued invoices are
  immutable; recalculating one is rejected.
- An invoice total must be greater than zero, and a non-zero adjustment requires
  a reason.

### Payment states and overpayment policy

- Payment states are `PENDING`, `UNDER_REVIEW`, `VERIFIED`, `REJECTED`,
  `FAILED` and `CANCELLED`.
- Submitting a payment is not settlement. Only a platform-admin verification
  (manual) or a signed provider webhook (online) can apply money to an invoice.
- Manual payments require a reference, a non-future payment date and private
  evidence (PNG, JPEG or PDF up to 2 MB). Evidence is written to private storage
  and served only through authenticated school/platform routes.
- Verification is restricted to platform super administrators and cannot be
  performed by the payment submitter. Rejection requires a reason.
- Partial payments are supported. The applied amount is capped at the amount
  outstanding; the invoice is never credited above its total and never receives
  a negative balance.
- Verified settlement is the only path that changes `paidMinor`. An issued
  invoice moves to `PARTIALLY_PAID` on the first verified partial payment and to
  `PAID` automatically once cumulative verified applied amounts equal the total.
  No separate reconciliation action is required or provided.
- Overpayment policy: the excess stays on the payment record as
  `overpaymentMinor` for an explicit later credit/refund decision. It is not
  silently discarded or auto-refunded.
- An invoice becomes `PAID` only when verified applied amounts equal its total;
  no code path marks an invoice paid merely because a payment was submitted.
- Manual verification and online settlement lock the payment and invoice rows
  inside one database transaction. Concurrent or duplicate decisions therefore
  cannot apply the same payment twice, lose an update, over-credit an invoice,
  or produce a negative balance.

### Provider-neutral online payments

- `PaymentProvider` is a narrow server-side interface with `createCheckout` and
  signed `verifyWebhook`.
- The only included implementation is a development `mock` provider. It is
  enabled only when `PAYMENT_PROVIDER=mock`, `NODE_ENV` is not `production`, and
  `PAYMENT_WEBHOOK_SECRET` is set. It does not represent a live provider and
  makes no claim that money moved.
- Mock webhooks use HMAC-SHA256 over `${timestamp}.${rawBody}` with
  `x-gradely-timestamp` and `x-gradely-signature` headers. The route mounts
  before `express.json()` so signatures cover the exact raw bytes.
- Provider event ids are unique per provider, so duplicate callbacks are a no-op.
  Amount, currency and school mismatches are rejected.

### Billing endpoints

School routes are under `/api/schools/:schoolId/billing` and require an ACTIVE
`SCHOOL_ADMIN` membership plus tenant scoping:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/invoices` | List school invoices and online-payment availability |
| `GET` | `/invoices/:invoiceId` | Invoice detail, lines, pupils and payments |
| `GET` | `/invoices/:invoiceId/audit` | Invoice-scoped audit history |
| `GET` | `/payments` | List payment attempts (optional `invoiceId`) |
| `GET` | `/payments/:paymentId` | Payment detail with redacted evidence metadata |
| `GET` | `/payments/:paymentId/evidence/:evidenceId` | Stream private evidence |
| `POST` | `/invoices/:invoiceId/payments/manual` | Submit manual payment with evidence |
| `POST` | `/invoices/:invoiceId/payments/online` | Create/reuse a server-priced online attempt |

Platform routes are under `/api/platform/billing` and require
`User.isPlatformAdmin`:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/schools` | Schools, years and terms for invoice creation |
| `GET` | `/pricing-rules` | Pricing version history |
| `POST` | `/pricing-rules` | Create the next pricing version |
| `PATCH` | `/pricing-rules/:ruleId` | Activate or deactivate a rule |
| `GET` | `/invoices` | All invoices with optional status/school filter |
| `GET` | `/invoices/:invoiceId` | Platform invoice detail |
| `POST` | `/invoices` | Create or refresh a draft invoice |
| `POST` | `/invoices/:invoiceId/issue` | Issue and freeze an invoice |
| `POST` | `/invoices/:invoiceId/cancel` | Cancel an unpaid invoice |
| `GET` | `/payments/pending` | Manual payments awaiting review |
| `GET` | `/payments/verified` | Verified payment history |
| `GET` | `/payments/:paymentId` | Platform payment detail |
| `GET` | `/payments/:paymentId/evidence/:evidenceId` | Stream private evidence |
| `POST` | `/payments/:paymentId/verify` | Verify or reject a manual payment |
| `GET` | `/audit` | Billing audit history with optional filters |

Provider callbacks use `POST /api/webhooks/payments/:provider` and authenticate
with the provider signature only, never a school session.

### Billing security

- Every school billing route resolves the actor's membership and scopes queries
  by the authenticated `schoolId`; a mismatched school id returns 403.
- Platform routes reject school administrators even when they also hold a school
  role.
- Manual payment and online initiation, platform write actions and webhooks have
  separate in-process rate limits. Multi-instance deployments should back the
  limiter with a shared store.
- Cookie-authenticated mutations require an allowed `Origin` header. Inputs are
  validated with strict Zod schemas, unknown fields are rejected, evidence is
  type-checked by magic bytes, and safe errors never expose storage keys.
- Pricing, invoice, payment, verification and provider events are audited. The
  verification audit metadata explicitly records the report-release boundary.

## Platform operations

The Platform Super Admin surface extends the existing `/api/platform` API; it
does not create a second dashboard or identity system. New authenticated
surfaces (paths relative to `/api/platform`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Database, Prisma, migration, storage, scheduler and payment-provider health |
| `GET` | `/notifications` | Filtered, paginated platform notification inbox |
| `GET` | `/notifications/unread-count` | Unread badge count |
| `POST` | `/notifications/:id/read` | Mark one notification read |
| `POST` | `/notifications/read-all` | Mark every notification read |
| `GET` | `/security` | MFA, lockout, recent security events and sessions |
| `POST` | `/security/reauth` | Issue a short-lived, single-use, purpose-bound grant |
| `POST` | `/security/mfa/enroll` | Start optional TOTP enrollment |
| `POST` | `/security/mfa/confirm` | Confirm TOTP and receive one-time recovery codes |
| `POST` | `/security/mfa/disable` | Disable MFA after reauthentication |
| `POST` | `/security/mfa/recovery-codes` | Regenerate recovery codes |
| `GET` | `/security/sessions` | List sessions with expiry and current marker |
| `POST` | `/security/sessions/:id/revoke` | Revoke another session |
| `GET` | `/security/events` | Recent login and security history |
| `GET` | `/exports` | List available export datasets |
| `GET` | `/exports/:dataset` | Stream an audited, privacy-minimized CSV |
| `GET` | `/reconciliation` | Cross-school payment reconciliation issues |
| `POST` | `/reconciliation/:paymentId/acknowledge` | Audit an acknowledgement without rewriting settlement |

High-impact actions require `X-Platform-Reauth` with a grant obtained from
`POST /api/platform/security/reauth`. Grants expire after five minutes, are
single-use and are bound to one of: `SENSITIVE_ACTION`, `DATA_EXPORT`,
`PAYMENT_RECONCILIATION`, `SECURITY_SETTINGS`, `SESSION_REVOKE`.

Optional MFA uses a dependency-free TOTP implementation. Secrets are encrypted
with AES-256-GCM derived from `AUTH_SECRET`; recovery codes are stored as
SHA-256 hashes and shown once. Production must set `AUTH_SECRET` before MFA
enrollment. Email and SMS delivery are not implemented or claimed;
notifications are in-app only.

Operational documentation:

- [Platform operations completion report](docs/PLATFORM_OPERATIONS_COMPLETION_REPORT.md)
- [Backup and recovery](docs/BACKUP_AND_RECOVERY.md)

## Testing

`npm test` runs unit and HTTP tests with in-memory repositories and does not need
a database. Coverage includes auth, registration, password reset, tenant
isolation, school management, calculation and band validation, the Phase 4
authorization/state-transition rules, Phase 5 report layout, ranking, snapshots,
PDF pagination, versioning, idempotency, failures, private storage, cross-school
authorization and protected previews, and the Phase 6A billing rules:

- pricing versioning, effective dates and platform-only management
- server-calculated totals, unique-pupil counting and duplicate report versions
- invoice state transitions, issued-invoice immutability and cancellation rules
- manual payment evidence validation, storage and authenticated retrieval
- partial payments, overpayment capping, rejection reasons and self-verification denial
- tenant isolation and platform/school role separation
- online payment idempotency, HMAC webhook signatures, duplicate callbacks,
  amount/currency/school mismatch, provider failure and disabled-provider behavior
- billing rate limits on sensitive endpoints

The live PostgreSQL suite lives in `tests/integration/` and is **skipped**
unless `TEST_DATABASE_URL` is configured. It covers:

- PostgreSQL connectivity and Prisma adapter compatibility
- Applied migration history
- School registration transaction and rollback on duplicate email
- User creation and scrypt password verification
- Login, session persistence, and hashed token storage
- School membership and cross-school isolation
- Session revocation on logout
- Unique constraints for email, school slug, and membership
- Phase 4 policy and grading validation, cross-school denial, missing-vs-zero
  scoring, class/subject teacher authorization, draft locking, submission,
  return/resubmit, acceptance immutability, and audit history
- Phase 6A billing reconciliation: pending/rejected payments leave balances
  unchanged, partial settlement moves to `PARTIALLY_PAID`, full settlement moves
  to `PAID`, overpayments are capped and retained, cancelled invoices reject new
  applications, and simultaneous verification/webhook settlement cannot double
  apply or lose an update

Setup:

```powershell
# 1. Create a dedicated test database whose name contains "test".
# 2. Put both URLs in backend/.env (never commit it).

# 3. Apply the committed migrations to the test database.
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run prisma:migrate:deploy
npm run prisma:migrate:status

# 4. Run only the live suite.
npm run test:integration
```

Notes:

- Vitest loads `backend/.env` through the shared dotenv helper before tests are
  collected, so `TEST_DATABASE_URL` can come from the file instead of the shell.
- If `TEST_DATABASE_URL` is absent after loading `.env`, only the live suite is
  skipped. If it is present but unsafe, the suite fails during collection with a
  clear safety error instead of skipping.
- The suite refuses to run against `DATABASE_URL`, in production, or against a
  database name without `test`.
- Cleanup deletes only rows created by the suite (tracked ids). It never
  truncates tables and never runs destructive migrations.
- Do not point `TEST_DATABASE_URL` at production or at a database containing
  data you need.

`scripts/verify-phase4-live.ts` is an optional manual verification script for a
**local development database only**. It refuses to run unless `NODE_ENV` is
`development` and `DATABASE_URL` points at exactly `localhost:5432/wise_grade`.
It creates disposable schools and records and deletes only the rows it created,
but because it targets the development database it must not be run against
shared, staging, production, or irreplaceable data. It does not use
`TEST_DATABASE_URL`.

## Structure

```text
backend/
├── prisma/
│   ├── migrations/
│   │   ├── 20261104120000_init/
│   │   ├── 20261104163459_phase3_school_management/
│   │   ├── 20261104171000_default_school_timezone/
│   │   ├── 20261104204623_phase4_assessment_results/
│   │   ├── 20261104210000_phase4_policy_versions/
│   │   ├── 20261105120000_phase5_report_cards/
│   │   ├── 20261105150000_phase5_report_batch_skipped/
│   │   ├── 20261105170000_phase6a_billing_payments/
│   │   └── migration_lock.toml
│   └── schema.prisma
├── scripts/
│   └── verify-phase4-live.ts  Manual live Phase 4 verification
├── src/
│   ├── assessment/            Policies, grading, calculation, rules, repository
│   ├── auth/                  Password hashing, tokens, repository, validation
│   ├── billing/               Pricing, invoices, payments, providers, repository
│   ├── config/env.ts          Validated environment configuration
│   ├── errors/                Typed HTTP errors
│   ├── lib/                   Lazy Prisma client, cookies, slugs
│   ├── middleware/            Auth, authorization, CSRF, rate limiting, errors
│   ├── reports/               Report settings, generation, PDFs, storage
│   ├── routes/                health, auth, schools, assessments, reports, billing
│   ├── schools/               School management repository and validation
│   ├── storage/               Private local/R2 storage adapters
│   ├── types/                 Express request augmentation
│   ├── app.ts                 Express app composition
│   ├── index.ts               Process entry point and shutdown
│   └── generated/prisma/      Generated client (git-ignored)
├── tests/
│   ├── integration/           Skipped unless TEST_DATABASE_URL is set
│   └── helpers/               In-memory repositories and fixtures
├── prisma.config.ts
├── vitest.config.ts
└── tsconfig*.json
```

## Deployment note

This is a conventional TypeScript Node.js/Express service. Cloudflare is a good
fit for the static frontend and related services, but this Express process
should run on a Node.js-compatible host with a managed PostgreSQL database. It
is not written as a Cloudflare Worker. No production credentials are included
in this repository.

For production, also plan for:

- A shared rate-limit store (for example Redis) so login, registration, and
  password-reset windows apply across instances.
- Secure teacher invitations with single-use expiring tokens and forced password
  changes instead of administrator-chosen initial passwords.
- Email delivery for password reset and invitations.
- Backups, monitoring, and a migration deployment runbook.

## Production deployment (Vercel)

The backend deploys as a separate Vercel project named `gradely-backend` with
Root Directory `backend` and Framework Preset Other. `api/index.js` exports the
compiled Express app through `dist/serverless.js`; it never calls `listen` and
never starts an interval timer. Academic calendar processing runs through the
protected `GET /api/internal/calendar` Cron endpoint, guarded by `CRON_SECRET`
and a PostgreSQL lease.

See [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md) for project
settings, the complete environment-variable checklist, migration command,
deployment sequence, health checks and the scheduler strategy.

## Scope and limitations

Implemented through Phase 6A:

- Multi-school identity, sessions, roles, and tenant isolation.
- School calendar, classes, pupils, subjects, teachers, and assignments.
- Configurable assessment policies, components, grading schemes, and bands.
- Draft and submitted score entry with deterministic calculations.
- Teacher authorization, submission tracking, school review, return/resubmit,
  immutable acceptance, and audit history.
- Internal report card settings, inputs, generation batches, immutable PDF
  versions, private storage, and protected previews.
- Per-pupil pricing rules, server-calculated invoices, manual payment evidence,
  platform verification, and a provider-neutral online-payment foundation.
- School and platform billing dashboards with pricing, invoice, payment and audit
  views.

Not implemented in Phase 6A:

- Report approval, release to pupils or families, or parent-facing portals
  (Phase 6B).
- A live payment provider. Only the non-production `mock` provider is included.
- Automatic refunds or credit notes for overpayments; excess is retained on the
  payment record for an explicit later decision.
- Cloudflare R2 credentials in the repository; production must supply them.
- Password-reset email (transactional email now covers administrator
  verification, teacher credentials, first-login reminders and subject access
  codes; password reset still only logs a development link).
- Cross-instance rate limiting (the included limiter is in-process).
- A full platform-administrator console for school onboarding beyond billing.
