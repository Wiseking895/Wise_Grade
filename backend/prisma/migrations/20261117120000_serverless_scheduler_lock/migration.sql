-- Serverless scheduler coordination.
--
-- Vercel runs the API as short-lived functions, so the long-running interval
-- scheduler cannot be used in production. The Cron endpoint must instead be
-- protected against overlapping and duplicated invocations. This single-row
-- lock is acquired with one atomic UPDATE and carries an expiring lease so a
-- crashed invocation cannot block future runs.
--
-- Additive only: no existing table, column, row or migration is modified.

CREATE TABLE "SchedulerLock" (
  "key"       VARCHAR(80)  NOT NULL,
  "lockedAt"  TIMESTAMP(3),
  "lockedBy"  VARCHAR(120),
  "expiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SchedulerLock_pkey" PRIMARY KEY ("key")
);

INSERT INTO "SchedulerLock" ("key", "updatedAt")
VALUES ('calendar-scheduler', NOW())
ON CONFLICT ("key") DO NOTHING;
