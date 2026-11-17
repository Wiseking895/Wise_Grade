# Wise Grade Frontend

React, TypeScript, Vite, and Tailwind CSS client for Wise Grade.

Tagline: **Smarter Reports. Better Learning.**

The frontend covers Phases 1–6A: registration and sign-in, the school dashboard,
school management, assessment and result review, protected internal report card
screens, and per-pupil billing with school and platform billing dashboards.
Report approval and release to pupils or families remain out of scope until
Phase 6B.

## Requirements

- Node.js 20.19+ (Node.js 24 LTS recommended)
- npm 10+

## Scripts

Run these from `frontend/`:

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # TypeScript project build + production bundle
npm run lint       # ESLint
npm run typecheck  # TypeScript project check
npm test           # Node test runner checks
npm run preview    # Preview the production build
```

## Environment

Copy `.env.example` to `.env` for local development. `.env` is git-ignored.

| Variable       | Local default           | Exposure                   |
| -------------- | ----------------------- | -------------------------- |
| `VITE_API_URL` | `http://localhost:4000` | Public (bundled in client) |

`VITE_API_URL` is the backend origin only: scheme, host and optional port, with
no trailing slash and no `/api` path. It is inlined at build time, so a deployed
build must be created with the deployed API origin.

- Local development falls back to `http://localhost:4000` when the variable is
  absent.
- `npm run build` fails when `VITE_API_URL` is missing or malformed, and warns
  when it points at a local address.
- A production bundle refuses to call a loopback API URL and renders a
  configuration message instead, so a deployment can never silently talk to a
  developer machine.

On Vercel, set the variable in **Project → Settings → Environment Variables** for
the Production (and Preview) environments, then redeploy; environment variable
changes are only applied by a new build.

The temporary value `https://api-placeholder.gradely.invalid` must be replaced
with the real backend origin once `gradely-backend` is deployed. Update
`VITE_API_URL`, redeploy the frontend, and make sure the backend's
`CORS_ORIGINS`/`FRONTEND_URL` contain this exact frontend origin. See
[`../backend/docs/VERCEL_DEPLOYMENT.md`](../backend/docs/VERCEL_DEPLOYMENT.md)
for the full two-project sequence.

Only browser-safe values may use the `VITE_` prefix. Never put database
passwords, private API keys, storage secrets, payment secret keys, or webhook
secrets in a frontend environment file.

## Routes

| Path | Page | Access |
| ---- | ---- | ------ |
| `/` | Landing placeholder | Public |
| `/login` | Sign in | Public |
| `/register` | School registration | Public |
| `/dashboard` | School overview | Any ACTIVE school member |
| `/dashboard/school` | School profile | `SCHOOL_ADMIN` |
| `/dashboard/academics` | Redirects to the read-only calendar | Any ACTIVE school member |
| `/dashboard/calendar` | Academic calendar (read-only) | Any ACTIVE school member |
| `/dashboard/classes` | Classes | `CLASS_TEACHER` or `SUBJECT_TEACHER` |
| `/dashboard/pupils` | Pupils | `CLASS_TEACHER` |
| `/dashboard/teachers` | Teachers and class/subject assignment | `SCHOOL_ADMIN` |
| `/dashboard/assessments/scores` | Score entry | `CLASS_TEACHER` or `SUBJECT_TEACHER` |
| `/dashboard/assessments/submissions` | Submission tracking | `CLASS_TEACHER` or `SUBJECT_TEACHER` |
| `/dashboard/reports` | Released report cards | Any ACTIVE school member |
| `/dashboard/reports/cards/:cardId` | Private released PDF preview | Any ACTIVE school member |
| `/platform` | Redirects to platform reports | Platform administrator |
| `/platform/assessments` | Assessment review and setup | Platform administrator |
| `/platform/billing` | Platform pricing, invoices and payment review | Platform administrator |
| `/platform/reports` | Report generation, batches and release | Platform administrator |
| `/platform/reports/generate` | Report generation | Platform administrator |

All dashboard routes are protected. Anonymous users are redirected to `/login`
with the attempted path preserved. Pages that require administrator access also
show an in-page access-denied state, while the backend enforces the same rule.
Platform routes use a separate guard: a school administrator is redirected to
`/dashboard` and can never satisfy the platform check, because the API verifies
`isPlatformAdmin` independently of school membership. After sign-in, platform
administrators are sent to `/platform/billing`; school users go to `/dashboard`.

