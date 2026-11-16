-- Phase 5: report card settings, authorized draft inputs, generation batches,
-- immutable report versions and private branding assets.

-- AlterTable: preserve the school's configured subject order on class subjects.
ALTER TABLE "ClassSubject" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "ReportAssetKind" AS ENUM ('EMBLEM', 'CREST', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "ReportTiePolicy" AS ENUM ('COMPETITION', 'DENSE', 'ORDINAL');

-- CreateEnum
CREATE TYPE "ReportAggregatePolicy" AS ENUM ('NONE', 'SUM_ALL_SUBJECTS', 'BEST_SIX_TOTAL', 'BEST_SIX_AVERAGE');

-- CreateEnum
CREATE TYPE "ReportGenerationScope" AS ENUM ('INDIVIDUAL', 'CLASS', 'TERM');

-- CreateEnum
CREATE TYPE "ReportBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_FAILURES', 'FAILED');

-- CreateTable
CREATE TABLE "ReportSettings" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "emblemObjectKey" VARCHAR(512),
    "crestObjectKey" VARCHAR(512),
    "signatureObjectKey" VARCHAR(512),
    "headteacherLabel" VARCHAR(80) NOT NULL DEFAULT 'HEADMASTER''S SIGNATURE',
    "rankingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tiePolicy" "ReportTiePolicy" NOT NULL DEFAULT 'COMPETITION',
    "aggregatePolicy" "ReportAggregatePolicy" NOT NULL DEFAULT 'NONE',
    "attendanceRequired" BOOLEAN NOT NULL DEFAULT true,
    "closingDate" DATE,
    "reopeningDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAsset" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "kind" "ReportAssetKind" NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(80) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "uploadedByMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportInput" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "pupilId" UUID NOT NULL,
    "daysOpened" INTEGER,
    "daysAttended" INTEGER,
    "teacherRemarks" VARCHAR(1000),
    "attitude" VARCHAR(400),
    "closingDate" DATE,
    "reopeningDate" DATE,
    "updatedByMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportGenerationBatch" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID,
    "scope" "ReportGenerationScope" NOT NULL,
    "status" "ReportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByMembershipId" UUID,
    "requestedPupilCount" INTEGER NOT NULL DEFAULT 0,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "fatalError" VARCHAR(1000),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportGenerationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCard" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "pupilId" UUID NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCardVersion" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "reportCardId" UUID NOT NULL,
    "batchId" UUID,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "generatedByMembershipId" UUID,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportGenerationFailure" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "academicTermId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "pupilId" UUID,
    "code" VARCHAR(80) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportGenerationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSettings_schoolId_academicTermId_key" ON "ReportSettings"("schoolId", "academicTermId");

-- CreateIndex
CREATE INDEX "ReportSettings_schoolId_academicYearId_academicTermId_idx" ON "ReportSettings"("schoolId", "academicYearId", "academicTermId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportAsset_storageKey_key" ON "ReportAsset"("storageKey");

-- CreateIndex
CREATE INDEX "ReportAsset_schoolId_kind_createdAt_idx" ON "ReportAsset"("schoolId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ReportAsset_uploadedByMembershipId_idx" ON "ReportAsset"("uploadedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportInput_schoolId_academicTermId_pupilId_key" ON "ReportInput"("schoolId", "academicTermId", "pupilId");

-- CreateIndex
CREATE INDEX "ReportInput_schoolId_academicTermId_classId_idx" ON "ReportInput"("schoolId", "academicTermId", "classId");

-- CreateIndex
CREATE INDEX "ReportInput_updatedByMembershipId_idx" ON "ReportInput"("updatedByMembershipId");

-- CreateIndex
CREATE INDEX "ReportGenerationBatch_schoolId_academicTermId_createdAt_idx" ON "ReportGenerationBatch"("schoolId", "academicTermId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportGenerationBatch_schoolId_status_idx" ON "ReportGenerationBatch"("schoolId", "status");

-- CreateIndex
CREATE INDEX "ReportGenerationBatch_requestedByMembershipId_idx" ON "ReportGenerationBatch"("requestedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCard_schoolId_academicTermId_pupilId_key" ON "ReportCard"("schoolId", "academicTermId", "pupilId");

-- CreateIndex
CREATE INDEX "ReportCard_schoolId_academicTermId_classId_idx" ON "ReportCard"("schoolId", "academicTermId", "classId");

-- CreateIndex
CREATE INDEX "ReportCard_createdByMembershipId_idx" ON "ReportCard"("createdByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardVersion_reportCardId_version_key" ON "ReportCardVersion"("reportCardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCardVersion_storageKey_key" ON "ReportCardVersion"("storageKey");

-- CreateIndex
CREATE INDEX "ReportCardVersion_schoolId_reportCardId_version_idx" ON "ReportCardVersion"("schoolId", "reportCardId", "version");

-- CreateIndex
CREATE INDEX "ReportCardVersion_batchId_idx" ON "ReportCardVersion"("batchId");

-- CreateIndex
CREATE INDEX "ReportCardVersion_generatedByMembershipId_idx" ON "ReportCardVersion"("generatedByMembershipId");

-- CreateIndex
CREATE INDEX "ReportGenerationFailure_schoolId_batchId_idx" ON "ReportGenerationFailure"("schoolId", "batchId");

-- CreateIndex
CREATE INDEX "ReportGenerationFailure_batchId_pupilId_idx" ON "ReportGenerationFailure"("batchId", "pupilId");

-- AddForeignKey
ALTER TABLE "ReportSettings" ADD CONSTRAINT "ReportSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSettings" ADD CONSTRAINT "ReportSettings_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSettings" ADD CONSTRAINT "ReportSettings_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAsset" ADD CONSTRAINT "ReportAsset_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAsset" ADD CONSTRAINT "ReportAsset_uploadedByMembershipId_fkey" FOREIGN KEY ("uploadedByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportInput" ADD CONSTRAINT "ReportInput_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportInput" ADD CONSTRAINT "ReportInput_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportInput" ADD CONSTRAINT "ReportInput_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportInput" ADD CONSTRAINT "ReportInput_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportInput" ADD CONSTRAINT "ReportInput_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportInput" ADD CONSTRAINT "ReportInput_updatedByMembershipId_fkey" FOREIGN KEY ("updatedByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationBatch" ADD CONSTRAINT "ReportGenerationBatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationBatch" ADD CONSTRAINT "ReportGenerationBatch_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationBatch" ADD CONSTRAINT "ReportGenerationBatch_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationBatch" ADD CONSTRAINT "ReportGenerationBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationBatch" ADD CONSTRAINT "ReportGenerationBatch_requestedByMembershipId_fkey" FOREIGN KEY ("requestedByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCard" ADD CONSTRAINT "ReportCard_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardVersion" ADD CONSTRAINT "ReportCardVersion_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardVersion" ADD CONSTRAINT "ReportCardVersion_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "ReportCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardVersion" ADD CONSTRAINT "ReportCardVersion_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReportGenerationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCardVersion" ADD CONSTRAINT "ReportCardVersion_generatedByMembershipId_fkey" FOREIGN KEY ("generatedByMembershipId") REFERENCES "SchoolMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationFailure" ADD CONSTRAINT "ReportGenerationFailure_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationFailure" ADD CONSTRAINT "ReportGenerationFailure_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReportGenerationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationFailure" ADD CONSTRAINT "ReportGenerationFailure_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationFailure" ADD CONSTRAINT "ReportGenerationFailure_academicTermId_fkey" FOREIGN KEY ("academicTermId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationFailure" ADD CONSTRAINT "ReportGenerationFailure_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportGenerationFailure" ADD CONSTRAINT "ReportGenerationFailure_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE SET NULL ON UPDATE CASCADE;
