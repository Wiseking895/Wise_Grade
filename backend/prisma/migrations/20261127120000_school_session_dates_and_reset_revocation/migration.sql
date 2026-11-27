-- School operational session boundaries + password-reset token revocation.
--
-- Adds two nullable date columns to School for the administrator-configured
-- reopening and closing dates (used by the School Session Settings page and by
-- subject-teacher access-code expiry), and a nullable `revokedAt` column to
-- PasswordResetToken so a superseded or completed reset link can be rejected
-- distinctly from an expired or already-used one.
--
-- Both changes are purely additive: no existing school, pupil, access-code,
-- audit or academic row is read, modified or deleted.

ALTER TABLE "School" ADD COLUMN "reopeningDate" DATE;
ALTER TABLE "School" ADD COLUMN "closingDate" DATE;

ALTER TABLE "PasswordResetToken" ADD COLUMN "revokedAt" TIMESTAMP(3);
