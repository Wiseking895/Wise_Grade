-- Additive Phase 6D migration for the automatic Gradely standard assessment
-- policy. Existing policies keep COMPONENT_WEIGHTED and are not backfilled or
-- recalculated; the standard policy is created lazily for a term that has no
-- active policy.

-- CreateEnum
CREATE TYPE "AssessmentCalculationMode" AS ENUM ('COMPONENT_WEIGHTED', 'GROUPED_SBA');

-- AlterTable
ALTER TABLE "AssessmentPolicy"
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "calculationMode" "AssessmentCalculationMode" NOT NULL DEFAULT 'COMPONENT_WEIGHTED';
