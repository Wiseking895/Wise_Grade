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
| `CORS_ORIGINS` | `https://frontend-esf6.vercel.app` (exact origin, no wildcard) |
| `FRONTEND_URL` | `https://frontend-esf6.vercel.app`. Required: without it the schema falls back to `http://localhost:5173`, which production validation rejects, so the API fails to boot. |
| `CRON_SECRET` | Random value, at least 16 characters |
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

## 4. Database migration

The new migration adds only a `SchedulerLock` table and one seeded row. It does
not modify existing tables or data.

Run from `backend/` against Neon **before** the first production deployment (or
immediately after, before relying on the scheduler):

```bash
# Use the direct/unpooled Neon URL for migrations
$env:DIRECT_DATABASE_URL="postgresql://...direct..."; npm run prisma:migrate:deploy
```

PowerShell equivalent is shown. On macOS/Linux:

```bash
DIRECT_DATABASE_URL="postgresql://...direct..." npm run prisma:migrate:deploy
```

`prisma.config.ts` prefers `DIRECT_DATABASE_URL` and falls back to
`DATABASE_URL`. Migrations are never run automatically by the function, so a
cold start cannot mutate the schema.

Check state without changing anything:

```bash
npm run prisma:migrate:status
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
2. Run the migration from section 4 against Neon.
3. Confirm the project uses repository `Wiseking895/Wise_Grade`, Root Directory
   `backend`, Framework Preset Other, and the latest `vercel.json`.
4. Deploy. The build runs `prisma generate` and `tsc`.
5. Open `https://gradely-backend.vercel.app/api/health` (or the project's
   current production URL).
6. Verify CORS with a preflight from the frontend origin.
7. Verify the scheduler endpoint with the bearer token (expect a run summary or
   `executed: false, reason: LOCKED` if another run is active).
8. Read the backend URL and update the frontend (section 8).

## 7. Health verification

```bash
curl -i https://<backend-origin>/api/health
```

Expected: `200`, `"service":"gradely-api"`, `"database":"not_checked"`. This
endpoint intentionally does not open a database connection, so it still answers
during a Neon incident.

Preflight:

```bash
curl -i -X OPTIONS https://<backend-origin>/api/auth/login \
  -H "Origin: https://frontend-esf6.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: `204`, `Access-Control-Allow-Origin: https://frontend-esf6.vercel.app`,
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

The frontend currently uses the temporary value
`https://api-placeholder.gradely.invalid`. After the backend is deployed:

1. Copy the backend production URL, for example
   `https://gradely-backend.vercel.app`. Use the origin only, no trailing slash,
   no `/api`.
2. In the frontend Vercel project, open **Settings → Environment Variables** and
   set `VITE_API_URL` for **Production** and **Preview**.
3. Redeploy the frontend. Vite inlines the value at build time, so an existing
   deployment will not pick it up.
4. Confirm the backend `CORS_ORIGINS`/`FRONTEND_URL` still contain the exact
   frontend origin.
5. Open `https://frontend-esf6.vercel.app`, sign in and load a DB-backed page.
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