## Phase 4 assessment features

### Assessment setup

`AssessmentConfigPage` lets a school administrator:

- Choose the class-teacher entry mode: all class subjects or explicit grants.
- Create versioned assessment policies scoped to a term, level, or class.
- Define any number of SBA/exam components with maximum scores and weights.
- See the running weight total and load an editable 40/60 example.
- Grant or revoke explicit class-teacher subject permissions.

Weights must total exactly 100.00%, and every policy needs at least one SBA and
one exam component. These are school-owned settings, not a fixed national scale.

### Grading schemes

`GradingSchemesPage` manages year-wide or term-specific schemes. Bands must be
continuous from 0.00 to 100.00 with no gaps or overlaps. The editable example
bands are a starting point only. The server remains the validation authority;
the client mirrors the checks for immediate feedback.

### Score entry

`ScoreEntryPage` provides a spreadsheet-like whole-class grid:

- Blank cells mean **missing**, not zero; an explicit `0` is a real score.
- Paste tab-separated values from a spreadsheet into the grid.
- Enter and the up/down arrow keys move between pupil rows.
- Live previews show SBA, exam, final score, and grade band.
- Invalid or over-maximum values are highlighted inline.
- Drafts save explicitly, with unsaved-change warnings on reload or navigation.
- Submission is confirmed in a dialog and requires every pupil to be complete.
- Submitted sheets are read-only until a school administrator returns them.
- Server validation details are listed field by field when a save is rejected.
- A link from submission tracking opens the exact term, class, and subject.

### Submission tracking and review

`SubmissionsPage` lists drafts, submitted sheets, returned sheets, and accepted
results with status counts and filters. Teachers see only their authorized
class/subject pairs; administrators see the whole school.

`ResultReviewPage` gives administrators a queue of submitted sheets, a read-only
score sheet, and the accept/return actions. Returning requires a comment.
Review decisions and audit history are shown alongside the scores.

**Acceptance is internal academic review only.** It is not final report card
release, PDF generation, or payment. Accepted results become immutable, and the
UI states this boundary explicitly.

## Phase 5 internal report cards

The report screens are deliberately internal working tools:

- `ReportSettingsPage` configures per-term emblem, crest and signature assets,
  the signature label, ranking/aggregate policies, attendance requirement and
  closing/reopening dates. Uploaded images are private and never substituted
  with the Wise Grade logo.
- `ReportInputsPage` records only verified attendance, dates, teacher remarks and
  attitude notes. Empty fields stay empty; the UI does not fabricate content.
- `ReportGeneratePage` checks eligibility from accepted results and can generate
  one pupil, one class or all accessible classes in a term. Skipped pupils and
  failure reasons are shown explicitly.
- `ReportBatchesPage` lists generation history and per-pupil failures, and can
  retry failed pupils.
- `ReportCardPage` renders a protected, watermarked `INTERNAL DRAFT — NOT
  RELEASED` PDF preview and lists immutable versions. Stored PDF downloads are
  fetched through the authenticated backend and checksum-verified there.

Generation is not release. No public pupil or parent report route exists in this
phase.

## Phase 6A billing and payments

Billing is split into two deliberately separate surfaces.

### School billing dashboard

`BillingPage` at `/dashboard/billing` is available only to school
administrators and shows:

- Issued invoices for the active school with server-calculated totals and
  per-pupil line detail.
- The immutable pricing snapshot used for each invoice, so later price changes
  are visibly not applied retroactively.
- Manual payment submission with a reference, payment date and required private
  evidence (PNG, JPEG or PDF up to 2 MB).
- Online-payment initiation when the backend reports a configured provider. The
  included provider is a non-production mock; creating an attempt is not proof
  of payment and settlement still requires a signed webhook.
- Payment history with status, applied amount, retained overpayment and the
  verification decision, including rejection reasons.
- Authenticated evidence download through the backend; no public evidence URL is
  ever rendered.

The page states explicitly that payment verification updates billing only and
does not release report cards.

### Platform billing dashboard

`PlatformBillingPage` at `/platform/billing` is available only to platform
administrators and provides five tabs:

- **Overview** — billing totals, invoice status counts and pending-review count.
- **Pricing** — per-pupil GHS pricing version history, activation state and
  creation of the next effective version.
