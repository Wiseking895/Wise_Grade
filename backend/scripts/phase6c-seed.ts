/**
 * Phase 6C browser-QA fixture seeder.
 *
 * Creates synthetic schools, users, calendar, assessment policy, grading
 * scheme, pupils, report inputs and a platform pricing rule in the dedicated
 * TEST_DATABASE_URL database. It refuses production, the development database
 * and any database whose name does not contain "test".
 *
 * The browser suite performs the real workflow (score entry, review, report
 * generation, invoicing, payment verification, approval and release). This
 * script only supplies the baseline records that would normally be created by
 * a school administrator over time.
 *
 * No real pupil data is used. Running the script repeatedly replaces only the
 * phase6c fixtures.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { hashPassword } from '../src/auth/password.js'
import { loadProjectEnvFile } from '../src/config/env-file.js'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { assertSafeIntegrationTarget } from '../tests/integration/target.js'

loadProjectEnvFile()

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl) {
  console.error(
    'PHASE6C SEED BLOCKED: TEST_DATABASE_URL is not set. No database was changed.',
  )
  process.exit(1)
}

assertSafeIntegrationTarget({
  testDatabaseUrl,
  databaseUrl: process.env.DATABASE_URL?.trim(),
  nodeEnv: process.env.NODE_ENV,
})

const PASSWORD = 'Phase6C!Testing2026'
const EMAIL_DOMAIN = '@phase6c.test'
const SLUG_PREFIX = 'phase6c-'

const USERS = {
  platform: {
    email: `platform${EMAIL_DOMAIN}`,
    firstName: 'Platform',
    lastName: 'Reviewer',
    isPlatformAdmin: true,
  },
  schoolAdmin: {
    email: `admin.a${EMAIL_DOMAIN}`,
    firstName: 'Akosua',
    lastName: 'Admin',
    isPlatformAdmin: false,
  },
  teacher: {
    email: `teacher.a${EMAIL_DOMAIN}`,
    firstName: 'Kwame',
    lastName: 'Teacher',
    isPlatformAdmin: false,
  },
  otherAdmin: {
    email: `admin.b${EMAIL_DOMAIN}`,
    firstName: 'Yaa',
    lastName: 'Other',
    isPlatformAdmin: false,
  },
} as const

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: testDatabaseUrl })
  const prisma = new PrismaClient({ adapter })

  try {
    // --- Reset only our fixtures -------------------------------------------------
    const existingUsers = await prisma.user.findMany({
      where: { email: { endsWith: EMAIL_DOMAIN } },
      select: { id: true },
    })
    const existingUserIds = existingUsers.map((row) => row.id)

    // Schools cascade to memberships, submissions, report cards, invoices and
    // payments. Invoices restrict deletion of the pricing rule they used, so the
    // school tree must go before the pricing rules.
    await prisma.school.deleteMany({
      where: { slug: { startsWith: SLUG_PREFIX } },
    })

    // Pricing rules are platform-owned and restrict user deletion, so remove the
    // ones our fixture users created before removing the users themselves.
    if (existingUserIds.length > 0) {
      await prisma.pricingRule.deleteMany({
        where: { createdByUserId: { in: existingUserIds } },
      })
    }

    if (existingUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: existingUserIds } } })
    }

    // --- Users ------------------------------------------------------------------
    const passwordHash = await hashPassword(PASSWORD)

    const [platformUser, schoolAdmin, teacher, otherAdmin] = await Promise.all(
      [
        USERS.platform,
        USERS.schoolAdmin,
        USERS.teacher,
        USERS.otherAdmin,
      ].map((user) =>
        prisma.user.create({
          data: {
            email: user.email,
            passwordHash,
            firstName: user.firstName,
            lastName: user.lastName,
            isPlatformAdmin: user.isPlatformAdmin,
          },
        }),
      ),
    )

    // --- School A: full workflow fixture -----------------------------------------
    const schoolA = await prisma.school.create({
      data: {
        name: 'Phase 6C Demo Academy',
        slug: `${SLUG_PREFIX}demo-academy`,
        email: `school-a${EMAIL_DOMAIN}`,
        phone: '+233200000001',
        address: '12 Independence Avenue, Accra, Greater Accra',
        landmark: 'Opposite Independence Arch',
        // Report generation requires a complete school identity. The seeded
        // logo key keeps the fixture consistent; the optional image read is
        // tolerant of a missing object.
        logoObjectKey: `schools/${SLUG_PREFIX}demo-academy/logo.png`,
        logoMimeType: 'image/png',
        logoUpdatedAt: new Date(),
        classTeacherEntryMode: 'ALL_CLASS_SUBJECTS',
      },
    })

    const membershipA = await prisma.schoolMembership.create({
      data: {
        schoolId: schoolA.id,
        userId: schoolAdmin.id,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    })

    const teacherMembershipA = await prisma.schoolMembership.create({
      data: {
        schoolId: schoolA.id,
        userId: teacher.id,
        role: 'CLASS_TEACHER',
        status: 'ACTIVE',
      },
    })

    const yearA = await prisma.academicYear.create({
      data: {
        schoolId: schoolA.id,
        name: '2026/2027',
        startsOn: new Date('2026-09-01T00:00:00.000Z'),
        endsOn: new Date('2027-07-31T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    const termA = await prisma.academicTerm.create({
      data: {
        schoolId: schoolA.id,
        academicYearId: yearA.id,
        name: 'Term 1',
        sequence: 1,
        startsOn: new Date('2026-09-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-18T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    const classA = await prisma.schoolClass.create({
      data: {
        schoolId: schoolA.id,
        academicYearId: yearA.id,
        name: 'Basic 5A',
        level: 'Basic 5',
        sortOrder: 1,
      },
    })

    await prisma.classTeacherAssignment.create({
      data: {
        schoolId: schoolA.id,
        classId: classA.id,
        membershipId: teacherMembershipA.id,
      },
    })

    const pupilsA = await Promise.all(
      [
        {
          firstName: 'Ama',
          lastName: 'Mensah',
          otherNames: 'Akua',
          admissionNumber: 'ADM-6C-001',
          gender: 'FEMALE' as const,
        },
        {
          firstName: 'Kojo',
          lastName: 'Owusu',
          otherNames: null,
          admissionNumber: 'ADM-6C-002',
          gender: 'MALE' as const,
        },
      ].map((pupil) =>
        prisma.pupil.create({
          data: {
            schoolId: schoolA.id,
            firstName: pupil.firstName,
            lastName: pupil.lastName,
            otherNames: pupil.otherNames,
            admissionNumber: pupil.admissionNumber,
            gender: pupil.gender,
            dateOfBirth: new Date('2015-04-12T00:00:00.000Z'),
            currentClassId: classA.id,
          },
        }),
      ),
    )

    await prisma.pupilEnrollment.createMany({
      data: pupilsA.map((pupil) => ({
        schoolId: schoolA.id,
        pupilId: pupil.id,
        classId: classA.id,
        academicYearId: yearA.id,
        status: 'ACTIVE' as const,
        startedOn: new Date('2026-09-01T00:00:00.000Z'),
      })),
    })

    const subjectsA = await Promise.all(
      [
        { name: 'Mathematics', code: 'MATH', sortOrder: 1 },
        { name: 'English Language', code: 'ENG', sortOrder: 2 },
        { name: 'Integrated Science', code: 'SCI', sortOrder: 3 },
      ].map((subject) =>
        prisma.subject.create({
          data: {
            schoolId: schoolA.id,
            name: subject.name,
            code: subject.code,
          },
        }),
      ),
    )

    await prisma.classSubject.createMany({
      data: subjectsA.map((subject, index) => ({
        schoolId: schoolA.id,
        classId: classA.id,
        subjectId: subject.id,
        isActive: true,
        sortOrder: index + 1,
      })),
    })

    const schemeA = await prisma.gradingScheme.create({
      data: {
        schoolId: schoolA.id,
        academicYearId: yearA.id,
        academicTermId: termA.id,
        name: 'Phase 6C Standards',
        description: 'Synthetic grading scale for Phase 6C browser QA.',
        isActive: true,
        bands: {
          create: [
            {
              schoolId: schoolA.id,
              minScore: 0,
              maxScore: 69.99,
              gradeLabel: 'D',
              remark: 'Needs improvement',
              sortOrder: 1,
            },
            {
              schoolId: schoolA.id,
              minScore: 70,
              maxScore: 79.99,
              gradeLabel: 'C',
              remark: 'Good',
              sortOrder: 2,
            },
            {
              schoolId: schoolA.id,
              minScore: 80,
              maxScore: 89.99,
              gradeLabel: 'B',
              remark: 'Very good',
              sortOrder: 3,
            },
            {
              schoolId: schoolA.id,
              minScore: 90,
              maxScore: 100,
              gradeLabel: 'A',
              remark: 'Excellent',
              sortOrder: 4,
            },
          ],
        },
      },
    })

    const policyA = await prisma.assessmentPolicy.create({
      data: {
        schoolId: schoolA.id,
        academicYearId: yearA.id,
        academicTermId: termA.id,
        gradingSchemeId: schemeA.id,
        name: 'Phase 6C Term Policy',
        description:
          'SBA 40% and examination 60%, synthetic policy for browser QA.',
        scopeKey: 'term',
        version: 1,
        isActive: true,
        components: {
          create: [
            {
              schoolId: schoolA.id,
              key: 'sba',
              name: 'Class Score',
              category: 'SBA',
              maximumScore: 40,
              weightPercent: 40,
              sortOrder: 1,
            },
            {
              schoolId: schoolA.id,
              key: 'exam',
              name: 'End of Term Exam',
              category: 'EXAM',
              maximumScore: 60,
              weightPercent: 60,
              sortOrder: 2,
            },
          ],
        },
      },
    })

    await prisma.reportSettings.create({
      data: {
        schoolId: schoolA.id,
        academicYearId: yearA.id,
        academicTermId: termA.id,
        headteacherLabel: "HEADMASTER'S SIGNATURE",
        rankingEnabled: true,
        tiePolicy: 'COMPETITION',
        aggregatePolicy: 'SUM_ALL_SUBJECTS',
        attendanceRequired: true,
        closingDate: new Date('2026-12-18T00:00:00.000Z'),
        reopeningDate: new Date('2027-01-12T00:00:00.000Z'),
      },
    })

    await prisma.reportInput.createMany({
      data: pupilsA.map((pupil, index) => ({
        schoolId: schoolA.id,
        academicYearId: yearA.id,
        academicTermId: termA.id,
        classId: classA.id,
        pupilId: pupil.id,
        daysOpened: 62,
        daysAttended: index === 0 ? 60 : 55,
        teacherRemarks: `Synthetic Phase 6C remark for ${pupil.firstName}.`,
        attitude: 'Cooperative, attentive and respectful.',
        closingDate: new Date('2026-12-18T00:00:00.000Z'),
        reopeningDate: new Date('2027-01-12T00:00:00.000Z'),
        updatedByMembershipId: membershipA.id,
      })),
    })

    // --- School B: cross-tenant isolation fixture --------------------------------
    const schoolB = await prisma.school.create({
      data: {
        name: 'Phase 6C Other College',
        slug: `${SLUG_PREFIX}other-college`,
        email: `school-b${EMAIL_DOMAIN}`,
        address: '8 Station Road, Kumasi, Ashanti',
      },
    })

    await prisma.schoolMembership.create({
      data: {
        schoolId: schoolB.id,
        userId: otherAdmin.id,
        role: 'SCHOOL_ADMIN',
        status: 'ACTIVE',
      },
    })

    const yearB = await prisma.academicYear.create({
      data: {
        schoolId: schoolB.id,
        name: '2026/2027',
        startsOn: new Date('2026-09-01T00:00:00.000Z'),
        endsOn: new Date('2027-07-31T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    await prisma.academicTerm.create({
      data: {
        schoolId: schoolB.id,
        academicYearId: yearB.id,
        name: 'Term 1',
        sequence: 1,
        startsOn: new Date('2026-09-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-18T00:00:00.000Z'),
        isCurrent: true,
      },
    })

    // --- Platform pricing ------------------------------------------------------
    // Reuse an existing active GHS rule when one already covers today. Otherwise
    // create a new version without colliding with the (currency, version) and
    // (currency, effectiveFrom) unique keys.
    const today = new Date()
    const todayDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    )
    const existingPricing = await prisma.pricingRule.findFirst({
      where: {
        currency: 'GHS',
        isActive: true,
        effectiveFrom: { lte: todayDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    })

    if (!existingPricing) {
      const highest = await prisma.pricingRule.findFirst({
        where: { currency: 'GHS' },
        orderBy: { version: 'desc' },
        select: { version: true },
      })

      let effectiveFrom = new Date('2020-01-01T00:00:00.000Z')
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const clash = await prisma.pricingRule.findFirst({
          where: { currency: 'GHS', effectiveFrom },
          select: { id: true },
        })

        if (!clash) break

        effectiveFrom = new Date(effectiveFrom.getTime() + 24 * 60 * 60 * 1000)
      }

      await prisma.pricingRule.create({
        data: {
          currency: 'GHS',
          amountMinor: 500,
          effectiveFrom,
          isActive: true,
          version: (highest?.version ?? 0) + 1,
          createdByUserId: platformUser.id,
        },
      })
    }

    const counts = {
      users: 4,
      schools: 2,
      pupils: pupilsA.length,
      subjects: subjectsA.length,
      batches: 0,
    }

    console.log('PHASE6C SEED OK')
    console.log(`fixture: school=${schoolA.name} / ${schoolB.name}`)
    console.log(
      `fixture: year=${yearA.name} term=${termA.name} class=${classA.name}`,
    )
    console.log(
      `fixture: pupils=${counts.pupils} subjects=${counts.subjects} policy=${policyA.name}`,
    )
    console.log('fixture: all records are synthetic phase6c.test data')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(
    'PHASE6C SEED FAILED:',
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})
