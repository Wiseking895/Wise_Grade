import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

/**
 * Static regression checks for the role separation agreed during the
 * audit/stabilisation phase:
 *
 * - school administrators never get class or subject management entries;
 * - classes are visible to teaching staff only;
 * - pupil management is restricted to the assigned class teacher;
 * - subject-teacher assignment stays with the assigned class teacher.
 *
 * These checks complement the API tests, which enforce the same rules on the
 * server. They are intentionally source-level so a navigation or route change
 * cannot quietly reopen the removed admin workflow.
 */
describe('school role separation', () => {
  it('keeps classes and subjects out of the administrator navigation', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')

    assert.doesNotMatch(layout, /\/dashboard\/subjects/)
    // Class teachers manage their own class from the Class Dashboard, so the
    // standalone class listing is now a subject-teacher reference only.
    assert.match(
      layout,
      /label: 'Classes'[\s\S]{0,140}roles: \['SUBJECT_TEACHER'\]/,
    )
    assert.match(
      layout,
      /label: 'Pupils'[\s\S]{0,140}roles: CLASS_TEACHER_ROLES/,
    )
    assert.match(
      layout,
      /label: 'Teachers'[\s\S]{0,140}roles: ADMIN_ROLES/,
    )
  })

  it('guards class and pupil routes at the router level', async () => {
    const app = await source('../src/App.tsx')

    assert.doesNotMatch(app, /SubjectsPage/)
    assert.doesNotMatch(app, /path="subjects"/)
    assert.match(
      app,
      /path="classes"[\s\S]{0,220}<SubjectTeacherRoute>/,
    )
    assert.match(app, /path="pupils"[\s\S]{0,220}<ClassTeacherRoute>/)
    assert.match(app, /path="teachers"[\s\S]{0,220}<SchoolAdminRoute>/)
  })

  it('defines the class-teacher route guard', async () => {
    const guards = await source('../src/components/ProtectedRoute.tsx')

    assert.match(guards, /export function ClassTeacherRoute/)
    assert.match(guards, /export function SubjectTeacherRoute/)
    assert.match(guards, /role !== 'CLASS_TEACHER'/)
    assert.match(guards, /role !== 'SUBJECT_TEACHER'/)
  })

  it('leaves subject setup and subject-teacher assignment to the class teacher', async () => {
    const teachersPage = await source(
      '../src/pages/dashboard/TeachersPage.tsx',
    )
    const overview = await source(
      '../src/pages/dashboard/DashboardOverviewPage.tsx',
    )
    const manager = await source('../src/components/ClassSubjectsManager.tsx')

    // The administrator registers a class with its class teacher only.
    assert.doesNotMatch(teachersPage, /assignSubjectTeacher/)
    assert.doesNotMatch(teachersPage, /revokeSubjectTeacher/)
    assert.doesNotMatch(teachersPage, /subjectTeacherMembershipId/)
    assert.doesNotMatch(teachersPage, /registerTeacher\(/)
    assert.match(teachersPage, /registerClassWithTeacher/)
    assert.match(teachersPage, /Register class &amp; teacher/)

    // The class teacher adds subjects and hands a subject over by entering the
    // subject teacher's details, which issues a reusable access code. No
    // account or password is created for the subject teacher.
    // This now happens inside the Class Dashboard, not the class listing.
    assert.match(overview, /ClassSubjectsManager/)
    assert.match(manager, /subjectTeacher:/)
    assert.match(manager, /reissueSubjectTeacherInvitation/)
    assert.match(manager, /revokeSubjectTeacherInvitation/)
    assert.match(manager, /updateClassSubject/)
    assert.match(manager, /access code/i)
    assert.doesNotMatch(manager, /activation code/i)
    // The UI must not claim automatic email/SMS delivery when none is configured.
    assert.match(manager, /not automatic/i)
    assert.doesNotMatch(manager, /we (sent|emailed|texted)/i)
  })

  it('opens subject workspaces with a reusable access code, not activation', async () => {
    const app = await source('../src/App.tsx')
    const login = await source('../src/pages/LoginPage.tsx')
    const accessCode = await source('../src/pages/AccessCodePage.tsx')
    const provider = await source('../src/auth/AuthProvider.tsx')
    const api = await source('../src/lib/api.ts')

    assert.doesNotMatch(app, /SubjectTeacherActivationPage/)
    assert.doesNotMatch(app, /path="\/activate"/)
    assert.match(app, /path="\/access-code"/)
    assert.match(login, /Enter access code/)
    assert.match(accessCode, /enterAccessCode/)
    assert.match(accessCode, /Back to login/)
    assert.match(provider, /fetchSubjectSession/)
    assert.match(provider, /subjectSession/)
    assert.match(api, /subject-teacher\/access-code/)
    assert.doesNotMatch(api, /subject-teacher\/activate/)
  })

  it('probes the restricted subject session only when the browser hints at one', async () => {
    const provider = await source('../src/auth/AuthProvider.tsx')
    const api = await source('../src/lib/api.ts')

    // The subject-session cookie belongs to the API origin and is HttpOnly, so
    // the web app cannot read it. The hint must therefore be origin-local
    // storage rather than document.cookie.
    assert.match(api, /rememberSubjectSessionHint/)
    assert.match(api, /localStorage/)
    assert.doesNotMatch(api, /document\.cookie/)

    const hintAt = provider.indexOf('hasSubjectSessionHint()')
    const probeAt = provider.indexOf('await fetchSubjectSession()')

    assert.ok(hintAt >= 0, 'loadAuthState must check the hint')
    assert.ok(probeAt > hintAt, 'the hint must gate the subject probe')
    assert.match(provider, /rememberSubjectSessionHint\(\)/)
    assert.match(provider, /clearSubjectSessionHint\(\)/)
  })

  it('reuses the class workspace and assessment register for subject sessions', async () => {
    const overview = await source(
      '../src/pages/dashboard/DashboardOverviewPage.tsx',
    )
    const scores = await source('../src/pages/dashboard/ScoreEntryPage.tsx')
    const layout = await source('../src/components/DashboardLayout.tsx')
    const provider = await source('../src/schools/SchoolProvider.tsx')

    // A restricted subject session renders the same Class Dashboard and score
    // register instead of a second, duplicated subject-teacher workspace.
    assert.match(overview, /isSubjectSession[\s\S]{0,120}<ClassDashboard/)
    assert.match(
      scores,
      /isSubjectSession[\s\S]{0,160}classOptions\.length <= 1/,
    )
    assert.doesNotMatch(overview, /SubjectTeacherDashboard/)
    assert.doesNotMatch(scores, /SubjectTeacherDashboard/)

    // Navigation is limited to that reused workspace.
    assert.match(layout, /SUBJECT_SESSION_PATHS/)
    assert.match(layout, /\/dashboard\/assessments\/scores/)
    assert.match(layout, /\/dashboard\/assessments\/submissions/)

    // The display membership is synthesised for shared chrome only; every API
    // call remains authorised by the backend session cookie.
    assert.match(provider, /isSubjectSession/)
    assert.match(provider, /subject-session:/)
  })

  it('resolves the Class Dashboard from the authenticated class assignment', async () => {
    const overview = await source(
      '../src/pages/dashboard/DashboardOverviewPage.tsx',
    )
    const scores = await source('../src/pages/dashboard/ScoreEntryPage.tsx')
    const pupils = await source('../src/pages/dashboard/PupilsPage.tsx')
    const schoolsRoute = await source('../../backend/src/routes/schools.ts')
    const assessmentsRoute = await source(
      '../../backend/src/routes/assessments.ts',
    )

    // The dashboard label is Class Dashboard and the class/pupil roll come from
    // one authoritative backend response, never a hardcoded class name.
    assert.match(overview, /title="Class Dashboard"/)
    assert.match(overview, /getClassDashboard/)
    assert.match(overview, /pupilsOnRoll/)
    assert.match(overview, /Responsible Class Teacher/)
    // A class selector is only offered for genuinely multiple assignments.
    assert.match(overview, /classes\.length > 1/)

    // Score entry and pupil management hide class selection for a single-class
    // class teacher and rely on the assigned class.
    assert.match(scores, /singleClassTeacher/)
    assert.match(scores, /getClassDashboard/)
    assert.match(pupils, /classes\.length === 1/)

    // The backend resolves the class from the membership and rewrites a
    // manipulated score-entry class id.
    assert.match(schoolsRoute, /\/class-dashboard/)
    assert.match(schoolsRoute, /getClassTeacherDashboard/)
    assert.match(assessmentsRoute, /resolveClassIdForActor/)
    assert.match(assessmentsRoute, /listClassTeacherClassIds/)
  })

  it('shows administrators per-class subject counts instead of the catalogue', async () => {
    const overview = await source(
      '../src/pages/dashboard/DashboardOverviewPage.tsx',
    )
    const api = await source('../src/schools/api.ts')

    // The catalogue panel is gone; only the aggregate counts table remains.
    assert.doesNotMatch(overview, /Subject catalogue/)
    assert.doesNotMatch(overview, /listSubjects/)
    assert.match(overview, /getClassSubjectCounts/)
    assert.match(overview, /Subjects by class/)

    // The global subject update route was replaced by a class-scoped one, and
    // the administrator summary endpoint exposes counts only.
    assert.match(api, /export function getClassSubjectCounts/)
    assert.match(api, /export function updateClassSubject/)
    assert.doesNotMatch(api, /export function updateSubject\(/)
  })

  it('gives every school role a read-only calendar and no manual calendar API', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')
    const api = await source('../src/schools/api.ts')
    const page = await source('../src/pages/dashboard/CalendarPage.tsx')

    assert.match(
      layout,
      /to: '\/dashboard\/calendar'[\s\S]{0,120}roles: ALL_SCHOOL_ROLES/,
    )
    assert.doesNotMatch(layout, /Academic calendar/)
    assert.match(api, /export function getSchoolCalendar/)
    assert.doesNotMatch(api, /createAcademicYear|updateAcademicYear/)
    assert.doesNotMatch(api, /createAcademicTerm|updateAcademicTerm/)
    assert.doesNotMatch(api, /activateAcademicYear|activateAcademicTerm/)
    assert.match(page, /getSchoolCalendar/)
    assert.doesNotMatch(page, /createAcademicYear|createAcademicTerm/)
    assert.doesNotMatch(page, /onSubmit/)
  })

  it('limits terminal reports to school administrators', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')
    const app = await source('../src/App.tsx')

    // Reports navigation and both report routes are administrator-only. Class
    // and subject teachers never see a terminal report entry point.
    assert.match(
      layout,
      /to: '\/dashboard\/reports'[\s\S]{0,120}roles: ADMIN_ROLES/,
    )
    assert.doesNotMatch(layout, /Released reports/)
    assert.match(
      app,
      /path="reports"[\s\S]{0,220}<SchoolAdminRoute>/,
    )
    assert.match(
      app,
      /path="reports\/cards\/:cardId"[\s\S]{0,220}<SchoolAdminRoute>/,
    )
    assert.doesNotMatch(
      app,
      /path="reports"[\s\S]{0,220}<FullSchoolMemberRoute>/,
    )
  })

  it('runs the term report request workflow without payment prompts', async () => {
    const schoolPage = await source('../src/pages/dashboard/ReportsPage.tsx')
    const platformPage = await source(
      '../src/pages/platform/PlatformReportsPage.tsx',
    )
    const api = await source('../src/reports/api.ts')

    // The school submits one term request and later prints or downloads only
    // released reports, including a merged class collection.
    assert.match(schoolPage, /submitReportRequest/)
    assert.match(schoolPage, /getReportRequest/)
    assert.match(schoolPage, /fetchClassCollection/)
    assert.match(schoolPage, /Request term reports/)
    assert.match(schoolPage, /Download class collection/)

    // Platform generation and retry are the only operational actions; there is
    // no platform academic approval, manual release or payment step.
    assert.match(platformPage, /generatePlatformReportBatch/)
    assert.match(platformPage, /retryPlatformReportBatch/)
    assert.match(platformPage, /Generate Reports/)
    assert.doesNotMatch(platformPage, /verifyPayment|paymentReference|invoiceId/)
    assert.doesNotMatch(platformPage, /paidMinor|outstandingMinor|INVOICE_/)
    assert.doesNotMatch(platformPage, /approvePlatformReportBatch/)
    assert.doesNotMatch(platformPage, /rejectPlatformReportBatch/)
    assert.doesNotMatch(platformPage, /releasePlatformReportBatch/)
    assert.doesNotMatch(platformPage, /queuePlatformReportBatch/)
    assert.doesNotMatch(platformPage, /holdPlatformReportBatch/)
    assert.doesNotMatch(platformPage, /returnPlatformReportBatch/)
    assert.doesNotMatch(platformPage, /unholdPlatformReportBatch/)

    assert.match(api, /export function fetchClassCollection/)
    assert.match(api, /export function submitReportRequest/)
    assert.match(api, /export function generatePlatformReportBatch/)
    assert.match(api, /export function retryPlatformReportBatch/)
    assert.doesNotMatch(api, /export function approvePlatformReportBatch/)
    assert.doesNotMatch(api, /export function rejectPlatformReportBatch/)
    assert.doesNotMatch(api, /export function releasePlatformReportBatch/)
  })

  it('hides the four requested sections from the administrator overview only', async () => {
    const overview = await source(
      '../src/pages/dashboard/DashboardOverviewPage.tsx',
    )

    assert.doesNotMatch(overview, /Request status/i)
    assert.doesNotMatch(overview, /Teaching staff/i)
    assert.doesNotMatch(overview, /Class registration instructions/i)
    assert.doesNotMatch(overview, /Academic years and terms/i)
    assert.doesNotMatch(overview, /Registered teachers/)
    assert.doesNotMatch(overview, /Active academic period/)
    assert.doesNotMatch(overview, /Read-only academic overview/)

    // The remaining administrator overview content is untouched.
    assert.match(overview, /Subjects by class/)
    assert.match(overview, /School profile/)
  })

  it('keeps the hidden overview features on their dedicated pages and routes', async () => {
    const app = await source('../src/App.tsx')
    const layout = await source('../src/components/DashboardLayout.tsx')
    const reports = await source('../src/pages/dashboard/ReportsPage.tsx')
    const teachers = await source('../src/pages/dashboard/TeachersPage.tsx')
    const calendar = await source('../src/pages/dashboard/CalendarPage.tsx')

    assert.match(
      layout,
      /to: '\/dashboard\/teachers'[\s\S]{0,120}roles: ADMIN_ROLES/,
    )
    assert.match(
      layout,
      /to: '\/dashboard\/calendar'[\s\S]{0,120}roles: ALL_SCHOOL_ROLES/,
    )
    assert.match(
      layout,
      /to: '\/dashboard\/reports'[\s\S]{0,120}roles: ADMIN_ROLES/,
    )
    assert.match(app, /path="teachers"[\s\S]{0,220}<SchoolAdminRoute>/)
    assert.match(app, /path="calendar"[\s\S]{0,220}<FullSchoolMemberRoute>/)
    assert.match(app, /path="reports"[\s\S]{0,220}<SchoolAdminRoute>/)

    assert.match(reports, /Request status/)
    // The Teaching staff roster card is not rendered on any dashboard surface.
    assert.doesNotMatch(teachers, /Teaching staff/)
    assert.doesNotMatch(teachers, /registrations never grant platform administration/)
    // Teacher management still lives on the dedicated page and route.
    assert.match(teachers, /Active assignments/)
    assert.match(teachers, /registerClassWithTeacher/)
    assert.match(calendar, /Academic years and terms/)
  })

  it('gives school administrators academic review and removes it from the platform', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')
    const platformLayout = await source('../src/components/PlatformLayout.tsx')
    const app = await source('../src/App.tsx')

    // The school administrator owns acceptance; teachers can view submissions
    // but never see the review queue.
    assert.match(
      layout,
      /to: '\/dashboard\/assessments\/review'[\s\S]{0,120}roles: ADMIN_ROLES/,
    )
    assert.match(
      layout,
      /to: '\/dashboard\/assessments\/submissions'[\s\S]{0,140}'SCHOOL_ADMIN'/,
    )
    assert.match(
      app,
      /path="assessments\/review"[\s\S]{0,220}<SchoolAdminRoute>/,
    )

    // The platform console exposes accepted requests and one Generate Reports
    // action, with no academic-review or separate generate screen.
    assert.match(platformLayout, /Report requests/)
    assert.doesNotMatch(platformLayout, /Academic review/)
    assert.doesNotMatch(platformLayout, /Generate reports/)
    assert.doesNotMatch(platformLayout, /Reports & release/)
    assert.doesNotMatch(app, /path="assessments" element=\{<PlatformAssessmentsPage/)
    assert.doesNotMatch(app, /path="reports\/generate"/)
  })
})