- **Invoices** — filterable platform-wide invoice list, invoice creation from
  school/year/term scopes, issue and cancel actions, and detail with lines,
  pupils and payments.
- **Payments** — pending manual payments with evidence, verified history, and
  verify/reject decisions. Rejection requires a reason.
- **Audit history** — append-only billing audit records with filters.

Amounts are entered in GHS and converted to integer minor units for the API. The
client never submits invoice totals; the backend remains the calculation
authority.

## Accessibility and responsive behaviour

- Forms use labelled inputs, inline error text, and `aria-invalid` where needed.
- Error and success banners use `role="alert"` or `role="status"`.
- Dialogs trap visual focus in a modal shell and close on Escape.
- Tables include captions and scoped headers; wide score grids scroll rather
  than squeeze columns.
- Controls remain usable on mobile, and the dashboard navigation uses a
  collapsible sidebar.
- Status labels pair colour with text so meaning does not depend on colour.

## Structure

```text
frontend/
├── src/
│   ├── assessment/     Phase 4 API client, types, calculation preview, helpers
│   ├── auth/           Session context, provider, hook, shared types
│   ├── billing/        Phase 6A billing API client, types and formatting helpers
│   ├── components/     Brand, dashboard/platform shells, modal/button primitives, guards
│   ├── images/         Temporary brand asset and favicon source
│   ├── lib/            API client and formatting helpers
│   ├── pages/          Public pages, dashboard pages and platform pages
│   ├── schools/        Active-school context and school API/types
│   ├── App.tsx         Router and application shell
│   ├── index.css       Tailwind import and brand theme tokens
│   └── main.tsx        React entry point
├── .env.example
├── index.html
├── eslint.config.js
├── vite.config.ts
└── tsconfig*.json
```

## Brand tokens

The design system is defined as Tailwind theme variables in `src/index.css`:

| Token             | Value     |
| ----------------- | --------- |
| `gradely-navy`    | `#174A9C` |
| `gradely-blue`    | `#0785EF` |
| `gradely-green`   | `#22B83D` |
| `gradely-gold`    | `#F5AA00` |
| `gradely-white`   | `#FFFFFF` |
| `gradely-light`   | `#F7F9FC` |
| `gradely-text`    | `#172033` |
| `gradely-muted`   | `#64748B` |

## Brand asset and favicon

`src/images/` contains one file: `wiseGrade.jpeg` (1254 × 1254 JPEG). Its
rendered wordmark reads **“Wise Grade”**, and it is used as the Wise Grade
product logo.

It is displayed unmodified (aspect ratio preserved, no recolouring or cropping)
as the only element in the navigation brand area. The surrounding text wordmark
and tagline were removed from the navigation so the logo stands alone; the
product name is exposed to assistive technology through the link's accessible
label. `index.html` also references it as the browser favicon.

## Authentication

- `AuthProvider` restores the session from `GET /api/auth/me` on load and keeps
  authentication state in React.
- `ProtectedRoute` redirects anonymous users to `/login` and preserves the
  attempted path.
- Login and school-registration pages perform client-side validation, map
  server field errors, and show loading and error states.
- The API is called with `credentials: 'include'`; the session cookie is
  HttpOnly and is never read by JavaScript.
- Logout revokes the server session and clears local state.
- The selected school is remembered locally; every API call still uses the
  server-resolved membership and cannot widen access.

## Scope

Implemented through Phase 6A:

- School registration, sign-in, session restore, and protected dashboard routes.
- School calendar, classes, pupils, subjects, teachers, and assignments.
- Assessment configuration, grading schemes, score entry, submission tracking,
  and administrator result review.
- Clear missing-vs-zero messaging, deterministic score previews, review
  confirmation, and explicit acceptance-boundary notices.
- Internal report card settings, inputs, generation batches, protected PDF
  previews, and immutable version history.
- School billing dashboard for invoices, manual evidence and payment status.
- Platform billing dashboard for pricing, invoice lifecycle, payment
  verification and audit history.

Not implemented in Phase 6A:

- Report approval, release to pupils or families, or parent-facing portals
  (Phase 6B).
- A live payment provider; only the non-production mock is supported.
- Automatic refunds or credit notes for overpayments.
- File storage administration, email invitations, or password-reset email
  delivery.
- A general platform-administrator console beyond billing.
