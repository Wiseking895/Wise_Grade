-- Centrally managed Wise Grade platform settings.
--
-- Additive and data-preserving: no existing table, row or historical record is
-- modified. Only allow-listed keys are written by the platform settings service.

CREATE TABLE "PlatformSetting" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PlatformSetting_updatedByUserId_idx"
    ON "PlatformSetting"("updatedByUserId");

ALTER TABLE "PlatformSetting"
    ADD CONSTRAINT "PlatformSetting_updatedByUserId_fkey"
    FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
