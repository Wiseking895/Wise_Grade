# Backup and Recovery

This document describes how Wise Grade data is stored, what backup protection is
currently configured, and the procedure to follow when data must be recovered.

> **Current status: backups are not configured or verified by this repository.**
> Nothing in the application schedules database backups, replicates object
> storage, or restores data. The platform's Data Exports screen produces
> on-demand CSV files for operational review; it is **not** a backup and cannot
> restore anything. Treat the recommendations below as production prerequisites,
> not as completed work.

## 1. What must be protected

| Data | Location | Why it matters |
| --- | --- | --- |
| Schools, users, memberships, sessions | PostgreSQL | Identity, tenant isolation and access control |
| Academic years, terms, classes, subjects, pupils | PostgreSQL | Historical academic structure |
| Assessment policies, scores and results | PostgreSQL | 60% SBA / 40% exam results and rankings |
| Report batches, versions and release state | PostgreSQL | Report-card history and family access |
| Invoices, pricing rules, payments, provider events | PostgreSQL | Financial settlement and per-pupil pricing snapshots |
| Audit trail | PostgreSQL | Append-only accountability |
| Platform notifications, scheduler runs, reauth grants | PostgreSQL | Operational history and security controls |
| Report PDFs, school logos, payment evidence | Private object storage (Cloudflare R2 in production) | Files referenced by database keys |
| `AUTH_SECRET`, database URL, R2 credentials, payment webhook secret | Secret manager / deployment environment | Encryption and provider verification |

Object storage keys are stored in PostgreSQL. A database restore without the
matching objects leaves report downloads and branding broken; an object restore
without the database leaves orphaned files. Back up both consistently.

## 2. What exists today

- PostgreSQL is the system of record and is accessed through Prisma.
- Migrations are additive and live in `backend/prisma/migrations`. They are
  applied with `prisma migrate deploy`, never with `prisma migrate reset`.
- Private object storage is abstracted behind `StorageAdapter`. Production
  requires all four R2 values and refuses to start without them; development and
  tests may use private local storage under `backend/.storage`.
- Audit records are append-only at the application level. No platform route
  edits or deletes audit entries, payments, invoices, results or released
  reports.
- Platform Health reports database, Prisma, migration, storage, scheduler and
  payment-provider status without exposing secrets and without destructive
  probes.
- Data Exports streams server-generated CSV files for schools, payments,
  invoices, audit events and notifications. Exports are authorized, audited and
  privacy-minimized, but they are **not** a backup or restore mechanism.

## 3. Exports are not backups

CSV exports deliberately differ from a backup:

- They are generated on demand, not on a schedule, so there is no guaranteed
  recovery point.
- They exclude secrets, evidence files, payer phone numbers, IP addresses and
  user agents.
- They are flat snapshots of selected columns, not a transactionally consistent
  copy of the database.
- They contain no object-storage files.
- There is no import or restore path in the application.

Do not promise a recovery point objective (RPO) or recovery time objective (RTO)
based on exports.

## 4. Recommended production configuration

The following must be configured and verified in the hosting environment before
the platform is described as production-ready.

### PostgreSQL

- Enable the managed provider's automated backups.
- Enable point-in-time recovery (continuous WAL archiving) where available.
- Encrypt backups at rest and in transit.
- Store at least one copy in a separate region or failure domain.
- Restrict restore access to the database and platform operators.
- Set a retention period that matches school, financial and audit obligations.
- Record the actual schedule, retention and restore-test dates in the
  deployment runbook.

### Object storage (R2)

- Enable object versioning or bucket replication for report PDFs and branding.
- Protect the bucket from public access; keep it private.
- Apply a lifecycle policy only after confirming it does not expire records that
  must be retained.
- Back up payment evidence with the same retention as the related payment.
- Verify that a sample of database object keys resolves to an object after a
  restore.

### Secrets and configuration

- Keep `AUTH_SECRET`, `DATABASE_URL`, R2 credentials, `PAYMENT_WEBHOOK_SECRET`
  and any provider keys in a secret manager, not in the repository.
- Back up secret-manager configuration under the same access controls as the
  database.
- Record which secret version encrypted MFA secrets. Rotating `AUTH_SECRET`
  without re-encrypting MFA secrets will make existing TOTP enrollments
  unreadable; plan a re-enrollment window.

### Monitoring

- Alert on failed database backups, missed schedules and storage replication
  errors.
- Alert on Platform Health `error` or prolonged `degraded` status.
- Alert on scheduler failure notifications and repeated login lockouts.

## 5. Recovery procedure

This is a documented procedure. It is not automated and has not been executed as
part of this change.

1. **Declare and contain.** Record the incident, the target recovery time and
   the decision-maker. Stop write traffic to the API (remove it from the load
   balancer or stop the process) so the restored database is not immediately
   overwritten.
2. **Preserve evidence.** Snapshot the current database and bucket before
   restoring, if they are still available. Do not delete the damaged copy until
   the incident review is complete.
3. **Restore PostgreSQL into an isolated instance.** Restore the chosen base
   backup and replay WAL to the target timestamp. Never restore directly over
   the only remaining copy.
4. **Validate the schema.** Confirm `_prisma_migrations` is present and that
   applied migrations match `backend/prisma/migrations`. Run
   `npx prisma migrate status` against the restored database. Do **not** run
   `prisma migrate reset`, which deletes data.
5. **Restore object storage.** Restore the matching bucket version or replica.
   Compare a sample of `logoObjectKey`, report PDF keys and payment evidence keys
   from the database with the restored objects.
6. **Rotate credentials if compromise is suspected.** Rotate database, R2 and
   payment-provider credentials. If `AUTH_SECRET` is rotated, plan MFA
   re-enrollment and invalidate existing sessions.
7. **Start the API with production configuration.** Confirm HTTPS origins,
   cookie settings, R2 credentials and payment webhook configuration.
8. **Verify health.** Open Platform Health as a platform administrator and
   confirm database, Prisma, migrations, storage, scheduler and payment-provider
   checks. Then run read-only smoke tests: sign in, open a school, open a
   released report, open an invoice and read the audit trail.
9. **Reconcile the gap.** Payments, notifications and scheduler runs created
   after the recovery point may be missing. Use the payment provider's records
   and the audit trail to reconcile. Record the data-loss window in the incident
   report.
10. **Resume traffic.** Only after validation, restore normal traffic and
    monitoring.

## 6. Restore drills

- Run a restore drill at least quarterly and before major migrations.
- Restore into an isolated environment, never over production.
- Verify row counts for schools, users, pupils, results, invoices, payments and
  audit events.
- Verify that a released report PDF and a school logo open through the
  authenticated backend.
- Record the drill date, backup age, restore duration and issues found.
- Update this document with the verified RPO/RTO only after a successful drill.

## 7. Explicit non-goals

- No browser-based restore button is provided.
- No CSV import is provided.
- No automatic deletion of historical records, payments, results or audit
  entries is provided.
- The application does not claim that backups exist until the hosting
  environment is configured and a restore has been verified.
