-- CreateEnum
CREATE TYPE "PupilGender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "PupilStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "academicYearId" UUID,
    "name" VARCHAR(80) NOT NULL,
    "level" VARCHAR(40),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pupil" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "firstName" VARCHAR(80) NOT NULL,
    "lastName" VARCHAR(80) NOT NULL,
    "otherNames" VARCHAR(120),
    "admissionNumber" VARCHAR(40) NOT NULL,
    "gender" "PupilGender",
    "dateOfBirth" DATE,
    "photoReference" VARCHAR(512),
    "status" "PupilStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentClassId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pupil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PupilEnrollment" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "pupilId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PupilEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(24),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSubject" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTeacherAssignment" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClassTeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectTeacherAssignment" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SubjectTeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolClass_schoolId_isArchived_sortOrder_idx" ON "SchoolClass"("schoolId", "isArchived", "sortOrder");

-- CreateIndex
CREATE INDEX "SchoolClass_academicYearId_idx" ON "SchoolClass"("academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_schoolId_name_academicYearId_key" ON "SchoolClass"("schoolId", "name", "academicYearId");

-- CreateIndex
CREATE INDEX "Pupil_schoolId_status_idx" ON "Pupil"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Pupil_schoolId_lastName_firstName_idx" ON "Pupil"("schoolId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Pupil_currentClassId_idx" ON "Pupil"("currentClassId");

-- CreateIndex
CREATE UNIQUE INDEX "Pupil_schoolId_admissionNumber_key" ON "Pupil"("schoolId", "admissionNumber");

-- CreateIndex
CREATE INDEX "PupilEnrollment_schoolId_pupilId_status_idx" ON "PupilEnrollment"("schoolId", "pupilId", "status");

-- CreateIndex
CREATE INDEX "PupilEnrollment_classId_status_idx" ON "PupilEnrollment"("classId", "status");

-- CreateIndex
CREATE INDEX "PupilEnrollment_academicYearId_status_idx" ON "PupilEnrollment"("academicYearId", "status");

-- CreateIndex
CREATE INDEX "Subject_schoolId_isArchived_idx" ON "Subject"("schoolId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_schoolId_name_key" ON "Subject"("schoolId", "name");

-- CreateIndex
CREATE INDEX "ClassSubject_schoolId_isActive_idx" ON "ClassSubject"("schoolId", "isActive");

-- CreateIndex
CREATE INDEX "ClassSubject_subjectId_idx" ON "ClassSubject"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSubject_classId_subjectId_key" ON "ClassSubject"("classId", "subjectId");

-- CreateIndex
CREATE INDEX "ClassTeacherAssignment_schoolId_classId_endedAt_idx" ON "ClassTeacherAssignment"("schoolId", "classId", "endedAt");

-- CreateIndex
CREATE INDEX "ClassTeacherAssignment_membershipId_endedAt_idx" ON "ClassTeacherAssignment"("membershipId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTeacherAssignment_classId_membershipId_key" ON "ClassTeacherAssignment"("classId", "membershipId");

-- CreateIndex
CREATE INDEX "SubjectTeacherAssignment_schoolId_classId_subjectId_endedAt_idx" ON "SubjectTeacherAssignment"("schoolId", "classId", "subjectId", "endedAt");

-- CreateIndex
CREATE INDEX "SubjectTeacherAssignment_membershipId_endedAt_idx" ON "SubjectTeacherAssignment"("membershipId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectTeacherAssignment_classId_subjectId_membershipId_key" ON "SubjectTeacherAssignment"("classId", "subjectId", "membershipId");

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pupil" ADD CONSTRAINT "Pupil_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pupil" ADD CONSTRAINT "Pupil_currentClassId_fkey" FOREIGN KEY ("currentClassId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilEnrollment" ADD CONSTRAINT "PupilEnrollment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilEnrollment" ADD CONSTRAINT "PupilEnrollment_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilEnrollment" ADD CONSTRAINT "PupilEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilEnrollment" ADD CONSTRAINT "PupilEnrollment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherAssignment" ADD CONSTRAINT "ClassTeacherAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherAssignment" ADD CONSTRAINT "ClassTeacherAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherAssignment" ADD CONSTRAINT "ClassTeacherAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "SchoolMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "SchoolMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
