# Platform Operations Phase — Final Verification Report

**Verification date:** 14 November 2026
**Database:** `wise_grade` at `localhost:5432` (development), 18 migration files applied
**Identity:** isolated temporary Platform Super Admin `verify-platform-20261113@gradely.test`
(created through `npm run admin:bootstrap`, removed after verification)
**Application:** production build of the backend served on `http://localhost:4001`, `NODE_ENV=development`

The existing platform owner (`wisebizness12@gmail.com`), the existing school (Wisdom Academy), its
pupils, memberships, report batch and notification were **not modified**. No report was released, no
payment was verified, and no existing school was suspended. All writes were confined to one isolated
school, three isolated users, the temporary platform admin and the test session/reauth records they
produced; all of those were deleted at the end.

---

## 1. Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `npm test` (vitest) | **505 passed, 0 failed, 3 skipped** — 38 test files passed, 0 failed, 1 skipped (39 total) |
| Frontend tests | `npm test` (node --test) | **112 passed, 0 failed, 0 skipped** — 8/8 test files passed (31 suites) |
| Backend TypeScript | `npm run typecheck` | Passed (exit 0, after `prisma generate`) |
| Frontend TypeScript | `npm run typecheck` (`tsc -b`) | Passed (exit 0) |
| Backend ESLint | `npm run lint` | Passed (exit 0) |
| Frontend ESLint | `npm run lint` | Passed (exit 0) |
| Prisma validation | `npm run prisma:validate` | `The schema at prisma\schema.prisma is valid` |
| Prisma migration status | `npm run prisma:migrate:status` | `18 migrations found … Database schema is up to date!` |
| Backend production build | `npm run build` (`tsc -p tsconfig.build.json`) | Passed (exit 0) |
| Frontend production build | `npm run build` (`tsc -b && vite build`) | Passed — 2132 modules, `dist/assets/index-*.js` 715.21 kB |

The single skipped backend file is `tests/database-unconfigured.test.ts`, which is intentionally
skipped when `DATABASE_URL` is set (`describe.skipIf(Boolean(env.DATABASE_URL))`). Its 3 skipped tests
are the 3 skipped tests in the summary.

---

## 2. Platform section verification

Legend — **Verified** = exercised live against `wise_grade` with an authenticated platform admin;
**Read-only** = exercised live without mutation; **Unit only** = covered by automated tests but not
driven through a browser.

| Section | Frontend | API | Database integration | Authorization |
| --- | --- | --- | --- | --- |
| Overview | Build + unit tests pass; page registered | `GET /api/platform/overview` 200 | Live counts read (1 school, 4 pupils) | 401 unauthenticated, 403 school roles |
| School onboarding | Unit only (no browser) | `POST /api/platform/schools` 201, duplicate email 409 | Isolated school + admin + membership created; audited; notification written | Reauth-gated (428 without grant); 403 for school roles |
| School listing / status | Build + unit tests pass | `GET /schools`, `GET /schools/:id` 200; `POST /schools/:id/status` 200 | `isActive` persisted, audited, notification written | Reauth-gated; suspension enforcement **fixed and re-verified** (see `SCHOOL_SUSPENSION_ENFORCEMENT.md`) |
| Platform health | Build + unit tests pass | `GET /api/platform/health` 200 | Live DB/Prisma/storage/scheduler/payment checks returned | 401/403 enforced |
| Notifications | Build + unit tests pass | `GET /notifications`, `/unread-count` 200 | 3 isolated events written, dedupe keys unique | 401/403 enforced |
| Payment reconciliation | Build + unit tests pass | `GET /reconciliation` 200 | 0 payments; summary returned | 401/403; acknowledge requires reauth (not exercised — no payments) |
| Central academic calendar | Build + unit tests pass | `GET /calendar`, `GET /calendar/:schoolId` 200 | Live calendar + transitions read | 401/403 enforced |
| Report approval / release | Build + unit tests pass | `GET /reports/overview`, `/schools`, `/batches` 200 (incl. eligibility) | Existing FAILED/PENDING batch read, unchanged | 401/403; release not performed |
| Platform settings | Build + unit tests pass | `GET /settings` 200; `PATCH` without reauth 428 | Payload identical before/after blocked write | Reauth-gated |
| Audit logs | Build + unit tests pass | `GET /audit` 200; CSV export 200 | 204 rows retained; new events appended | 401/403 enforced |
| Security & sessions | Build + unit tests pass | `/security`, `/sessions`, `/events` 200; revoke 200 | Sessions, MFA state, lockout, grants persisted correctly | 401/403 enforced |
| Data exports | Build + unit tests pass | Catalogue 200; CSV 200 with `text/csv`, `no-store` | Live audit + school CSV generated | Reauth + single-use + purpose-bound |
| My Account | Build + unit tests pass | `GET /account`, `GET /account/sessions` 200 | Live profile/session read | 401/403; profile write not exercised live (unit-tested) |

