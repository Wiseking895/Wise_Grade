# Vercel deployment guide (backend)

Gradely runs as two independent Vercel projects from one repository:

| Project            | Root directory | Framework preset |
| ------------------ | -------------- | ---------------- |
| `gradely-backend`  | `backend`      | Other            |
| frontend (existing)| `frontend`     | Vite             |

Repository: `Wiseking895/Wise_Grade`.

The backend is a standard Express 5 application exported through a Vercel Node
function. It does not call `app.listen()` and does not start an interval timer
in production.

`vercel.json` sets `"framework": null`, which is the project setting for
Framework Preset **Other**. This is deliberate: Vercel's Express auto-detection
would otherwise pick up `src/index.ts` (the long-running local server with its
interval scheduler) instead of the serverless adapter. Routing uses a single
`routes` entry that targets the `/api` function and re-applies the original
request path, because Vercel now routes internal rewrites using the destination
path. Express therefore receives the same `req.url` it would locally.

## 1. Files that make this work

| File | Purpose |
| ---- | ------- |
| `api/index.js` | Vercel function entry. Imports the compiled `dist/serverless.js`. |
| `src/serverless.ts` | Caches one Express app per warm instance and adapts it to `(req, res)`. |
| `src/index.ts` | Local development server. Keeps `app.listen()` and the interval scheduler. |
| `vercel.json` | Build command, framework lock, explicit `dist` output directory, all-path route to `/api` with the original request path, function limits and daily Cron. |
| `src/calendar/scheduler-routes.ts` | Protected `GET/POST /api/internal/calendar` trigger. |
| `src/calendar/scheduler-run.ts` | Shared scheduler runner, audit history and failure notifications. |
| `src/calendar/scheduler-lock.ts` | Single-row PostgreSQL lease that prevents overlapping runs. |
| `prisma/migrations/20261117120000_serverless_scheduler_lock/` | Additive lock table migration. |

## 2. Vercel project settings

Use the existing `gradely-backend` project (ID `prj_vP8313lSSJ6WK78yuqlIBaq6Smbp`,
team `wiseking-creation-works-projects`). Do not create a second backend project.
Confirm these settings before the first deploy:

- Project name: `gradely-backend`
- Git repository: `Wiseking895/Wise_Grade`
- Root Directory: `backend`
- Framework Preset: **Other** (the committed `vercel.json` sets
  `"framework": null`, which is the same setting)
- Build Command: `npm run build` (already in `vercel.json`)
- Install Command: `npm ci` (already in `vercel.json`)
- Output Directory: `dist` (also set explicitly in `vercel.json`; see below)
- Node.js version: **24.x** (the existing project setting, which satisfies
  `engines.node >= 20.19`) or 22.x

State observed on 2026-11-17: Root Directory `backend` and Node 24.x were already
correct; the Framework Preset was still **Express**, Build/Install Command were
`None`, and no Git repository connection was visible. `vercel.json` values win
over the dashboard, so `"framework": null` still builds as **Other** and the
documented build/install commands still run. Keeping the dashboard preset at
Other avoids confusion and makes the CLI's Express auto-detection (which would
target `src/index.ts`) impossible.

### Why `outputDirectory` is `dist`

The backend has no static site; every path is handled by the `api/index.js`
function. Vercel still runs its static build step for a project with no
framework, and that step resolves the framework from the dependencies. Because
Express is a dependency, the static builder falls back to Express's default
output directory, `public`, and fails the deployment with:

```text
STATIC_BUILD_NO_OUT_DIR: No Output Directory named "public" found after the Build completed.
```

There is deliberately no `public` directory. `vercel.json` therefore sets
`"outputDirectory": "dist"`, the directory `npm run build` already creates with
`tsc`. The static build validates that real directory and completes. The
all-path `routes` entry targets `/api` first, so those static files are never
served; they exist only to satisfy the platform's build output check.

