-- Platform Super Admin account archive (soft delete) and immutable history.
--
-- Accounts are never physically removed. `User.deletedAt` marks an archived
-- account; `DeletedAccount` stores the identity, role, school association,
-- deletion reason and acting administrator at the moment of deletion. The
-- history row survives account state changes and is only ever updated to
-- record a restoration. No academic, assessment, report, audit or school row
-- is deleted by this migration.

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "DeletedAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(32),
    "role" VARCHAR(40) NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "schoolId" UUID,
    "schoolName" VARCHAR(160),
    "memberships" JSONB,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedByUserId" UUID,
    "deletedByName" VARCHAR(160),
    "deletedByEmail" VARCHAR(320),
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ARCHIVED',
    "restoredAt" TIMESTAMP(3),
    "restoredByUserId" UUID,
    "restoredByName" VARCHAR(160),
    "restoredByEmail" VARCHAR(320),
    "restoreReason" VARCHAR(500),

    CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeletedAccount_userId_status_idx" ON "DeletedAccount"("userId", "status");
CREATE INDEX "DeletedAccount_deletedAt_idx" ON "DeletedAccount"("deletedAt");
CREATE INDEX "DeletedAccount_status_idx" ON "DeletedAccount"("status");
CREATE INDEX "DeletedAccount_schoolId_idx" ON "DeletedAccount"("schoolId");
CREATE INDEX "DeletedAccount_email_idx" ON "DeletedAccount"("email");
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- RESTRICT: an account with archive history can never be physically deleted,
-- which guarantees the historical record cannot disappear through a cascade.
ALTER TABLE "DeletedAccount"
    ADD CONSTRAINT "DeletedAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
