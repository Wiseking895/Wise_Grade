-- Subject-teacher activation invitations.
--
-- Additive only: existing users, memberships, classes, subjects, assignments,
-- scores and reports are preserved. Invitations store only the SHA-256 hash of
-- the one-time activation code; the plaintext is never persisted.

ALTER TABLE "User" ADD COLUMN "phone" VARCHAR(32);

CREATE TABLE "SubjectTeacherInvitation" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdByMembershipId" UUID,
    "codeHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "reissuedFromId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectTeacherInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubjectTeacherInvitation_codeHash_key" ON "SubjectTeacherInvitation"("codeHash");
CREATE INDEX "SubjectTeacherInvitation_schoolId_membershipId_createdAt_idx" ON "SubjectTeacherInvitation"("schoolId", "membershipId", "createdAt");
CREATE INDEX "SubjectTeacherInvitation_classId_subjectId_createdAt_idx" ON "SubjectTeacherInvitation"("classId", "subjectId", "createdAt");
CREATE INDEX "SubjectTeacherInvitation_expiresAt_idx" ON "SubjectTeacherInvitation"("expiresAt");

ALTER TABLE "SubjectTeacherInvitation" ADD CONSTRAINT "SubjectTeacherInvitation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherInvitation" ADD CONSTRAINT "SubjectTeacherInvitation_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherInvitation" ADD CONSTRAINT "SubjectTeacherInvitation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherInvitation" ADD CONSTRAINT "SubjectTeacherInvitation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "SchoolMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherInvitation" ADD CONSTRAINT "SubjectTeacherInvitation_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubjectTeacherInvitation" ADD CONSTRAINT "SubjectTeacherInvitation_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "SubjectTeacherInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
