-- School administrator signatures and pupil profile photographs.
--
-- The image bytes live in private object storage. Only opaque storage keys and
-- descriptive metadata are persisted. All columns are nullable so existing
-- schools, pupils, report snapshots and versions are preserved unchanged.

ALTER TABLE "School"
  ADD COLUMN "signatureObjectKey" VARCHAR(512),
  ADD COLUMN "signatureMimeType" VARCHAR(64),
  ADD COLUMN "signatureUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "signatureName" VARCHAR(120),
  ADD COLUMN "signatureDesignation" VARCHAR(80);

ALTER TABLE "Pupil"
  ADD COLUMN "photoMimeType" VARCHAR(64),
  ADD COLUMN "photoChecksum" VARCHAR(64),
  ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
