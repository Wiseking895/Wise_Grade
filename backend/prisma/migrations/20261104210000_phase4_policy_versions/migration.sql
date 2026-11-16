-- Phase 4 follow-up: keep a version history for assessment policies so a
-- school can replace a policy after results exist without mutating the policy
-- referenced by historical submissions.
ALTER TABLE "AssessmentPolicy" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "AssessmentPolicy_schoolId_academicTermId_scopeKey_key";

CREATE UNIQUE INDEX "AssessmentPolicy_schoolId_academicTermId_scopeKey_version_key"
  ON "AssessmentPolicy"("schoolId", "academicTermId", "scopeKey", "version");
