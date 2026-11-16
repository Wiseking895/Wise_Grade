/**
 * Local Term 1 v2 verification after the report-card redesign.
 *
 * The earlier run released v1 PDFs for Nursery 1. This script deliberately
 * submits a *new* term request (the prior batch is already RELEASED) so the
 * redesigned renderer produces a new report version without overwriting the
 * historical v1 files. It uses the same ReportWorkflowService and School Admin
 * read paths as the HTTP routes, writes the real PDFs to
 * backend/.artifacts/term1-v2-dev, and never resets the database.
 *
 * The development database has a School Admin signature and a photograph for
 * one of the two Nursery 1 pupils. The script reports the actual asset state
 * rather than fabricating assets: the pupil without a photograph still renders
 * the neutral PHOTO frame, and no other pupil's image is ever used.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getPrismaClient } from '../src/lib/prisma.js'
import { createPrismaReportRepository } from '../src/reports/prisma-repository.js'
import { createPrismaReportReleaseRepository } from '../src/reports/release-prisma-repository.js'
import { ReportService } from '../src/reports/service.js'
import { ReportReleaseService } from '../src/reports/release-service.js'
import { ReportWorkflowService } from '../src/reports/workflow-service.js'
import type { ReportAuditContext, ReportActor } from '../src/reports/repository.js'
import type {
  PlatformReportActor,
  ReportReleaseAuditContext,
} from '../src/reports/release-repository.js'
import { createStorageAdapter } from '../src/storage/storage.js'
import { extractPdfText } from '../tests/helpers/pdf-text.js'

const prisma = getPrismaClient()
const storage = createStorageAdapter()
const reports = new ReportService({
  repository: createPrismaReportRepository(),
  storage,
})
const releases = new ReportReleaseService({
  repository: createPrismaReportReleaseRepository(),
  storage,
})
const workflow = new ReportWorkflowService({ reports, releases })

const outputDir = resolve(process.cwd(), '.artifacts/term1-v2-dev')

const school = await prisma.school.findFirstOrThrow({
  where: { name: 'Wisdom Academy' },
})
const year = await prisma.academicYear.findFirstOrThrow({
  where: { schoolId: school.id, isCurrent: true },
})
const term = await prisma.academicTerm.findFirstOrThrow({
  where: { academicYearId: year.id, isCurrent: true },
})
const nursery = await prisma.schoolClass.findFirstOrThrow({
  where: {
    schoolId: school.id,
    name: 'Nursery 1',
    enrollments: { some: { status: 'ACTIVE' } },
  },
})
const nurseryEnrollments = await prisma.pupilEnrollment.findMany({
  where: { schoolId: school.id, classId: nursery.id, status: 'ACTIVE' },
  select: {
    pupilId: true,
    pupil: {
      select: {
        firstName: true,
        lastName: true,
        photoReference: true,
        photoMimeType: true,
      },
    },
  },
})

const schoolAdminUser = await prisma.user.findFirstOrThrow({
  where: { email: 'solosarpong5@gmail.com' },
})
const schoolAdminMembership = await prisma.schoolMembership.findFirstOrThrow({
  where: { userId: schoolAdminUser.id, schoolId: school.id },
})
const classTeacherUser = await prisma.user.findFirstOrThrow({
  where: { email: 'solosar@gmail.com' },
})
const classTeacherMembership = await prisma.schoolMembership.findFirstOrThrow({
  where: { userId: classTeacherUser.id, schoolId: school.id },
})
const platformUser = await prisma.user.findFirstOrThrow({
  where: { email: 'wisebizness12@gmail.com', isPlatformAdmin: true },
})

const schoolAdmin: ReportActor = {
  schoolId: school.id,
  userId: schoolAdminUser.id,
  membershipId: schoolAdminMembership.id,
  role: 'SCHOOL_ADMIN',
}
const classTeacher: ReportActor = {
  schoolId: school.id,
  userId: classTeacherUser.id,
  membershipId: classTeacherMembership.id,
  role: 'CLASS_TEACHER',
}
const platformActor: PlatformReportActor = { userId: platformUser.id }

const reportAudit: ReportAuditContext = {
  actorUserId: schoolAdminUser.id,
  actorMembershipId: schoolAdminMembership.id,
  ipAddress: '127.0.0.1',
  userAgent: 'local-term1-v2-inspection',
}
const releaseAudit: ReportReleaseAuditContext = {
  actorUserId: platformUser.id,
  actorMembershipId: null,
  actorRole: 'PLATFORM_SUPER_ADMIN',
  ipAddress: '127.0.0.1',
  userAgent: 'local-term1-v2-inspection',
}

await mkdir(outputDir, { recursive: true })

console.log(`School: ${school.name} (${school.id})`)
console.log(`Term: ${term.name} / ${year.name}`)
console.log(
  `Signature on school profile: ${school.signatureObjectKey ? 'present' : 'NONE'}`,
)
for (const enrollment of nurseryEnrollments) {
  console.log(
    `Pupil photo ${enrollment.pupil.firstName} ${enrollment.pupil.lastName}: ${
      enrollment.pupil.photoReference ? 'present' : 'NONE'
    }`,
  )
}

// Attendance inputs are a class-teacher responsibility. Only fill missing
// values; never overwrite data a real user has already entered.
for (const enrollment of nurseryEnrollments) {
  const existing = await prisma.reportInput.findUnique({
    where: {
      schoolId_academicTermId_pupilId: {
        schoolId: school.id,
        academicTermId: term.id,
        pupilId: enrollment.pupilId,
      },
    },
  })

  if (existing?.daysOpened != null && existing?.daysAttended != null) {
    continue
  }

  await reports.upsertInput(
    classTeacher,
    {
      academicYearId: year.id,
      academicTermId: term.id,
      classId: nursery.id,
      pupilId: enrollment.pupilId,
      daysOpened: 60,
      daysAttended: 57,
      teacherRemarks: 'A steady and cheerful term.',
      attitude: 'Cooperative',
    },
    {
      actorUserId: classTeacherUser.id,
      actorMembershipId: classTeacherMembership.id,
      ipAddress: '127.0.0.1',
      userAgent: 'local-term1-v2-inspection',
    },
  )
  console.log(
    `Recorded attendance for ${enrollment.pupil.firstName} ${enrollment.pupil.lastName}.`,
  )
}

const summaries = await reports.buildClassSummaries(
  schoolAdmin,
  year.id,
  term.id,
)
console.log('\nPREFLIGHT')
for (const summary of summaries) {
  console.log(
    `- ${summary.className}: pupils=${summary.pupilCount} eligible=${summary.eligiblePupilCount} ineligible=${summary.ineligiblePupilCount} acceptedResults=${summary.acceptedResultCount}`,
  )
}

// A fresh request: the previous term batch is RELEASED, so this creates a new
// batch and new versions. Existing v1 artifacts remain untouched.
const submitted = await workflow.submitRequest(
  schoolAdmin,
  { academicYearId: year.id, academicTermId: term.id },
  reportAudit,
)
const requestId = submitted.batch.id
console.log(`\nSubmitted term request ${requestId}.`)

let outcome = await workflow.approve(platformActor, requestId, releaseAudit)
console.log(
  `\nAPPROVAL: releaseStatus=${outcome.batch.releaseStatus} generation=${outcome.batch.generationStatus} generated=${outcome.batch.generatedCount} failed=${outcome.batch.failedCount}`,
)
for (const result of outcome.results) {
  console.log(
    `  - ${result.pupilName} (${result.classId}): ${result.status}${
      result.failureCode ? ` ${result.failureCode}: ${result.failureMessage}` : ''
    }`,
  )
}

if (
  outcome.batch.releaseStatus === 'APPROVED' &&
  outcome.batch.failedCount > 0
) {
  outcome = await workflow.retry(platformActor, requestId, releaseAudit)
  console.log(
    `\nRETRY: releaseStatus=${outcome.batch.releaseStatus} generated=${outcome.batch.generatedCount} failed=${outcome.batch.failedCount}`,
  )
}

const detail = await workflow.getPlatformRequest(requestId)
console.log('\nCLASS PROGRESS')
for (const item of detail.classes) {
  console.log(
    `- ${item.className}: status=${item.status} generated=${item.generatedCount} failed=${item.failedCount} ineligible=${item.ineligiblePupilCount}`,
  )
}

const cards = await reports.listCards(schoolAdmin, {
  academicTermId: term.id,
  releasedOnly: true,
})
console.log(`\nRELEASED CARDS: ${cards.length}`)

for (const card of cards) {
  const detailCard = await reports.getCard(schoolAdmin, card.id)
  const version = detailCard.versions[0]

  if (!version) continue

  const pdf = await reports.getStoredPdf(
    schoolAdmin,
    card.id,
    version.version,
    reportAudit,
  )
  const fileName = `${card.admissionNumber}-v${version.version}.pdf`.replace(
    /[^A-Za-z0-9._-]+/g,
    '-',
  )
  const path = resolve(outputDir, fileName)
  await writeFile(path, pdf.data)
  const text = await extractPdfText(pdf.data)

  console.log(
    `- ${card.pupilName} (${card.className}) v${version.version}: ${pdf.data.length} bytes, ${pdf.pageCount} page(s)`,
  )
  console.log(`  path: ${path}`)
  console.log(
    `  checks: header=${pdf.data.subarray(0, 5).toString()} releasedBanner=${text.includes(
      'RELEASED — PRIVATE SCHOOL ACCESS',
    )} draftLabel=${text.includes('INTERNAL DRAFT')} photoPlaceholder=${text.includes(
      'PHOTO',
    )} signatureCaption=${text.includes('SCHOOL ADMIN SIGNATURE')}`,
  )
}

const collection = await reports.getClassCollection(
  schoolAdmin,
  { academicTermId: term.id, classId: nursery.id },
  reportAudit,
)
const collectionPath = resolve(outputDir, 'Nursery-1-class-collection.pdf')
await writeFile(collectionPath, collection.data)
const collectionText = await extractPdfText(collection.data)
console.log(
  `\nCLASS COLLECTION: ${collection.data.length} bytes, ${collection.pageCount} page(s)`,
)
console.log(`  path: ${collectionPath}`)
console.log(
  `  pupilLabels=${nurseryEnrollments
    .map((item) => `${item.pupil.firstName} ${item.pupil.lastName}`)
    .filter((name) =>
      collectionText.toLowerCase().includes(name.toLowerCase()),
    )
    .length}/${nurseryEnrollments.length}`,
)

console.log(`\nArtifacts written to ${outputDir}`)

await prisma.$disconnect()