Frontend evidence is build, typecheck, lint and the `platform-operations` / `platform-admin` unit
suites (navigation, route registration, reauth provider, purpose identifiers, honesty copy). No
browser/Playwright run was performed in this verification.

---

## 3. Security verification (live)

| Requirement | Result | Evidence |
| --- | --- | --- |
| School Admin cannot access platform APIs | Pass | 12 endpoints returned 403; onboarding and reauth also 403 |
| Class Teacher cannot access platform APIs | Pass | 403 on overview, schools, exports |
| Subject Teacher cannot access platform APIs | Pass | 403 on overview, security |
| Subject-teacher restricted session cannot access platform APIs | Pass | subject-session cookie alone → 401 |
| Unauthenticated users cannot access platform APIs | Pass | 401 on overview, health, notifications, exports |
| Platform role cannot be changed via profile update | Pass | `isPlatformAdmin` rejected 400 on school and platform profile; DB flags unchanged |
| Sensitive actions require reauthentication | Pass | 428 without `X-Platform-Reauth` on settings, school status, export, MFA disable |
| Grants are purpose-bound | Pass | `SECURITY_SETTINGS` grant rejected on `DATA_EXPORT` export (403) |
| Grants are single-use | Pass | Reused `DATA_EXPORT` grant → 403 |
| Revoked sessions stop working | Pass | Revoked second session → 401; current session unaffected |
| Invalid MFA attempts rejected | Pass | Login 401, enrollment confirm 400, reauth 403 |
| Recovery codes cannot be reused | Pass | First use 200 (10 → 9 remaining), reuse 401 |
| Secrets not returned by API | Pass | No `passwordHash`, `tokenHash`, `encryptedSecret`, `recoveryCodeHashes` or raw password in any response |
| Lockout after repeated failures | Pass | 423 after 5 failures; one deduplicated `PLATFORM_ACCOUNT_LOCKED` notification |

MFA secrets are stored as `v1:<iv>:<tag>:<ciphertext>` (AES-256-GCM); recovery codes as 64-hex
SHA-256 hashes — verified directly in the database, not just in the API response.

Verification note: the batched MFA script re-used one TOTP window for the final disable calls and two
of them returned `428` (no grant header because the minting call failed in the same window). MFA
disable was then verified in a separate run: `POST /api/platform/security/mfa/disable` returned `200`,
the database showed `mfaEnabled = false` with the secret cleared, and a plain login without a second
factor returned `200`. No product defect was observed.

---

## 4. Infrastructure

| Item | Status | Notes |
| --- | --- | --- |
| `AUTH_SECRET` | **Not set in dev** | MFA works in development via the documented non-production fallback key. In production, MFA enrollment is blocked until `AUTH_SECRET` is set (`isMfaConfigured()`), but the API does **not** fail fast — a missing secret only disables MFA. |
| TOTP encryption | Tested | AES-256-GCM envelope, key derived from `AUTH_SECRET`; plaintext never stored |
| Recovery-code storage | Tested | SHA-256 hashes only; codes shown once |
| Cloudflare R2 | **Configured/documented only** | `R2_*` unset; health reports local private storage writable. Production storage mode is `unconfigured` without R2, so logo upload/registration would fail. |
| PostgreSQL health | Tested | Read-only connectivity query `ok` |
| Scheduler monitoring | Tested (read-only) | `SchedulerRun` history read; last run 2026-11-13T12:09Z → health `degraded` (correct staleness signal) |
| Payment-provider health | Configured/documented only | `not_configured`; manual verification path remains |
| Notification retry deduplication | Tested | `dedupeKey` unique; repeated lockout event produced exactly one notification |
| Export expiration | Not applicable | Exports are generated and streamed per request with `Cache-Control: no-store`; no stored artifact exists to expire |

---

## 5. Migration and data safety