`prisma generate` runs automatically through the `prebuild` script. Do not
override the build command with a plain `tsc` call, or the Prisma Client will
not exist.

## 3. Environment variable names

Set these in **Project → Settings → Environment Variables**. Value examples are
placeholders; never commit real values.

### Required in production

| Name | Notes |
| ---- | ----- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon **pooled** connection string (`-pooler` host) |
| `AUTH_SECRET` | Long random secret; also derives MFA key material |
| `CORS_ORIGINS` | `https://wisegrade.app` (exact origin, no wildcard). Add any other exact frontend origin that must call the API, separated by commas. |
| `FRONTEND_URL` | `https://wisegrade.app`. Required: without it the schema falls back to `http://localhost:5173`, which production validation rejects, so the API fails to boot. |
| `BACKEND_URL` | `https://wisegradebackend.vercel.app` |
| `CRON_SECRET` | Random value, at least 16 characters. Vercel Cron sends it as a bearer token to both `/api/internal/calendar` and `/api/internal/email`. |
| `EMAIL_ENABLED` | `true` in production |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` (STARTTLS) |
| `SMTP_USER` | Brevo SMTP login |
| `SMTP_PASS` | Brevo SMTP key (secret) |
| `EMAIL_FROM_NAME` | `WiseGrade` |
| `EMAIL_FROM_ADDRESS` | `no-reply@wisegrade.app` (must be a Brevo-verified sender) |
| `EMAIL_REPLY_TO` | `wiseempire62@gmail.com` |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | `24` |
| `SUBJECT_TEACHER_ACCESS_CODE_EXPIRY_DAYS` | `7` |
| `CALENDAR_SCHEDULER_ENABLED` | `true` |
| `CALENDAR_SCHEDULER_INTERVAL_MINUTES` | `1440` for the included daily Cron |
| `R2_ACCOUNT_ID` | Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
| `R2_BUCKET_NAME` | Private bucket; no public URL |
| `AUTH_SESSION_TTL_MINUTES` | Optional; defaults to `60` |

### Required only for running migrations from a workstation/CI

| Name | Notes |
| ---- | ----- |
| `DIRECT_DATABASE_URL` | Neon **direct/unpooled** endpoint. Used by `prisma migrate deploy`; runtime keeps using `DATABASE_URL`. The existing Vercel project stores an older name, `DIRECT_URL`, which this code does not read. Add `DIRECT_DATABASE_URL` if you want to run migrations through `vercel env run`; otherwise export it in your shell for the migration command. |

### Optional

| Name | Notes |
| ---- | ----- |
| `EMAIL_TEST_RECIPIENT` | Verified mailbox that restricts `POST /api/platform/email/test`. When unset, the signed-in platform administrator's own address is used. |
| `DATABASE_POOL_MAX` | Per-instance pg pool size. Default `5`. Do not raise without checking Neon limits. |
| `PAYMENT_PROVIDER` | Leave unset until a real provider is integrated. `mock` is refused in production. |
| `PAYMENT_SECRET_KEY` | Reserved for a real provider. |
| `PAYMENT_WEBHOOK_SECRET` | Provider webhook signing secret. |
| `REVERSE_GEOCODING_URL` | Defaults to public OSM Nominatim. |
| `REVERSE_GEOCODING_API_KEY` | Only if the geocoder needs a key. |
| `REVERSE_GEOCODING_USER_AGENT` | Identifying User-Agent; set in production. |

Never create a `VITE_` variable containing any of the above. `TEST_DATABASE_URL`
must never be configured on Vercel.

### Environment scoping

| Variable group | Production | Preview | Development |
| -------------- | ---------- | ------- | ----------- |
| `DATABASE_URL`, `AUTH_SECRET`, R2 keys, `CRON_SECRET` | Yes | Yes, with a non-production database/bucket if previews need data | Optional local `.env` |
| `CORS_ORIGINS`, `FRONTEND_URL` | Exact production frontend origin | Each preview frontend origin, or keep previews off | Local Vite origins |
| `CALENDAR_SCHEDULER_ENABLED` | `true` | `false` unless the preview must run jobs | `true` locally |
| `CALENDAR_SCHEDULER_INTERVAL_MINUTES` | `1440` (daily Cron) | Match the Cron cadence if enabled | `60` |
| `DIRECT_DATABASE_URL` | Not needed at runtime | Not needed | Local migration only |

Vercel Cron runs against the production deployment only. Preview deployments do
not receive Cron invocations.

### Local profile safety

Local development uses `backend/.env`, which contains only the local PostgreSQL
database, local Vite origins and `EMAIL_ENABLED=false`. Production/Neon values
are preserved in the git-ignored `backend/.env.production.local` and are never
loaded automatically. Select that profile explicitly for read-only checks or
owner-approved migration tooling:

```powershell
$env:GRADELY_ENV_FILE='.env.production.local'
npx prisma migrate status
Remove-Item Env:GRADELY_ENV_FILE
```

Duplicate keys in one env file are rejected at load time. Vercel uses dashboard
variables and ignores these files.

### Transactional email and outbox Cron

`vercel.json` registers two daily Crons:

| Path | Schedule | Purpose |
| ---- | -------- | ------- |
| `/api/internal/calendar` | `0 1 * * *` | Academic calendar scheduler |
| `/api/internal/email` | `0 2 * * *` | Retry eligible non-sensitive outbox emails |

Both endpoints accept `GET` and `POST`, require
`Authorization: Bearer $CRON_SECRET`, return `503` when the secret is not
configured and `401` for a mismatch. The email endpoint only drains rows already
created by business events; it cannot send arbitrary email.

Outbox rows are claimed with an atomic compare-and-set on `attempts` before
delivery, so concurrent Cron invocations or an inline send cannot deliver the
same row twice. A crashed worker's lease expires and a later run retries it
(at-least-once). Non-sensitive rows back off and stop after five attempts.

Sensitive templates (administrator verification links, temporary teacher
passwords and subject access codes) are stored with redacted payloads and are
never retried. A failure marks them `FAILED`; the business flow requires a fresh
resend or reissue.

On Vercel Pro, change the email schedule to `*/15 * * * *` for tighter retry
latency. Keep the daily schedule on Hobby.

#### Brevo authentication: 535 versus 525

Brevo returns two distinct SMTP authentication failures:

| Code | Meaning | Fix |
| ---- | ------- | --- |
| `535` | Invalid SMTP login or SMTP key | Copy the **Login** and **SMTP key** from Brevo → Settings → SMTP & API. The key is shown only once; generate a new one if lost. |
| `525` | Unauthorized IP address | Brevo's **block unknown IP addresses for SMTP keys** setting is enabled and the caller's egress IP is not on the allow-list. Add the IP or disable IP blocking for the sending key. |

Vercel Functions use shared, dynamic egress IPs, so IP allow-listing a Vercel
deployment is not reliable. Either disable IP blocking for the SMTP key used by
Gradely, or send through a static-egress proxy and authorize that address.
A local `verify()` from a developer machine will also fail with `525` unless
that machine's public IP is authorized.

The sender address does not need individual verification when the domain is
fully authenticated in Brevo. `no-reply@wisegrade.app` is valid only after
`wisegrade.app` authentication is complete.

## 4. Database migration

The transactional-email migration (`20261118120000_transactional_email`) is
already applied to production and was verified read-only: it is additive, its
checksum matches the local migration, and it changed no existing rows.

Do not run further production migrations without explicit owner approval.

For a future approved migration, use the direct/unpooled Neon URL. The
production profile already contains `DIRECT_DATABASE_URL`:

```powershell
$env:GRADELY_ENV_FILE='.env.production.local'
npm run prisma:migrate:deploy
Remove-Item Env:GRADELY_ENV_FILE
```

You can also export the direct URL explicitly:

```powershell
$env:DIRECT_DATABASE_URL="postgresql://...direct..."; npm run prisma:migrate:deploy
```

`prisma.config.ts` prefers `DIRECT_DATABASE_URL` and falls back to
`DATABASE_URL`. Migrations are never run automatically by the function, so a
cold start cannot mutate the schema.

Check state without changing anything:

```powershell
$env:GRADELY_ENV_FILE='.env.production.local'
npm run prisma:migrate:status
Remove-Item Env:GRADELY_ENV_FILE
```

## 5. Scheduler strategy

Vercel functions are short-lived and may run concurrently, so the existing
`setInterval` scheduler is only used by `src/index.ts` locally.

Production flow:

1. `vercel.json` registers a daily Cron at `0 1 * * *`.
2. Vercel calls `GET /api/internal/calendar` with
   `Authorization: Bearer $CRON_SECRET`.
3. The endpoint compares the token in constant time, then invokes the shared
   runner.
4. The runner acquires the `calendar-scheduler` row in `SchedulerLock` with one
   atomic `UPDATE` and a 15-minute lease. A duplicate or overlapping invocation
   returns `{ "executed": false, "reason": "LOCKED" }` and does no work.
5. Each completed or failed run writes an append-only `SchedulerRun` row with
   trigger `CRON`, preserving platform audit history.
6. Failed runs send the same `CALENDAR_SCHEDULER_FAILED` CRITICAL notification
   (deduplicated) as the local scheduler.
7. The lock is released in `finally`; an expired lease also frees the lock if a
   function crashes.

`CRON_SECRET` is mandatory in production when the scheduler is enabled. The API
refuses to start otherwise, and the endpoint returns 503 if it is missing at
runtime. This prevents silently disabling an important production job.

### Plan limits

- Hobby: Cron may run at most once per day (the included schedule). Keep
  `CALENDAR_SCHEDULER_INTERVAL_MINUTES=1440` so health reporting does not flag a
  false stale scheduler.
- Pro: change the Cron expression in `vercel.json` and the interval variable
  together. The endpoint is idempotent and lock-protected, so a more frequent
  schedule is safe.
- Any plan: an external worker can call the same endpoint:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<backend-origin>/api/internal/calendar
```

