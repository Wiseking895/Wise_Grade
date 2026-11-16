-- Phase 6B: platform-controlled report approval and release.
-- Additive only. Existing report generation, billing and assessment records are
-- preserved; every existing batch starts in GENERATED and must be explicitly
-- submitted and released.

CREATE TYPE "ReportReleaseStatus" AS ENUM (
  'GENERATED',
  'PENDING_PLATFORM_REVIEW',
  'RETURNED',
  'APPROVED',
  'RELEASED',
  'ON_HOLD'
);

ALTER TABLE "ReportGenerationBatch"
  ADD COLUMN "releaseStatus" "ReportReleaseStatus" NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN "previousReleaseStatus" "ReportReleaseStatus",
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "submittedByMembershipId" UUID,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" UUID,
  ADD COLUMN "returnedReason" VARCHAR(1000),
  ADD COLUMN "holdReason" VARCHAR(1000),
  ADD COLUMN "heldAt" TIMESTAMP(3),
  ADD COLUMN "heldByUserId" UUID,
  ADD COLUMN "releasedAt" TIMESTAMP(3),
  ADD COLUMN "releasedByUserId" UUID;

ALTER TABLE "ReportGenerationBatch"
  ADD CONSTRAINT "ReportGenerationBatch_submittedByMembershipId_fkey"
    FOREIGN KEY ("submittedByMembershipId") REFERENCES "SchoolMembership"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportGenerationBatch_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportGenerationBatch_heldByUserId_fkey"
    FOREIGN KEY ("heldByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportGenerationBatch_releasedByUserId_fkey"
    FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- A returned batch must carry a reason, and a held batch must carry a reason.
-- A released batch must record who released it and when. These invariants are
-- enforced at the database boundary even if application code regresses.
ALTER TABLE "ReportGenerationBatch"
  ADD CONSTRAINT "ReportGenerationBatch_returned_reason_check"
    CHECK ("releaseStatus" <> 'RETURNED' OR "returnedReason" IS NOT NULL),
  ADD CONSTRAINT "ReportGenerationBatch_hold_reason_check"
    CHECK ("releaseStatus" <> 'ON_HOLD' OR "holdReason" IS NOT NULL),
  ADD CONSTRAINT "ReportGenerationBatch_released_audit_check"
    CHECK (
      "releaseStatus" <> 'RELEASED' OR
      ("releasedAt" IS NOT NULL AND "releasedByUserId" IS NOT NULL)
    );

CREATE INDEX "ReportGenerationBatch_schoolId_releaseStatus_idx"
  ON "ReportGenerationBatch"("schoolId", "releaseStatus");
CREATE INDEX "ReportGenerationBatch_releaseStatus_submittedAt_idx"
  ON "ReportGenerationBatch"("releaseStatus", "submittedAt");
CREATE INDEX "ReportGenerationBatch_submittedByMembershipId_idx"
  ON "ReportGenerationBatch"("submittedByMembershipId");
CREATE INDEX "ReportGenerationBatch_reviewedByUserId_idx"
  ON "ReportGenerationBatch"("reviewedByUserId");
CREATE INDEX "ReportGenerationBatch_heldByUserId_idx"
  ON "ReportGenerationBatch"("heldByUserId");
CREATE INDEX "ReportGenerationBatch_releasedByUserId_idx"
  ON "ReportGenerationBatch"("releasedByUserId");