- 18 migration files; `prisma migrate status` reports up to date. No pending or failed migrations.
- The new `20261114120000_platform_operations` migration contains only `ADD COLUMN`, `CREATE TABLE`,
  `CREATE INDEX` and foreign keys. No `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` or `DELETE`.
- The only `DROP` token in the whole migration history is `ALTER COLUMN "reviewerMembershipId" DROP
  NOT NULL` (phase 7), which relaxes a constraint and destroys no data.
- `_prisma_migrations` holds 20 rows: 18 applied plus 2 rolled-back attempts of
  `20261104210000_phase4_policy_versions` from 4 November. This is historical noise, not a duplicate
  applied migration.
- Preserved after verification: Wisdom Academy (active, 6 memberships, 4 pupils), the existing
  `FAILED` / `PENDING_PLATFORM_REVIEW` report batch, the existing notification, 0 payments, 0
  invoices, and 204 audit rows (≥ the 150 present before verification). The original platform owner
  is unchanged (active, MFA disabled, no lockout).
- Cleanup: isolated school, its 3 users and 3 notifications removed; temporary platform admin and all
  its sessions/grants removed. Final state: 1 school, 7 users, 4 pupils, 1 platform admin, 1
  notification, 0 reauthentication grants, no duplicate admins or notifications.

---

## 6. Outstanding issues

### Production blockers

1. ~~**School suspension does not revoke tenant access (critical).**~~ **Resolved 14 Nov 2026.**
   Suspension is now enforced centrally from current `School.isActive` on every request for
   administrators, class teachers, subject teachers (including access-code sessions) and
   multi-school users, without revoking sessions or disabling accounts. Regression coverage:
   `tests/school-suspension.test.ts` (11 tests) and
   `tests/integration/school-suspension.integration.test.ts` (5 tests against PostgreSQL).
   Full evidence and remaining limitations: `SCHOOL_SUSPENSION_ENFORCEMENT.md`.

2. **Production prerequisites not yet in place.** `AUTH_SECRET` and `R2_*` are unset in the target
   environment. Without `AUTH_SECRET`, MFA cannot be enabled in production. Without R2, production
   storage is `unconfigured`, so school onboarding/logo upload fails. Neither is a code defect, but
   neither is verified as deployed.

3. **Backup and recovery are documented, not tested.** No restore rehearsal was performed, so
   disaster-recovery readiness is unverified.

### Non-blocking issues

4. **Health migration check is inaccurate.** It reports `appliedCount: 20` vs `expectedCount: 18`
   and names a rolled-back migration as `latestApplied` (ordering by `finishedAt DESC` puts NULLs
   first). Status is still `upToDate: true`; this is an observability defect.
5. **Reauthentication purposes are coarse for school/billing/report actions.** Those routes share a
   single `SENSITIVE_ACTION` purpose, so one grant can be used for any of them until it is consumed
   or expires. Operations routes already use specific purposes (`DATA_EXPORT`, `SECURITY_SETTINGS`,
   `SESSION_REVOKE`, `PAYMENT_RECONCILIATION`).
6. **Recovery codes use an unsalted SHA-256 hash.** The codes carry roughly 39 bits of entropy, so a
   database leak permits offline brute force. An HMAC keyed with a server secret (or Argon2) is
   preferable.
7. **No TOTP replay protection.** A captured code is accepted again within the ±1 period window.
   Storing the last accepted counter would close this.
8. **Export expiry is not implemented** because exports are streamed rather than persisted. If
   expiring download links are a requirement, this needs a separate design.
9. **Scheduler is in-process.** Health correctly flags a stale run, but nothing prevents duplicate
   runs if more than one API instance is deployed.
10. **Frontend was not exercised in a browser.** Build, typecheck, lint and unit suites pass; the
    rendered pages were not clicked through in this verification.

---

## 7. Verdict

Automated quality gates are green (505 + 112 tests, all typechecks, lints, Prisma validation and
both production builds). The platform operations API, authorization model, reauthentication, MFA,
session revocation, exports and notification deduplication all behave correctly in live testing.

**The suspension blocker is fixed.** Tenant suspension now blocks administrators, class teachers and
subject teachers immediately, including existing sessions, while platform oversight and multi-school
access to active schools keep working. The remaining production prerequisites are unchanged:
production secrets and object storage are not configured, and backup restoration has not been
rehearsed.