No permanent process is required. If a deployment deliberately disables the
scheduler, set `CALENDAR_SCHEDULER_ENABLED=false` and remove the Cron entry.

## 6. Deployment sequence

1. Set the Neon pooled URL and all production variables in the existing
   `gradely-backend` Vercel project (or create it if it has been removed).
2. Run the migration from section 4 against Neon only with owner approval.
3. Confirm the project uses repository `Wiseking895/Wise_Grade`, Root Directory
   `backend`, Framework Preset Other, and the latest `vercel.json`.
4. Deploy. The build runs `prisma generate` and `tsc`.
5. Open `https://wisegradebackend.vercel.app/api/health` and
   `https://wisegradebackend.vercel.app/api/ready`. `health` proves the function is running; `ready` proves Neon
   is reachable from the deployed function.
6. Verify CORS with a preflight from the frontend origin.
7. Verify both scheduler endpoints with the bearer token (expect a run summary or
   `executed: false, reason: LOCKED` for the calendar).
8. Run one platform-admin SMTP test after the Brevo sender is verified.
9. Read the backend URL and update the frontend (section 8).

## 7. Health verification

### Liveness

```bash
curl -i https://<backend-origin>/api/health
```

Expected: `200`, `"service":"gradely-api"`, `"database":"not_checked"`, and
`Cache-Control: no-store`. This endpoint intentionally does not open a database
connection, so it still answers during a Neon incident.

