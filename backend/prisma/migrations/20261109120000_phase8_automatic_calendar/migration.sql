-- Automatic academic calendar lifecycle.
--
-- Academic years and terms are no longer managed manually by school
-- administrators. The lifecycle columns below are maintained by the calendar
-- service, while AcademicCalendarTransition keeps an append-only audit trail
-- so failed transitions can be diagnosed and retried safely.

CREATE TYPE "AcademicTermStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED');

ALTER TABLE "AcademicYear"
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "AcademicTerm"
  ADD COLUMN "status" "AcademicTermStatus" NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN "openedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "reportsPreparedAt" TIMESTAMP(3);

CREATE TABLE "AcademicCalendarTransition" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "academicYearId" UUID,
  "academicTermId" UUID,
  "action" VARCHAR(80) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "trigger" VARCHAR(24) NOT NULL DEFAULT 'SCHEDULER',
  "scheduledFor" DATE,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "message" VARCHAR(1000),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AcademicCalendarTransition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AcademicYear_schoolId_isArchived_idx"
  ON "AcademicYear"("schoolId", "isArchived");
CREATE INDEX "AcademicTerm_schoolId_status_idx"
  ON "AcademicTerm"("schoolId", "status");
CREATE INDEX "AcademicCalendarTransition_schoolId_createdAt_idx"
  ON "AcademicCalendarTransition"("schoolId", "createdAt");
CREATE INDEX "AcademicCalendarTransition_schoolId_status_idx"
  ON "AcademicCalendarTransition"("schoolId", "status");
CREATE INDEX "AcademicCalendarTransition_academicTermId_idx"
  ON "AcademicCalendarTransition"("academicTermId");

ALTER TABLE "AcademicCalendarTransition"
  ADD CONSTRAINT "AcademicCalendarTransition_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademicCalendarTransition"
  ADD CONSTRAINT "AcademicCalendarTransition_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AcademicCalendarTransition"
  ADD CONSTRAINT "AcademicCalendarTransition_academicTermId_fkey"
  FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing rows keep their history. The current term becomes OPEN, completed
-- terms become CLOSED, and past years are archived rather than deleted.
UPDATE "AcademicTerm"
SET
  "status" = 'OPEN',
  "openedAt" = COALESCE("openedAt", "startsOn"::timestamp)
WHERE "isCurrent" = true;

UPDATE "AcademicTerm"
SET
  "status" = 'CLOSED',
  "openedAt" = COALESCE("openedAt", "startsOn"::timestamp),
  "closedAt" = COALESCE("closedAt", "endsOn"::timestamp)
WHERE "isCurrent" = false
  AND "endsOn" < CURRENT_DATE;

UPDATE "AcademicYear"
SET
  "isArchived" = true,
  "archivedAt" = COALESCE("archivedAt", "endsOn"::timestamp)
WHERE "isCurrent" = false
  AND "endsOn" < CURRENT_DATE;
