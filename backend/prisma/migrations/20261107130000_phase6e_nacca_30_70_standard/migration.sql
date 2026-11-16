-- Phase 6E: align the system-managed Gradely standard policy with the NaCCA
-- 30% school-based assessment / 70% examination structure.
--
-- Scope:
--   * Only policies flagged isDefault = true (the system standard) are changed.
--   * School-authored custom policies keep their own weights and grading.
--   * Accepted and historical results are never recalculated: this migration
--     does not read or write ResultSubmission, PupilSubjectScore or any stored
--     policy/grading snapshot.
--
-- After this migration an existing default policy has four SBA components at
-- 7.50% (together 30%) and one examination component at 70.00%. Reopened drafts
-- therefore calculate with 30/70, while accepted results keep the snapshots
-- recorded when they were accepted.

UPDATE "AssessmentPolicy"
SET
  "description" = 'Automatically provided NaCCA standard: Individual Test /15, Group Work /15, Class Test /15 and Project /15 form a Class Score /60 scaled to 30%; the Examination /100 is scaled to 70%.',
  "calculationMode" = 'GROUPED_SBA',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "isDefault" = true;

UPDATE "AssessmentComponent" AS component
SET "weightPercent" = CASE
  WHEN component."category" = 'EXAM' THEN 70.00
  WHEN component."category" = 'SBA' THEN 7.50
  ELSE component."weightPercent"
END
FROM "AssessmentPolicy" AS policy
WHERE
  component."policyId" = policy."id"
  AND policy."isDefault" = true;