### Database readiness

```bash
curl -i https://<backend-origin>/api/ready
```

Expected when Neon is reachable with the configured pooled `DATABASE_URL`:
`200` and

```json
{
  "status": "ok",
  "service": "gradely-api",
  "database": "connected",
  "timestamp": "ISO_TIMESTAMP"
}
```

`/api/ready` performs one read-only `SELECT 1` through the shared Prisma client
and never reads or writes application tables. Expected when the database cannot
be reached: `503` and

```json
{
  "status": "error",
  "service": "gradely-api",
  "database": "unavailable",
  "timestamp": "ISO_TIMESTAMP"
}
```

Both responses set `Cache-Control: no-store`. The failure response is
deliberately generic: connection strings, hostnames, SQL text and Prisma error
messages stay in the server log. A `503` therefore means "check Neon reachability
and the production `DATABASE_URL`", not "the deployment failed".

Readiness is only proven by calling the deployed endpoint. Local tests inject the
probe, so a green local suite does not by itself confirm production Neon
connectivity.

Preflight:

```bash
curl -i -X OPTIONS https://<backend-origin>/api/auth/login \
  -H "Origin: https://wisegrade.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: `204`, `Access-Control-Allow-Origin: https://wisegrade.app`,
`Access-Control-Allow-Credentials: true`. No wildcard.

