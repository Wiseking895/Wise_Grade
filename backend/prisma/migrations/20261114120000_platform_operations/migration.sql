-- Phase 2 platform operations: notifications, scheduler history, optional MFA,
-- persistent login lockout, reauthentication grants and reconciliation
-- acknowledgement.
--
-- Additive and data-preserving: every new column is nullable or has a default,
-- so existing schools, users, sessions, payments, invoices, reports and audit
-- rows are untouched.

-- ---------------------------------------------------------------------------
-- User: optional MFA, persistent brute-force state and new relations.
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
    ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mfaSecret" VARCHAR(512),
    ADD COLUMN "mfaPendingSecret" VARCHAR(512),
    ADD COLUMN "mfaRecoveryCodes" JSONB,
    ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
    ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3),
    ADD COLUMN "lockedUntil" TIMESTAMP(3);

CREATE INDEX "User_lockedUntil_idx" ON "User"("lockedUntil");

-- ---------------------------------------------------------------------------
-- Payment: reconciliation acknowledgement (never rewrites settlement state).
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment"
    ADD COLUMN "reconciledAt" TIMESTAMP(3),
    ADD COLUMN "reconciledByUserId" UUID,
    ADD COLUMN "reconciliationNote" VARCHAR(1000);

CREATE INDEX "Payment_reconciledAt_idx" ON "Payment"("reconciledAt");
CREATE INDEX "Payment_reconciledByUserId_idx" ON "Payment"("reconciledByUserId");

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_reconciledByUserId_fkey"
    FOREIGN KEY ("reconciledByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PlatformNotification
-- ---------------------------------------------------------------------------

CREATE TABLE "PlatformNotification" (
    "id" UUID NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "severity" VARCHAR(16) NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000),
    "schoolId" UUID,
    "entityType" VARCHAR(80),
    "entityId" VARCHAR(80),
    "link" VARCHAR(512),
    "dedupeKey" VARCHAR(200),
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "readByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformNotification_dedupeKey_key"
    ON "PlatformNotification"("dedupeKey");
CREATE INDEX "PlatformNotification_readAt_createdAt_idx"
    ON "PlatformNotification"("readAt", "createdAt");
CREATE INDEX "PlatformNotification_schoolId_createdAt_idx"
    ON "PlatformNotification"("schoolId", "createdAt");
CREATE INDEX "PlatformNotification_type_createdAt_idx"
    ON "PlatformNotification"("type", "createdAt");
CREATE INDEX "PlatformNotification_severity_createdAt_idx"
    ON "PlatformNotification"("severity", "createdAt");

ALTER TABLE "PlatformNotification"
    ADD CONSTRAINT "PlatformNotification_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformNotification"
    ADD CONSTRAINT "PlatformNotification_readByUserId_fkey"
    FOREIGN KEY ("readByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- SchedulerRun
-- ---------------------------------------------------------------------------

CREATE TABLE "SchedulerRun" (
    "id" UUID NOT NULL,
    "trigger" VARCHAR(24) NOT NULL DEFAULT 'SCHEDULER',
    "status" VARCHAR(24) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "schoolCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "message" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulerRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SchedulerRun_createdAt_idx" ON "SchedulerRun"("createdAt");
CREATE INDEX "SchedulerRun_status_createdAt_idx"
    ON "SchedulerRun"("status", "createdAt");

-- ---------------------------------------------------------------------------
-- PlatformReauthGrant
-- ---------------------------------------------------------------------------

CREATE TABLE "PlatformReauthGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReauthGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformReauthGrant_tokenHash_key"
    ON "PlatformReauthGrant"("tokenHash");
CREATE INDEX "PlatformReauthGrant_userId_purpose_expiresAt_idx"
    ON "PlatformReauthGrant"("userId", "purpose", "expiresAt");
CREATE INDEX "PlatformReauthGrant_expiresAt_idx"
    ON "PlatformReauthGrant"("expiresAt");

ALTER TABLE "PlatformReauthGrant"
    ADD CONSTRAINT "PlatformReauthGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
