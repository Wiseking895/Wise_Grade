-- CreateEnum
CREATE TYPE "AssessmentComponentCategory" AS ENUM ('SBA', 'EXAM');

-- CreateEnum
CREATE TYPE "ClassTeacherEntryMode" AS ENUM ('ALL_CLASS_SUBJECTS', 'EXPLICIT_ONLY');

-- CreateEnum
CREATE TYPE "ResultSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED_FOR_CORRECTION', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ResultReviewDecision" AS ENUM ('ACCEPTED', 'RETURNED_FOR_CORRECTION');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "classTeacherEntryMode" "ClassTeacherEntryMode" NOT NULL DEFAULT 'EXPLICIT_ONLY';

-- CreateTable
CREATE TABLE "AssessmentPolicy" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID,
    "level" VARCHAR(40),
    "gradingSchemeId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(400),
    "scopeKey" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentComponent" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "AssessmentComponentCategory" NOT NULL,
    "maximumScore" DECIMAL(6,2) NOT NULL,
    "weightPercent" DECIMAL(6,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingScheme" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(400),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "gradingSchemeId" UUID NOT NULL,
    "minScore" DECIMAL(5,2) NOT NULL,
    "maxScore" DECIMAL(5,2) NOT NULL,
    "gradeLabel" VARCHAR(16) NOT NULL,
    "remark" VARCHAR(160) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PupilSubjectScore" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "pupilId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "policyId" UUID,
    "gradingSchemeId" UUID,
    "resultSubmissionId" UUID,
    "sbaContribution" DECIMAL(5,2),
    "examContribution" DECIMAL(5,2),
    "finalScore" DECIMAL(5,2),
    "gradeLabel" VARCHAR(16),
    "gradeRemark" VARCHAR(160),
    "policySnapshot" JSONB,
    "gradingSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PupilSubjectScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentScore" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "pupilSubjectScoreId" UUID NOT NULL,
    "componentId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "pupilId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultSubmission" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "policyId" UUID,
    "gradingSchemeId" UUID,
    "status" "ResultSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdByMembershipId" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewerMembershipId" UUID,
    "lastComment" VARCHAR(1000),
    "policySnapshot" JSONB,
    "gradingSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultReview" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "resultSubmissionId" UUID NOT NULL,
    "reviewerMembershipId" UUID NOT NULL,
    "decision" "ResultReviewDecision" NOT NULL,
    "fromStatus" "ResultSubmissionStatus" NOT NULL,
    "toStatus" "ResultSubmissionStatus" NOT NULL,
    "comment" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultAuditHistory" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "resultSubmissionId" UUID,
    "actorUserId" UUID,
    "actorMembershipId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(80),
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultAuditHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTeacherSubjectPermission" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassTeacherSubjectPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentPolicy_schoolId_academicYearId_academicTermId_isA_idx" ON "AssessmentPolicy"("schoolId", "academicYearId", "academicTermId", "isActive");

-- CreateIndex
CREATE INDEX "AssessmentPolicy_schoolId_classId_idx" ON "AssessmentPolicy"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "AssessmentPolicy_gradingSchemeId_idx" ON "AssessmentPolicy"("gradingSchemeId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentPolicy_schoolId_academicTermId_scopeKey_key" ON "AssessmentPolicy"("schoolId", "academicTermId", "scopeKey");

-- CreateIndex
CREATE INDEX "AssessmentComponent_schoolId_policyId_sortOrder_idx" ON "AssessmentComponent"("schoolId", "policyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentComponent_policyId_key_key" ON "AssessmentComponent"("policyId", "key");

-- CreateIndex
CREATE INDEX "GradingScheme_schoolId_academicYearId_academicTermId_isActi_idx" ON "GradingScheme"("schoolId", "academicYearId", "academicTermId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GradingScheme_schoolId_academicYearId_name_key" ON "GradingScheme"("schoolId", "academicYearId", "name");

-- CreateIndex
CREATE INDEX "GradeBand_schoolId_gradingSchemeId_idx" ON "GradeBand"("schoolId", "gradingSchemeId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_gradingSchemeId_sortOrder_key" ON "GradeBand"("gradingSchemeId", "sortOrder");

-- CreateIndex
CREATE INDEX "PupilSubjectScore_schoolId_academicTermId_classId_subjectId_idx" ON "PupilSubjectScore"("schoolId", "academicTermId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "PupilSubjectScore_schoolId_pupilId_idx" ON "PupilSubjectScore"("schoolId", "pupilId");

-- CreateIndex
CREATE INDEX "PupilSubjectScore_resultSubmissionId_idx" ON "PupilSubjectScore"("resultSubmissionId");

-- CreateIndex
CREATE INDEX "PupilSubjectScore_policyId_idx" ON "PupilSubjectScore"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PupilSubjectScore_schoolId_academicTermId_pupilId_subjectId_key" ON "PupilSubjectScore"("schoolId", "academicTermId", "pupilId", "subjectId");

-- CreateIndex
CREATE INDEX "AssessmentScore_schoolId_academicTermId_classId_subjectId_idx" ON "AssessmentScore"("schoolId", "academicTermId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "AssessmentScore_componentId_idx" ON "AssessmentScore"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentScore_pupilSubjectScoreId_componentId_key" ON "AssessmentScore"("pupilSubjectScoreId", "componentId");

-- CreateIndex
CREATE INDEX "ResultSubmission_schoolId_academicTermId_status_idx" ON "ResultSubmission"("schoolId", "academicTermId", "status");

-- CreateIndex
CREATE INDEX "ResultSubmission_schoolId_classId_subjectId_idx" ON "ResultSubmission"("schoolId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "ResultSubmission_reviewerMembershipId_idx" ON "ResultSubmission"("reviewerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultSubmission_schoolId_academicTermId_classId_subjectId_key" ON "ResultSubmission"("schoolId", "academicTermId", "classId", "subjectId");

-- CreateIndex
CREATE INDEX "ResultReview_schoolId_resultSubmissionId_createdAt_idx" ON "ResultReview"("schoolId", "resultSubmissionId", "createdAt");

-- CreateIndex
CREATE INDEX "ResultReview_reviewerMembershipId_idx" ON "ResultReview"("reviewerMembershipId");

-- CreateIndex
CREATE INDEX "ResultAuditHistory_schoolId_createdAt_idx" ON "ResultAuditHistory"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "ResultAuditHistory_resultSubmissionId_createdAt_idx" ON "ResultAuditHistory"("resultSubmissionId", "createdAt");

-- CreateIndex
CREATE INDEX "ResultAuditHistory_actorUserId_createdAt_idx" ON "ResultAuditHistory"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ResultAuditHistory_action_createdAt_idx" ON "ResultAuditHistory"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ClassTeacherSubjectPermission_schoolId_membershipId_idx" ON "ClassTeacherSubjectPermission"("schoolId", "membershipId");

-- CreateIndex
CREATE INDEX "ClassTeacherSubjectPermission_schoolId_classId_subjectId_idx" ON "ClassTeacherSubjectPermission"("schoolId", "classId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTeacherSubjectPermission_classId_subjectId_membershipI_key" ON "ClassTeacherSubjectPermission"("classId", "subjectId", "membershipId");

-- AddForeignKey
ALTER TABLE "AssessmentPolicy" ADD CONSTRAINT "AssessmentPolicy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPolicy" ADD CONSTRAINT "AssessmentPolicy_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPolicy" ADD CONSTRAINT "AssessmentPolicy_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPolicy" ADD CONSTRAINT "AssessmentPolicy_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPolicy" ADD CONSTRAINT "AssessmentPolicy_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AssessmentPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingScheme" ADD CONSTRAINT "GradingScheme_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingScheme" ADD CONSTRAINT "GradingScheme_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingScheme" ADD CONSTRAINT "GradingScheme_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeBand" ADD CONSTRAINT "GradeBand_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AssessmentPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilSubjectScore" ADD CONSTRAINT "PupilSubjectScore_resultSubmissionId_fkey" FOREIGN KEY ("resultSubmissionId") REFERENCES "ResultSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_pupilSubjectScoreId_fkey" FOREIGN KEY ("pupilSubjectScoreId") REFERENCES "PupilSubjectScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentScore" ADD CONSTRAINT "AssessmentScore_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "AssessmentComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AssessmentPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultSubmission" ADD CONSTRAINT "ResultSubmission_reviewerMembershipId_fkey" FOREIGN KEY ("reviewerMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultReview" ADD CONSTRAINT "ResultReview_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultReview" ADD CONSTRAINT "ResultReview_resultSubmissionId_fkey" FOREIGN KEY ("resultSubmissionId") REFERENCES "ResultSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultReview" ADD CONSTRAINT "ResultReview_reviewerMembershipId_fkey" FOREIGN KEY ("reviewerMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAuditHistory" ADD CONSTRAINT "ResultAuditHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAuditHistory" ADD CONSTRAINT "ResultAuditHistory_resultSubmissionId_fkey" FOREIGN KEY ("resultSubmissionId") REFERENCES "ResultSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAuditHistory" ADD CONSTRAINT "ResultAuditHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAuditHistory" ADD CONSTRAINT "ResultAuditHistory_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherSubjectPermission" ADD CONSTRAINT "ClassTeacherSubjectPermission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherSubjectPermission" ADD CONSTRAINT "ClassTeacherSubjectPermission_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherSubjectPermission" ADD CONSTRAINT "ClassTeacherSubjectPermission_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherSubjectPermission" ADD CONSTRAINT "ClassTeacherSubjectPermission_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "SchoolMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