Scheduler (do not print the secret):

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<backend-origin>/api/internal/calendar
```

Expected: `200` with `data.executed` and, when it ran, a run summary.

Sign in through the frontend and confirm:

- The browser stores an `HttpOnly` cookie.
- Production cookies are `Secure` and `SameSite=None`, which cross-site
  credential auth requires.
- `/api/auth/me` returns the signed-in user.
- A mutating request succeeds only with the frontend `Origin`.
- Platform → Health shows scheduler history after the first Cron run.

## 8. Point the frontend at the backend

The production frontend is `https://wisegrade.app` and is built with
`VITE_API_URL=https://wisegradebackend.vercel.app`. To change or verify it:

1. Copy the backend production URL. Use the origin only, no trailing slash,
   no `/api`.
2. In the frontend Vercel project, open **Settings → Environment Variables** and
   set `VITE_API_URL` for **Production** (and each Preview that needs the API).
3. Redeploy the frontend. Vite inlines the value at build time, so an existing
   deployment will not pick it up.
4. Confirm the backend `CORS_ORIGINS`/`FRONTEND_URL` still contain the exact
   frontend origin. The current production origin is `https://wisegrade.app`;
   `https://www.wisegrade.app` is not allowed unless it is separately added.
5. Open `https://wisegrade.app`, sign in and load a DB-backed page.
6. If the frontend preview URL differs, add that exact origin to the backend
   preview `CORS_ORIGINS`; wildcards are rejected.

## 9. Known platform limits and risks

- **Request body size:** Vercel caps serverless request bodies at approximately
  4.5 MB. The API still accepts `8mb` JSON locally, but a pupil photo whose
  base64 payload exceeds the Vercel limit will be rejected with 413 before
  Express sees it. This is not changed here because the fix (smaller client
  compression or direct-to-R2 uploads) would alter upload behaviour. Plan a
  follow-up if large photos are required in production.
- **Function duration:** `vercel.json` allows 60 seconds. A very large calendar
  batch may approach that on Hobby. The lock lease is 15 minutes; a run that
  times out is recorded as failed on the next invocation and retried safely.
- **Database connections:** one pool per warm instance (`DATABASE_POOL_MAX=5`)
  plus Neon pooling. Serverless concurrency can still create many instances;
  monitor Neon connection metrics.
- **Cron time zone:** Vercel Cron schedules are UTC. `0 1 * * *` is 01:00 UTC.
  Calendar due-date logic itself uses Africa/Accra.
- **Storage:** report PDFs and branding are served only through authenticated
  routes. The R2 bucket must stay private.
- **Secrets:** this guide lists variable names only. Never commit `.env` files,
  paste secrets into the repository, or expose them through `VITE_` variables.
