-- School branding and required contact details.
--
-- These columns are nullable so existing schools are preserved and can complete
-- their profile later. Report generation enforces completeness at the service
-- boundary instead of rewriting historical data.

ALTER TABLE "School"
  ADD COLUMN "landmark" VARCHAR(200),
  ADD COLUMN "logoObjectKey" VARCHAR(512),
  ADD COLUMN "logoMimeType" VARCHAR(64),
  ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);
