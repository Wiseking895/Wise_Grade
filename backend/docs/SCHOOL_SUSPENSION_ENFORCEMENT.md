# School Suspension Enforcement — Completion Report

**Date:** 14 November 2026
**Scope:** Close the production blocker where a suspended school (`School.isActive = false`)
could still authenticate and read/write school data.
**Databases touched:** `wise_grade_phase6a1_test` only (live integration suite). The development
database `wise_grade` was **not** reset, migrated or modified by this change.

---

## 1. Root cause

`School.isActive` was written by the audited platform suspension route and shown in platform
screens, but no tenant-facing code read it:

| Layer | Previous behaviour |
| --- | --- |
| `authenticate` | Loaded memberships and exposed them without checking the school. |
| `requireSchoolAccess` / `findMembership` | Checked only `SchoolMembership.status === 'ACTIVE'`. |
| Login | Issued a session for valid credentials regardless of school status. |
| `/api/auth/me` | Returned memberships in suspended schools as usable. |
| Subject-teacher access codes | Accepted codes and resolved sessions for suspended schools. |

Result: an existing session kept full school access after suspension, and a suspended school's
administrator could sign in and obtain a new session. Reproduced live before the fix.

---

## 2. Enforcement model

Suspension is enforced **centrally from current database state**, never from a cached value,
token claim or the frontend.

The single rule is defined in `backend/src/auth/membership-access.ts`:

```ts
isUsableMembership = membership.status === 'ACTIVE' && membership.schoolIsActive
```

`schoolIsActive` is loaded from `School.isActive` on every request. There is deliberately no
session revocation and no migration.

### Enforcement points

| File | Change | Effect |
| --- | --- | --- |
| `src/auth/repository.ts` | `MembershipRecord.schoolIsActive` | Carries live school status with every membership. |
| `src/auth/membership-access.ts` | **New.** `isUsableMembership`, `usableMemberships` | One definition shared by auth, `/me`, login and route guards. |
| `src/auth/prisma-repository.ts` | `mapMembership` maps `school.isActive`; `findMembership` returns `null` for an inactive school; `subjectAssignmentInclude` selects `school.isActive`; access-code entry and subject-session resolution reject inactive schools | Every membership and subject-session lookup fails closed. |
| `src/middleware/authorize.ts` | `requireSchoolAccess` uses `isUsableMembership`; synthetic subject membership is explicitly usable because its session was already gated | All school-scoped routers (`schools`, `calendar`, `assessments`, `billing`, `reports`) return the generic 403. |
| `src/middleware/authenticate.ts` | `req.auth.memberships` filtered to usable memberships | Suspended schools disappear from the auth context. |
| `src/routes/auth.ts` | Login computes usable memberships, denies suspended-only non-platform accounts (403 `Access denied`, audit `LOGIN_DENIED`, reason `SCHOOL_SUSPENDED`, **no failed-login increment / no lockout**); login and `/me` return only usable memberships | No new session for a suspended-only account; no suspension disclosure. |
| `tests/helpers/fake-auth-repository.ts` | Mirrors all gates; adds `setSchoolActive` | HTTP tests exercise the same rules in memory. |
| `eslint.config.js` | Ignores `.artifacts` (gitignored scratch scripts) | Keeps lint focused on source; no runtime effect. |

Every denial uses the existing generic message `You do not have access to this school`, so a
suspended school is indistinguishable from a school the caller does not belong to. Subject sessions
receive the existing generic `401` ("invalid, expired or revoked"), not a suspension message.

---

## 3. Session handling decision

**No sessions were invalidated.**

- A user's existing session remains valid, but every request re-reads the school status, so access
  is lost immediately on suspension and restored on reactivation.
- This keeps multiple-school users signed in (only the suspended school is blocked).
- It does not revive independently revoked or expired sessions: revocation/expiry are still checked
  first, and reactivation only removes the school-status gate.
- No unrelated session is touched by suspension or reactivation.

This is the safer option for a multi-tenant product: revoking sessions would force every member of a
suspended school to re-authenticate, and would make reactivation depend on new logins. It also keeps
the existing revocation semantics and audit trail intact.

---

## 4. Multi-membership and role behaviour

- A user with memberships in several schools keeps access to every school whose `isActive` is true.
- The suspended school disappears from login and `/api/auth/me` responses; the other memberships
  remain.
- A user can still sign in if at least one membership is usable. Login is denied only when the user
  is not a platform admin, has at least one membership, and **every** membership's school is
  suspended.
- A user whose membership is suspended (but school active) keeps the previous behaviour — this fix
  does not change membership-level suspension.
- Platform Super Admin is unaffected: platform oversight routes remain available, suspension is
  auditable, and reactivation works. Platform admin status still never grants implicit tenant
  membership (tenant routes remain 403).

---

## 5. Regression tests

