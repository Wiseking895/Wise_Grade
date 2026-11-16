import {
  BookOpen,
  CalendarDays,
  GraduationCap,
  School,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROLE_LABELS } from '../../auth/types'
import { useAuth } from '../../auth/use-auth'
import ClassSubjectsManager from '../../components/ClassSubjectsManager'
import {
  Badge,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import { formatDate, statusLabel } from '../../lib/format'
import { useSchool } from '../../schools/use-school'
import {
  getClassDashboard,
  getClassSubjectCounts,
  listAcademicYears,
  listClassSubjectTeacherAssignments,
  listClassSubjects,
  listClasses,
  listPupils,
  listTeachers,
  getSchoolProfile,
} from '../../schools/api'
import type {
  AcademicYear,
  ClassDashboardClass,
  ClassSubject,
  ClassSubjectCount,
  Pupil,
  SchoolClass,
  SchoolProfile,
  SubjectTeacherAssignment,
} from '../../schools/types'

interface ClassOverview {
  cls: SchoolClass
  subjects: ClassSubject[]
  assignments: SubjectTeacherAssignment[]
}

interface OverviewData {
  profile: SchoolProfile
  years: AcademicYear[]
  classes: SchoolClass[]
  classDetails: ClassOverview[]
  pupils: Pupil[]
  pupilTotal: number
  classSubjectCounts: ClassSubjectCount[]
  teachers: number | null
}

function StatCard({
  label,
  value,
  icon: Icon,
  to,
}: {
  label: string
  value: number
  icon: LucideIcon
  to?: string
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
            {label}
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gradely-navy">
            {value}
          </p>
        </div>
        <span className="rounded-xl bg-gradely-blue/10 p-2.5 transition-colors group-hover:bg-gradely-blue/15">
          <Icon aria-hidden="true" className="size-5 text-gradely-blue" />
        </span>
      </div>
    </>
  )

  const className =
    'group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md'

  return to ? (
    <Link to={to} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  )
}

export default function DashboardOverviewPage() {
  const { role, isSubjectSession } = useSchool()

  if (role === 'CLASS_TEACHER' || isSubjectSession) {
    return <ClassDashboard />
  }

  return <GeneralDashboard />
}

function GeneralDashboard() {
  const { schoolId, membership, isAdmin, role } = useSchool()
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const [profile, years, classes, pupils, subjectCounts, teachers] =
        await Promise.all([
          getSchoolProfile(schoolId),
          listAcademicYears(schoolId),
          listClasses(schoolId),
          listPupils(schoolId, { page: 1, pageSize: 50 }),
          isAdmin
            ? getClassSubjectCounts(schoolId)
            : Promise.resolve({ classSubjectCounts: [] as ClassSubjectCount[] }),
          isAdmin ? listTeachers(schoolId) : Promise.resolve(null),
        ])

      const classDetails = isAdmin
        ? []
        : await Promise.all(
            classes.classes.map(async (cls) => {
              const [classSubjects, assignments] = await Promise.all([
                listClassSubjects(schoolId, cls.id),
                listClassSubjectTeacherAssignments(schoolId, cls.id),
              ])

              return {
                cls,
                subjects: classSubjects.subjects.filter(
                  (item) => item.isActive,
                ),
                assignments: assignments.assignments,
              }
            }),
          )

      setError(null)
      setData({
        profile: profile.school,
        years: years.academicYears,
        classes: classes.classes,
        classDetails,
        pupils: pupils.pupils,
        pupilTotal: pupils.total,
        classSubjectCounts: subjectCounts.classSubjectCounts,
        teachers: teachers ? teachers.teachers.length : null,
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the school overview.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, isAdmin])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (!membership) return null

  const visibleAssignments =
    data?.classDetails.flatMap((detail) =>
      role === 'SUBJECT_TEACHER'
        ? detail.assignments.filter(
            (assignment) => assignment.membershipId === membership.id,
          )
        : detail.assignments,
    ) ?? []

  const classSubjectTotal = isAdmin
    ? (data?.classSubjectCounts.reduce(
        (total, item) => total + item.subjectCount,
        0,
      ) ?? 0)
    : (data?.classDetails.reduce(
        (total, detail) =>
          total +
          (role === 'SUBJECT_TEACHER'
            ? detail.assignments.filter(
                (assignment) => assignment.membershipId === membership.id,
              ).length
            : detail.subjects.length),
        0,
      ) ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${membership.schoolName}`}
        description={`You are signed in as ${ROLE_LABELS[membership.role]}. This dashboard shows live data from your school's Wise Grade workspace.`}
        actions={
          <Badge tone={membership.status === 'ACTIVE' ? 'success' : 'warning'}>
            {statusLabel(membership.status)} membership
          </Badge>
        }
      />

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            setLoading(true)
            setError(null)
            void load()
          }}
        />
      ) : null}
      {loading ? <LoadingPanel label="Loading school overview…" /> : null}

      {!loading && data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={isAdmin ? 'Active classes' : 'My classes'}
              value={data.classes.length}
              icon={Users}
              to={isAdmin ? undefined : '/dashboard/classes'}
            />
            <StatCard
              label={isAdmin ? 'Active pupils' : 'Pupils in my classes'}
              value={data.pupilTotal}
              icon={UserRound}
              to={isAdmin || role === 'SUBJECT_TEACHER' ? undefined : '/dashboard/pupils'}
            />
            <StatCard
              label={
                role === 'SUBJECT_TEACHER'
                  ? 'My class subjects'
                  : 'Class subjects'
              }
              value={classSubjectTotal}
              icon={BookOpen}
              to={isAdmin ? undefined : '/dashboard/classes'}
            />
            {data.teachers === null ? (
              <StatCard
                label="Subject-teacher assignments"
                value={visibleAssignments.length}
                icon={GraduationCap}
                to="/dashboard/classes"
              />
            ) : null}
          </div>

          <div className="grid gap-6">
            <Panel>
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-gradely-blue/10 p-2.5">
                  <School
                    aria-hidden="true"
                    className="size-5 text-gradely-blue"
                  />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-gradely-text">
                    School profile
                  </h2>
                  <p className="mt-1 truncate text-sm text-gradely-muted">
                    {data.profile.name}
                  </p>
                </div>
              </div>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-gradely-muted">
                    Contact email
                  </dt>
                  <dd className="truncate text-gradely-text">
                    {data.profile.email ?? 'Not configured'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-gradely-muted">
                    Phone
                  </dt>
                  <dd className="text-gradely-text">
                    {data.profile.phone ?? 'Not configured'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-gradely-muted">
                    School timezone
                  </dt>
                  <dd className="text-gradely-text">{data.profile.timezone}</dd>
                </div>
              </dl>
              {isAdmin ? (
                <Link
                  to="/dashboard/school"
                  className="mt-5 inline-flex text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                >
                  Edit school profile
                </Link>
              ) : null}
            </Panel>
          </div>

          {isAdmin ? (
            <>
              <Panel className="overflow-hidden p-0">
                <div className="px-4 pt-4">
                  <h2 className="text-lg font-bold text-gradely-text">
                    Subjects by class
                  </h2>
                  <p className="mt-1 pb-4 text-sm text-gradely-muted">
                    Number of subjects each class currently offers. Subject
                    details are managed by the assigned class teacher.
                  </p>
                </div>
                {data.classSubjectCounts.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-gradely-muted">
                    No classes registered yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-y border-slate-200 bg-gradely-light text-xs font-semibold text-gradely-muted uppercase">
                        <tr>
                          <th scope="col" className="px-4 py-2.5">
                            Class
                          </th>
                          <th scope="col" className="px-4 py-2.5">
                            Class teacher
                          </th>
                          <th scope="col" className="px-4 py-2.5 text-right">
                            Number of subjects
                          </th>
                          <th scope="col" className="px-4 py-2.5">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.classSubjectCounts.map((item) => (
                          <tr key={item.classId}>
                            <td className="px-4 py-3 font-semibold text-gradely-text">
                              {item.className}
                            </td>
                            <td className="px-4 py-3 text-gradely-muted">
                              {item.classTeacherName ?? 'Unassigned'}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-gradely-text">
                              {item.subjectCount}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                tone={item.isArchived ? 'warning' : 'success'}
                              >
                                {item.isArchived ? 'Archived' : 'Active'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel className="overflow-hidden p-0">
                <div className="px-4 pt-4">
                  <h2 className="text-lg font-bold text-gradely-text">
                    Pupils
                  </h2>
                  <p className="mt-1 pb-4 text-sm text-gradely-muted">
                    Read-only pupil information. Registration and updates are
                    handled by the assigned class teacher.
                  </p>
                </div>
                {data.pupils.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-gradely-muted">
                    No pupils registered yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="border-y border-slate-200 bg-gradely-light text-xs font-semibold text-gradely-muted uppercase">
                        <tr>
                          <th scope="col" className="px-4 py-2.5">
                            Pupil
                          </th>
                          <th scope="col" className="px-4 py-2.5">
                            Admission number
                          </th>
                          <th scope="col" className="px-4 py-2.5">
                            Class
                          </th>
                          <th scope="col" className="px-4 py-2.5">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.pupils.map((pupil) => (
                          <tr key={pupil.id}>
                            <td className="px-4 py-3 font-semibold text-gradely-text">
                              {pupil.firstName} {pupil.lastName}
                            </td>
                            <td className="px-4 py-3 text-gradely-muted">
                              {pupil.admissionNumber}
                            </td>
                            <td className="px-4 py-3 text-gradely-muted">
                              {pupil.currentClassName ?? '—'}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                tone={
                                  pupil.status === 'ACTIVE'
                                    ? 'success'
                                    : 'warning'
                                }
                              >
                                {statusLabel(pupil.status)}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.pupilTotal > data.pupils.length ? (
                  <p className="px-4 py-3 text-xs text-gradely-muted">
                    Showing {data.pupils.length} of {data.pupilTotal} pupils.
                  </p>
                ) : null}
              </Panel>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gradely-text">
                    {role === 'SUBJECT_TEACHER'
                      ? 'My assigned classes and subjects'
                      : 'My class'}
                  </h2>
                  <p className="mt-1 text-sm text-gradely-muted">
                    {role === 'SUBJECT_TEACHER'
                      ? 'Only the exact class subjects assigned to you are shown. Score entry is limited to these assignments.'
                      : 'Your assigned class, its subjects and subject-teacher assignments.'}
                  </p>
                </div>
                <Link
                  to="/dashboard/classes"
                  className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                >
                  Manage class subjects
                </Link>
              </div>

              {data.classDetails.length === 0 ? (
                <Panel>
                  <p className="text-sm text-gradely-muted">
                    No class has been assigned to you yet.
                  </p>
                </Panel>
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  {data.classDetails.map((detail) => {
                    const relevantAssignments =
                      role === 'SUBJECT_TEACHER'
                        ? detail.assignments.filter(
                            (assignment) =>
                              assignment.membershipId === membership.id,
                          )
                        : detail.assignments

                    if (
                      role === 'SUBJECT_TEACHER' &&
                      relevantAssignments.length === 0
                    ) {
                      return null
                    }

                    return (
                      <Panel key={detail.cls.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-base font-bold text-gradely-text">
                              {detail.cls.name}
                            </h3>
                            <p className="text-xs text-gradely-muted">
                              {detail.cls.level ?? 'School-wide'}
                            </p>
                          </div>
                          <Badge tone="success">
                            {role === 'SUBJECT_TEACHER'
                              ? `${relevantAssignments.length} assigned`
                              : `${detail.subjects.length} subjects`}
                          </Badge>
                        </div>

                        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                          {(role === 'SUBJECT_TEACHER'
                            ? relevantAssignments.map((assignment) => ({
                                subjectId: assignment.subjectId,
                                subjectName: assignment.subjectName,
                              }))
                            : detail.subjects.map((subject) => ({
                                subjectId: subject.subjectId,
                                subjectName: subject.subjectName,
                              }))
                          ).map((subject) => {
                            const teacherNames = detail.assignments
                              .filter(
                                (assignment) =>
                                  assignment.subjectId === subject.subjectId,
                              )
                              .map(
                                (assignment) =>
                                  `${assignment.firstName} ${assignment.lastName}`,
                              )

                            return (
                              <li
                                key={subject.subjectId}
                                className="px-4 py-3 text-sm"
                              >
                                <p className="font-semibold text-gradely-text">
                                  {subject.subjectName}
                                </p>
                                <p className="mt-0.5 text-xs text-gradely-muted">
                                  {role === 'SUBJECT_TEACHER'
                                    ? 'Assigned to you'
                                    : teacherNames.length > 0
                                      ? `Subject teacher: ${teacherNames.join(', ')}`
                                      : 'Unassigned — the class teacher remains responsible'}
                                </p>
                              </li>
                            )
                          })}
                        </ul>

                        {role === 'CLASS_TEACHER' ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                              to="/dashboard/pupils"
                              className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                            >
                              Manage pupils
                            </Link>
                            <Link
                              to="/dashboard/assessments/scores"
                              className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                            >
                              Enter scores
                            </Link>
                          </div>
                        ) : (
                          <div className="mt-4">
                            <Link
                              to="/dashboard/assessments/scores"
                              className="text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                            >
                              Enter authorized scores
                            </Link>
                          </div>
                        )}
                      </Panel>
                    )
                  })}
                </div>
              )}

              {role === 'CLASS_TEACHER' ? (
                <Panel className="overflow-hidden p-0">
                  <div className="px-4 pt-4">
                    <h2 className="text-lg font-bold text-gradely-text">
                      Pupils in my class
                    </h2>
                    <p className="mt-1 pb-4 text-sm text-gradely-muted">
                      You can register and update pupils only in your assigned
                      class.
                    </p>
                  </div>
                  {data.pupils.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-gradely-muted">
                      No pupils registered in your class yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-sm">
                        <thead className="border-y border-slate-200 bg-gradely-light text-xs font-semibold text-gradely-muted uppercase">
                          <tr>
                            <th scope="col" className="px-4 py-2.5">
                              Pupil
                            </th>
                            <th scope="col" className="px-4 py-2.5">
                              Admission number
                            </th>
                            <th scope="col" className="px-4 py-2.5">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.pupils.map((pupil) => (
                            <tr key={pupil.id}>
                              <td className="px-4 py-3 font-semibold text-gradely-text">
                                {pupil.firstName} {pupil.lastName}
                              </td>
                              <td className="px-4 py-3 text-gradely-muted">
                                {pupil.admissionNumber}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  tone={
                                    pupil.status === 'ACTIVE'
                                      ? 'success'
                                      : 'warning'
                                  }
                                >
                                  {statusLabel(pupil.status)}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  )
}

/**
 * Dedicated Class Dashboard for an authenticated Class Teacher.
 *
 * The assigned class, its subjects and its active pupil roll come from one
 * authoritative backend response. No class selector is shown for a teacher with
 * a single assignment; a selector appears only when the teacher genuinely has
 * multiple active class assignments.
 */
function ClassDashboard() {
  const { schoolId, membership, isSubjectSession, subjectSession } = useSchool()
  const { user } = useAuth()
  const [classes, setClasses] = useState<ClassDashboardClass[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [subjectsOpen, setSubjectsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const [dashboardResponse, yearResponse] = await Promise.all([
        getClassDashboard(schoolId),
        listAcademicYears(schoolId),
      ])

      setClasses(dashboardResponse.classes)
      setYears(yearResponse.academicYears)
      setSelectedClassId((current) => {
        if (
          current &&
          dashboardResponse.classes.some((item) => item.classId === current)
        ) {
          return current
        }

        return dashboardResponse.classes[0]?.classId ?? ''
      })
      setSelectedSubjectId((current) => {
        const firstClass = dashboardResponse.classes[0]

        if (!firstClass) return ''
        if (
          current &&
          firstClass.subjects.some((item) => item.subjectId === current)
        ) {
          return current
        }

        return firstClass.subjects[0]?.subjectId ?? ''
      })
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load your class dashboard.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const activeClass =
    classes.find((item) => item.classId === selectedClassId) ??
    classes[0] ??
    null
  const subjects = activeClass?.subjects ?? []
  const selectedSubject =
    subjects.find((item) => item.subjectId === selectedSubjectId) ?? null
  const teacherName = subjectSession
    ? `${subjectSession.teacher.firstName} ${subjectSession.teacher.lastName}`.trim()
    : user
      ? `${user.firstName} ${user.lastName}`.trim()
      : ''

  const currentYear = years.find((year) => year.isCurrent) ?? null
  const currentTerm =
    currentYear?.terms.find((term) => term.isCurrent) ??
    years.flatMap((year) => year.terms).find((term) => term.isCurrent) ??
    null

  useEffect(() => {
    if (!activeClass) return

    if (
      !activeClass.subjects.some(
        (subject) => subject.subjectId === selectedSubjectId,
      )
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedSubjectId(activeClass.subjects[0]?.subjectId ?? '')
    }
  }, [activeClass, selectedSubjectId])

  if (!membership) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Class Dashboard"
        description={
          activeClass
            ? isSubjectSession
              ? `Welcome, ${teacherName || 'Subject Teacher'}. You have access to ${activeClass.className} ${subjectSession?.subjectName ?? 'subject'} only.`
              : `Welcome, ${teacherName || 'Class Teacher'}. You are responsible for ${activeClass.className}.`
            : isSubjectSession
              ? 'Your assigned class and subject will appear here while the access code is active.'
              : 'Your assigned class, its subjects and its pupil roll will appear here.'
        }
        actions={
          <Badge tone="info">
            {isSubjectSession ? 'Subject Teacher' : 'Class Teacher'}
          </Badge>
        }
      />

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            setLoading(true)
            setError(null)
            void load()
          }}
        />
      ) : null}
      {loading ? <LoadingPanel label="Loading your class dashboard…" /> : null}

      {!loading && !error && classes.length === 0 ? (
        <Panel>
          <h2 className="text-lg font-bold text-gradely-text">
            No class assigned yet
          </h2>
          <p className="mt-1 text-sm text-gradely-muted">
            {isSubjectSession
              ? 'This access code is no longer linked to an active class and subject assignment. Ask your class teacher for a new code.'
              : 'No active class assignment is linked to your account. Ask a school administrator to assign you to a class.'}
          </p>
        </Panel>
      ) : null}

      {!loading && activeClass ? (
        <>
          <Panel className="overflow-hidden border-gradely-blue/20 bg-gradely-blue/5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold tracking-wide text-gradely-muted uppercase">
                  Assigned class
                </p>
                <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-gradely-navy">
                  {activeClass.className}
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  {activeClass.level ?? 'School-wide'}
                  {' · '}
                  {activeClass.academicYearName ?? 'No academic year'}
                  {' · '}
                  {isSubjectSession
                    ? `Subject teacher: ${teacherName || 'You'}`
                    : `Responsible Class Teacher: ${teacherName || 'You'}`}
                </p>
              </div>
              {!isSubjectSession ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSubjectsOpen(true)}
                  >
                    <BookOpen aria-hidden="true" className="size-4" />
                    Manage subjects
                  </Button>
                  <Link
                    to="/dashboard/pupils"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-gradely-text transition-colors hover:bg-white"
                  >
                    <UserRound aria-hidden="true" className="size-4" />
                    Manage pupils
                  </Link>
                </div>
              ) : null}
            </div>

            {classes.length > 1 ? (
              <div className="mt-5 max-w-sm">
                <SelectField
                  label="Assigned class"
                  value={activeClass.classId}
                  onChange={(event) => {
                    setSelectedClassId(event.target.value)
                    setSelectedSubjectId('')
                  }}
                >
                  {classes.map((item) => (
                    <option key={item.classId} value={item.classId}>
                      {item.className}
                    </option>
                  ))}
                </SelectField>
                <p className="mt-1 text-xs text-gradely-muted">
                  You have multiple active class assignments. Choose the class
                  you want to manage.
                </p>
              </div>
            ) : null}
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Pupils on Roll"
              value={activeClass.pupilsOnRoll}
              icon={UserRound}
              to={isSubjectSession ? undefined : '/dashboard/pupils'}
            />
            <StatCard
              label="Subjects offered"
              value={subjects.length}
              icon={BookOpen}
            />
            <StatCard
              label="Subject teachers assigned"
              value={
                subjects.filter((subject) => subject.subjectTeacherName).length
              }
              icon={GraduationCap}
            />
            <StatCard
              label="Active class assignments"
              value={classes.length}
              icon={Users}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gradely-text">
                    Subject register
                  </h2>
                  <p className="mt-1 text-sm text-gradely-muted">
                    {isSubjectSession
                      ? 'Open the assessment register for your assigned subject.'
                      : `Choose one of ${activeClass.className}'s subjects to open its assessment register.`}
                  </p>
                </div>
                {!isSubjectSession ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSubjectsOpen(true)}
                  >
                    Manage subjects
                  </Button>
                ) : null}
              </div>

              {subjects.length === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-4">
                  <p className="text-sm font-semibold text-gradely-text">
                    No subjects registered yet
                  </p>
                  <p className="mt-1 text-sm text-gradely-muted">
                    {isSubjectSession
                      ? 'Your assigned subject is not currently active. Ask your class teacher to check the class subject.'
                      : `Register subjects for ${activeClass.className} in the class dashboard before entering assessment scores.`}
                  </p>
                  {!isSubjectSession ? (
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={() => setSubjectsOpen(true)}
                    >
                      <BookOpen aria-hidden="true" className="size-4" />
                      Register subject
                    </Button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="mt-5 max-w-md">
                    <SelectField
                      label="Subject"
                      value={selectedSubjectId}
                      onChange={(event) =>
                        setSelectedSubjectId(event.target.value)
                      }
                    >
                      {subjects.map((subject) => (
                        <option
                          key={subject.subjectId}
                          value={subject.subjectId}
                        >
                          {subject.subjectName}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  {selectedSubject ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-gradely-light p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-base font-bold text-gradely-text">
                            {selectedSubject.subjectName}
                          </p>
                          <p className="text-xs text-gradely-muted">
                            {selectedSubject.subjectCode ?? 'No subject code'}
                          </p>
                        </div>
                        {selectedSubject.readOnly ? (
                          <Badge tone="info">Read-only for you</Badge>
                        ) : (
                          <Badge tone="success">You can enter scores</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-gradely-muted">
                        {isSubjectSession
                          ? 'You are the assigned subject teacher for this subject. You can enter, save and submit scores for this class only.'
                          : selectedSubject.subjectTeacherName
                            ? `Subject teacher: ${selectedSubject.subjectTeacherName}. You can view this teacher's scores but cannot edit them.`
                            : 'No subject teacher is assigned. You remain responsible for entering this subject’s scores.'}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <Link
                          to={`/dashboard/assessments/scores?subjectId=${selectedSubject.subjectId}`}
                          className="inline-flex text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                        >
                          Open assessment register
                        </Link>
                        {isSubjectSession ? (
                          <Link
                            to="/dashboard/assessments/submissions"
                            className="inline-flex text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                          >
                            View submissions
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </Panel>

            <Panel>
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-gradely-gold/15 p-2.5">
                  <CalendarDays
                    aria-hidden="true"
                    className="size-5 text-[#7a5400]"
                  />
                </span>
                <div>
                  <h2 className="text-base font-bold text-gradely-text">
                    Academic period
                  </h2>
                  <p className="mt-1 text-sm text-gradely-muted">
                    The current year and term used by enrollment and assessment
                    workflows.
                  </p>
                </div>
              </div>

              {currentYear ? (
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold text-gradely-muted">
                      Academic year
                    </dt>
                    <dd className="font-semibold text-gradely-text">
                      {currentYear.name}
                    </dd>
                    <dd className="text-xs whitespace-nowrap text-gradely-muted">
                      {formatDate(currentYear.startsOn)} –{' '}
                      {formatDate(currentYear.endsOn)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-gradely-muted">
                      Current term
                    </dt>
                    <dd className="font-semibold text-gradely-text">
                      {currentTerm?.name ?? 'No term activated'}
                    </dd>
                    {currentTerm ? (
                      <dd className="text-xs whitespace-nowrap text-gradely-muted">
                        {formatDate(currentTerm.startsOn)} –{' '}
                        {formatDate(currentTerm.endsOn)}
                      </dd>
                    ) : null}
                  </div>
                </dl>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                  No academic year is active yet. Wise Grade initialises the
                  calendar automatically.
                </p>
              )}

              {!isSubjectSession ? (
                <Link
                  to="/dashboard/calendar"
                  className="mt-4 inline-flex text-sm font-semibold text-gradely-navy underline decoration-gradely-blue/40 underline-offset-2 hover:text-gradely-blue"
                >
                  View academic calendar
                </Link>
              ) : null}
            </Panel>
          </div>

          {!isSubjectSession ? (
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold tracking-wide text-gradely-muted uppercase">
                    Pupils on Roll
                  </p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-gradely-navy">
                    {activeClass.pupilsOnRoll}
                  </p>
                  <p className="mt-1 text-sm text-gradely-muted">
                    Active pupils currently registered in{' '}
                    {activeClass.className}. Withdrawn, transferred, inactive and
                    archived pupils are excluded.
                  </p>
                </div>
                <Link
                  to="/dashboard/pupils"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gradely-navy/90"
                >
                  <UserRound aria-hidden="true" className="size-4" />
                  Manage pupils
                </Link>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}

      {!isSubjectSession && schoolId && activeClass ? (
        <ClassSubjectsManager
          open={subjectsOpen}
          onClose={() => setSubjectsOpen(false)}
          schoolId={schoolId}
          classId={activeClass.classId}
          className={activeClass.className}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  )
}
