-- Transactional email, administrator email verification and forced first-login
-- password rotation.
--
-- Additive and data-preserving: every new User column has a default that keeps
-- the existing access behaviour for every current account. No row is rewritten
-- by this migration, and no historical audit or teacher record is modified.

-- 1. Per-user verification and password-rotation state.
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- 2. Single-use administrator verification tokens (hash only).
CREATE TABLE "EmailVerificationToken" (
  "id"        UUID         NOT NULL,
  "userId"    UUID         NOT NULL,
  "tokenHash" VARCHAR(64)  NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "ipAddress" VARCHAR(45),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
  ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_usedAt_idx"
  ON "EmailVerificationToken"("userId", "usedAt");
CREATE INDEX "EmailVerificationToken_expiresAt_idx"
  ON "EmailVerificationToken"("expiresAt");

ALTER TABLE "EmailVerificationToken"
  ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Durable transactional email outbox with per-event deduplication.
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "EmailOutbox" (
  "id"            UUID               NOT NULL,
  "dedupeKey"     VARCHAR(200)       NOT NULL,
  "recipient"     VARCHAR(320)       NOT NULL,
  "template"      VARCHAR(80)        NOT NULL,
  "payload"       JSONB              NOT NULL,
  "status"        "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER            NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" VARCHAR(80),
  "sentAt"        TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)       NOT NULL,

  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_dedupeKey_key"
  ON "EmailOutbox"("dedupeKey");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx"
  ON "EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_createdAt_idx"
  ON "EmailOutbox"("createdAt");