### HTTP suite — `backend/tests/school-suspension.test.ts` (11 passed)

| Role / scenario | Verified behaviour |
| --- | --- |
| School Administrator | 200 before suspension; 403 on dashboard and pupils immediately after; generic message; `/me` 200 with no usable memberships; no session destruction. |
| School Administrator (login) | New login 403 `Access denied`, no cookie, `LOGIN_DENIED` audited, `failedLoginCount` stays 0, no lockout. |
| School Administrator (reactivation) | Existing session regains 200 without re-login; new login returns the membership. |
| Class Teacher | 200 on pupils/classes while active; 403 on dashboard, pupils, classes, class dashboard, subjects, score entry after suspension. |
| Subject Teacher (access code) | Code accepted and `/subject-teacher/me` 200 while active; existing restricted session 401 immediately after suspension; fresh code entry 401; another active school's code still works. |
| Multiple memberships | Suspended school 403, active school 200, `/me` lists only the active school, re-login succeeds with one membership, reactivation restores both. |
| Revoked session | Reactivation does not revive an independently revoked session (still 401); the non-revoked session works. |
| Platform Super Admin | `/me`, overview, school list and suspended filter all 200 while a school is suspended; tenant route 403; audited reactivation 200 with `SCHOOL_ACTIVATED`. |
| Security regressions | Unauthenticated 401; cross-school 403; unknown school 403; academic years, terms, members, class-subject counts and profile all 403 after suspension. |

### Live PostgreSQL suite — `backend/tests/integration/school-suspension.integration.test.ts` (5 passed)

Uses the real Prisma repositories and the real platform status route against
`wise_grade_phase6a1_test`, with tracked-row cleanup and the same production/dev safety guards as
`postgres.integration.test.ts`:

1. Existing administrator session loses school access immediately; new login denied; session count
   unchanged; school row, membership, `SCHOOL_SUSPENDED` audit and notification preserved;
   reactivation restores access and writes `SCHOOL_ACTIVATED`.
2. Two-membership user: only the suspended school is blocked; `/me` and re-login list only the
   active school; reactivation restores both.
3. Subject-teacher access-code session returns 401 during suspension, fresh entry is refused, and
   reactivation restores the original (never revoked) session.
4. Platform admin keeps suspended-school visibility and detail access, gets 403 on tenant routes,
   and can reactivate.
5. Unauthenticated/cross-school requests stay denied.

---

## 6. Verification results

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `npm test` | **521 passed, 0 failed, 3 skipped** — 40 files passed, 1 skipped (41 total) |
| — suspension HTTP suite | `npx vitest run tests/school-suspension.test.ts` | **11 passed** |
| — suspension integration | `npx vitest run tests/integration/school-suspension.integration.test.ts` | **5 passed** |
| Backend TypeScript | `npm run typecheck` | Passed |
| Backend ESLint | `npm run lint` | Passed |
| Backend build | `npm run build` | Passed |
| Prisma validation | `npm run prisma:validate` | Schema valid |
| Prisma migration status | `npm run prisma:migrate:status` | 18 migrations, schema up to date |
| Frontend tests | `npm test` | **112 passed, 0 failed** — 31 suites |
| Frontend TypeScript | `npm run typecheck` | Passed |
| Frontend ESLint | `npm run lint` | Passed |
| Frontend build | `npm run build` | Passed (2132 modules) |

The 3 skipped backend tests are the pre-existing `database-unconfigured` tests, skipped when
`DATABASE_URL` is configured. No browser or Playwright verification was performed.

---

## 7. Migration and data preservation

- **Migration required: none.** `School.isActive` and all queried relations already exist; the
  change is read-path only. No schema change, no reset, no migration-history rewrite.
- Suspension writes only `School.isActive` inside a transaction, plus one audit row. No school,
  user, membership, pupil, class, subject, assessment, report, payment or notification is deleted.
- The integration suite asserts that the school row and membership count survive suspension.
- Reactivation writes only `School.isActive` and an audit row; data is intact.
- Existing platform audit and notification records are preserved and remain inspectable.

---

## 8. Remaining limitations

1. `/api/auth/me` returns `200` with an empty membership list for a suspended-only account. This is
   intentional (the account is not disabled and suspension is not disclosed); the UI should treat
   an empty list as "no school access".
2. Login is denied only when **all** memberships belong to suspended schools. A user with one usable
   school can still sign in, by design, to protect multi-school users.
3. Enforcement is a fresh database read per request. This is correct and immediate, but adds one
   membership/school join to authenticated requests; no caching was introduced deliberately.
4. Frontend screens may briefly show a previously loaded school until the next API call; the server
   is authoritative and every school-scoped request is denied.
5. Platform Super Admin has no implicit tenant access (unchanged); oversight is via platform routes.
6. No live browser walkthrough was performed for this change; evidence is HTTP, integration and
   build/static checks.
