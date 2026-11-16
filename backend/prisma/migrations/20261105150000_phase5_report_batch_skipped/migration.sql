-- Phase 5: track idempotent generation runs that produced no new version
-- because the accepted result fingerprint and stored PDF were unchanged.
ALTER TABLE "ReportGenerationBatch"
ADD COLUMN "skippedCount" INTEGER NOT NULL DEFAULT 0;
