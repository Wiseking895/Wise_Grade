/**
 * Local Term 1 workflow verification.
 *
 * This script drives the real ReportWorkflowService against the development
 * database and local private storage. It:
 *   1. records attendance inputs for the eligible Nursery 1 pupils (class
 *      teacher action) so the accepted results can be reported;
 *   2. submits one term-wide report request as the school administrator;
 *   3. approves it as the platform super administrator, which generates every
 *      eligible class and releases the completed batch;
 *   4. downloads each released PDF and the merged class collection through the
 *      same service methods used by the School Admin HTTP routes;
 *   5. writes the PDFs to backend/.artifacts/term1-dev for inspection.
 *
 * It never resets the database and only adds missing attendance inputs.
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

const outputDir = resolve(process.cwd(), '.artifacts/term1-dev')

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
  select: { pupilId: true, pupil: { select: { firstName: true, lastName: true } } },
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
  userAgent: 'local-term1-dev-inspection',
}
const releaseAudit: ReportReleaseAuditContext = {
  actorUserId: platformUser.id,
  actorMembershipId: null,
  actorRole: 'PLATFORM_SUPER_ADMIN',
  ipAddress: '127.0.0.1',
  userAgent: 'local-term1-dev-inspection',
}

await mkdir(outputDir, { recursive: true })

// 1. Attendance inputs are a class-teacher responsibility. Only fill missing
//    values; never overwrite data a real user has already entered.
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
    console.log(
      `Attendance already present for ${enrollment.pupil.firstName} ${enrollment.pupil.lastName}.`,
    )
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
      userAgent: 'local-term1-dev-inspection',
    },
  )
  console.log(
    `Recorded attendance for ${enrollment.pupil.firstName} ${enrollment.pupil.lastName}.`,
  )
}

// 2. Show the live preflight exactly as the request screen would.
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

// 3. Submit or reuse the term request.
const existingRequest = await prisma.reportGenerationBatch.findFirst({
  where: {
    schoolId: school.id,
    academicTermId: term.id,
    scope: 'TERM',
    releaseStatus: {
      in: ['PENDING_PLATFORM_REVIEW', 'APPROVED', 'RELEASED'],
    },
  },
  orderBy: { createdAt: 'desc' },
})

let requestId: string
let outcome: Awaited<ReturnType<typeof workflow.approve>> | null = null

if (!existingRequest) {
  const submitted = await workflow.submitRequest(
    schoolAdmin,
    { academicYearId: year.id, academicTermId: term.id },
    reportAudit,
  )
  requestId = submitted.batch.id
  console.log(`\nSubmitted term request ${requestId}.`)
} else {
  requestId = existingRequest.id
  console.log(
    `\nReusing existing term request ${requestId} (releaseStatus=${existingRequest.releaseStatus}).`,
  )
}

// 4. Approve, generate and release.
if (existingRequest?.releaseStatus === 'RELEASED') {
  console.log('Request already released; verifying downloads only.')
} else if (existingRequest?.releaseStatus === 'APPROVED') {
  outcome = await workflow.retry(platformActor, requestId, releaseAudit)
} else {
  outcome = await workflow.approve(platformActor, requestId, releaseAudit)
}

if (outcome) {
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
}

const detail = await workflow.getPlatformRequest(requestId)
console.log('\nCLASS PROGRESS')
for (const item of detail.classes) {
  console.log(
    `- ${item.className}: status=${item.status} generated=${item.generatedCount} failed=${item.failedCount} ineligible=${item.ineligiblePupilCount}`,
  )
}

// 5. School Admin view: released cards, individual PDFs and class collection.
const cards = await reports.listCards(schoolAdmin, {
  academicTermId: term.id,
  releasedOnly: true,
})
console.log(`\nRELEASED CARDS: ${cards.length}`)

let collectionBytes = 0

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
  await writeFile(resolve(outputDir, fileName), pdf.data)
  const text = await extractPdfText(pdf.data)
  console.log(
    `- ${card.pupilName} (${card.className}) v${version.version}: ${pdf.data.length} bytes, ${pdf.pageCount} page(s), header=${pdf.data
      .subarray(0, 5)
      .toString()}, draftLabel=${text.includes('INTERNAL DRAFT')}, releasedLabel=${text.includes('RELEASED')}`,
  )
  console.log(`  text sample: ${text.replace(/\s+/g, ' ').slice(0, 220)}`)
}

if (nursery.id) {
  const collection = await reports.getClassCollection(
    schoolAdmin,
    { academicTermId: term.id, classId: nursery.id },
    reportAudit,
  )
  collectionBytes = collection.data.length
  const collectionPath = resolve(
    outputDir,
    `Nursery-1-class-collection.pdf`,
  )
  await writeFile(collectionPath, collection.data)
  const text = await extractPdfText(collection.data)
  console.log(
    `\nCLASS COLLECTION: ${collection.data.length} bytes, ${collection.pageCount} page(s), header=${collection.data
      .subarray(0, 5)
      .toString()}, pupilLabels=${nurseryEnrollments
      .map((item) => `${item.pupil.firstName} ${item.pupil.lastName}`)
      .filter((name) => text.includes(name.toUpperCase()))
      .length}/${nurseryEnrollments.length}`,
  )
}

console.log(`\nArtifacts written to ${outputDir}`)
console.log(`Collection bytes: ${collectionBytes}`)

await prisma.$disconnect()
