-- Phase 2: centrally managed academic calendar configuration.
--
-- The three milestone dates were previously derived from AcademicTerm.endsOn.
-- Storing them explicitly lets a Platform Super Admin correct a deadline or an
-- examination window without silently moving the other values.
--
-- Every existing row is backfilled with exactly the values the running system
-- already produced (assessment = close - 21 days, examination = close - 14 days
-- to close), so no effective date changes. Existing terms are marked confirmed
-- because their dates were already in force.

ALTER TABLE "AcademicTerm"
  ADD COLUMN "assessmentDeadline" DATE,
  ADD COLUMN "examinationStartsOn" DATE,
  ADD COLUMN "examinationEndsOn" DATE,
  ADD COLUMN "datesConfirmedAt" TIMESTAMP(3);

UPDATE "AcademicTerm"
SET
  "assessmentDeadline" = ("endsOn" - 21),
  "examinationStartsOn" = ("endsOn" - 14),
  "examinationEndsOn" = "endsOn",
  "datesConfirmedAt" = COALESCE("openedAt", "closedAt", "updatedAt");

CREATE INDEX "AcademicTerm_schoolId_datesConfirmedAt_idx"
  ON "AcademicTerm"("schoolId", "datesConfirmedAt");
