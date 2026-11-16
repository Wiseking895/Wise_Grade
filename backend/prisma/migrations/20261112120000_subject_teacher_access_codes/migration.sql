-- Subject-teacher access codes and restricted subject sessions.
--
-- Data-preserving: legacy subject-teacher assignments keep their membership
-- link and their identity is backfilled from the linked SchoolMembership/User.
-- New assignments store the teacher identity directly and never create a User,
-- Membership or password.

-- ---------------------------------------------------------------------------
-- SubjectTeacherAssignment: direct teacher identity
-- ---------------------------------------------------------------------------

ALTER TABLE "SubjectTeacherAssignment"
  ADD COLUMN "firstName" VARCHAR(80),
  ADD COLUMN "lastName" VARCHAR(80),
  ADD COLUMN "email" VARCHAR(320),
  ADD COLUMN "phone" VARCHAR(32);

UPDATE "SubjectTeacherAssignment" AS assignment
SET
  "firstName" = "user"."firstName",
  "lastName" = "user"."lastName",
  "email" = "user"."email",
  "phone" = "user"."phone"
FROM "SchoolMembership" AS membership
JOIN "User" AS "user" ON "user"."id" = membership."userId"
WHERE assignment."membershipId" = membership."id";

UPDATE "SubjectTeacherAssignment"
SET
  "firstName" = COALESCE("firstName", 'Unknown'),
  "lastName" = COALESCE("lastName", 'Teacher'),
  "email" = COALESCE("email", 'unknown-' || "id" || '@invalid.local')
WHERE "firstName" IS NULL OR "lastName" IS NULL OR "email" IS NULL;

ALTER TABLE "SubjectTeacherAssignment"
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "lastName" SET NOT NULL,
  ALTER COLUMN "email" SET NOT NULL,
  ALTER COLUMN "membershipId" DROP NOT NULL;

CREATE INDEX "SubjectTeacherAssignment_schoolId_email_endedAt_idx"
  ON "SubjectTeacherAssignment"("schoolId", "email", "endedAt");

-- ---------------------------------------------------------------------------
-- SubjectTeacherInvitation: reusable code bound to an assignment
-- ---------------------------------------------------------------------------

ALTER TABLE "SubjectTeacherInvitation"
  ADD COLUMN "assignmentId" UUID,
  ALTER COLUMN "membershipId" DROP NOT NULL;

-- Legacy codes are linked to the active assignment they were issued for.
UPDATE "SubjectTeacherInvitation" AS invitation
SET "assignmentId" = assignment."id"
FROM "SubjectTeacherAssignment" AS assignment
WHERE invitation."assignmentId" IS NULL
  AND invitation."membershipId" IS NOT NULL
  AND assignment."classId" = invitation."classId"
  AND assignment."subjectId" = invitation."subjectId"
  AND assignment."membershipId" = invitation."membershipId";

CREATE INDEX "SubjectTeacherInvitation_assignmentId_revokedAt_idx"
  ON "SubjectTeacherInvitation"("assignmentId", "revokedAt");

ALTER TABLE "SubjectTeacherInvitation"
  ADD CONSTRAINT "SubjectTeacherInvitation_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "SubjectTeacherAssignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Restricted subject-teacher sessions
-- ---------------------------------------------------------------------------

CREATE TABLE "SubjectTeacherSession" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "classId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "accessCodeId" UUID,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" VARCHAR(45),
  "userAgent" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubjectTeacherSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubjectTeacherSession_tokenHash_key"
  ON "SubjectTeacherSession"("tokenHash");
CREATE INDEX "SubjectTeacherSession_assignmentId_revokedAt_idx"
  ON "SubjectTeacherSession"("assignmentId", "revokedAt");
CREATE INDEX "SubjectTeacherSession_expiresAt_idx"
  ON "SubjectTeacherSession"("expiresAt");

ALTER TABLE "SubjectTeacherSession"
  ADD CONSTRAINT "SubjectTeacherSession_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherSession"
  ADD CONSTRAINT "SubjectTeacherSession_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherSession"
  ADD CONSTRAINT "SubjectTeacherSession_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherSession"
  ADD CONSTRAINT "SubjectTeacherSession_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "SubjectTeacherAssignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherSession"
  ADD CONSTRAINT "SubjectTeacherSession_accessCodeId_fkey"
  FOREIGN KEY ("accessCodeId") REFERENCES "SubjectTeacherInvitation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ResultSubmission: attribution for sessions without a membership
-- ---------------------------------------------------------------------------

ALTER TABLE "ResultSubmission"
  ADD COLUMN "createdByAssignmentId" UUID,
  ALTER COLUMN "createdByMembershipId" DROP NOT NULL;

CREATE INDEX "ResultSubmission_createdByAssignmentId_idx"
  ON "ResultSubmission"("createdByAssignmentId");

ALTER TABLE "ResultSubmission"
  ADD CONSTRAINT "ResultSubmission_createdByAssignmentId_fkey"
  FOREIGN KEY ("createdByAssignmentId") REFERENCES "SubjectTeacherAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
