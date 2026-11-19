import { Plus, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import FormField from '../../components/FormField'
import {
  AccessDenied,
  Button,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import { useSchool } from '../../schools/use-school'
import { ApiError } from '../../lib/api'
import {
  listAcademicYears,
  listTeacherAssignments,
  registerClassWithTeacher,
} from '../../schools/api'
import {
  fieldFeedback,
  type FieldFeedback,
} from '../../schools/validation-feedback'
import type {
  AcademicYear,
  ClassTeacherAssignment,
  TeacherAssignments,
} from '../../schools/types'

interface RegisterFormState {
  className: string
  level: string
  academicYearId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  initialPassword: string
}

const EMPTY_REGISTER: RegisterFormState = {
  className: '',
  level: '',
  academicYearId: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  initialPassword: '',
}

/**
 * Canonical Ghanaian basic-school classes. Registering a class teacher creates
 * or reuses the matching class in one transaction on the backend.
 */
const CLASS_NAME_OPTIONS = [
  'Creche',
  'Nursery 1',
  'Nursery 2',
  'KG 1',
  'KG 2',
  'Basic 1',
  'Basic 2',
  'Basic 3',
  'Basic 4',
  'Basic 5',
  'Basic 6',
  'JHS 1',
  'JHS 2',
  'JHS 3',
] as const

const CLASS_LEVEL_OPTIONS = [
  'Creche',
  'Nursery',
  'Kindergarten',
  'Lower Primary',
  'Upper Primary',
  'Junior High',
] as const

/**
 * School administrators register a class together with its class teacher.
 * Everything else on this page is read-only: subjects and pupils belong to the
 * class teacher, and subject teachers are invited from the class page.
 */
export default function TeachersPage() {
  const { schoolId, isAdmin } = useSchool()
  const [assignments, setAssignments] = useState<TeacherAssignments>({
    classTeachers: [],
    subjectTeachers: [],
  })
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerForm, setRegisterForm] =
    useState<RegisterFormState>(EMPTY_REGISTER)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [registerDetails, setRegisterDetails] = useState<FieldFeedback[]>([])
  const [registerBusy, setRegisterBusy] = useState(false)

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const [assignmentResponse, yearResponse] = await Promise.all([
        listTeacherAssignments(schoolId),
        listAcademicYears(schoolId),
      ])
      setError(null)
      setAssignments(assignmentResponse.assignments)
      setAcademicYears(yearResponse.academicYears)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load teacher assignments.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  function resetRegisterForm() {
    setRegisterForm(EMPTY_REGISTER)
    setRegisterError(null)
    setRegisterDetails([])
  }

  function updateRegister(patch: Partial<RegisterFormState>) {
    setRegisterForm((current) => ({ ...current, ...patch }))
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId) return

    setRegisterBusy(true)
    setRegisterError(null)
    setRegisterDetails([])

    try {
      const result = await registerClassWithTeacher(schoolId, {
        className: registerForm.className.trim(),
        level: registerForm.level.trim() || null,
        academicYearId: registerForm.academicYearId || null,
        teacher: {
          // Match the backend contract exactly: names and email are trimmed, so
          // a stray leading or trailing space cannot fail a later rule (such as
          // the two-character name minimum).
          firstName: registerForm.firstName.trim(),
          lastName: registerForm.lastName.trim(),
          email: registerForm.email.trim(),
          phone: registerForm.phone.trim() || null,
          initialPassword: registerForm.initialPassword,
        },
      })
      setSuccess(
        `${result.teacher.firstName} ${result.teacher.lastName} is registered as the class teacher for ${result.class.name}. Their login email and temporary password were emailed to ${result.teacher.email}. They must choose a personal password before opening the class workspace.`,
      )
      setRegisterOpen(false)
      resetRegisterForm()
      await load()
    } catch (cause) {
      setRegisterError(
        cause instanceof Error
          ? cause.message
          : 'Could not register the class and class teacher.',
      )
      // The API returns one entry per rejected field. Showing them next to the
      // alert turns "Validation failed" into an actionable message.
      setRegisterDetails(
        cause instanceof ApiError ? fieldFeedback(cause.details) : [],
      )
    } finally {
      setRegisterBusy(false)
    }
  }

  const activeClassTeacherByClass = new Map<string, ClassTeacherAssignment>()
  for (const assignment of assignments.classTeachers) {
    if (assignment.endedAt === null) {
      activeClassTeacherByClass.set(assignment.classId, assignment)
    }
  }

  const activeSubjectTeacherAssignments = assignments.subjectTeachers.filter(
    (assignment) => assignment.endedAt === null,
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes and teachers"
        description="Register a class together with its class teacher in one step. Class teachers then set up the subjects and pupils for their own class. All other class, teacher and assignment information here is read-only."
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                resetRegisterForm()
                setRegisterOpen(true)
              }}
            >
              <UserPlus aria-hidden="true" className="size-4" />
              Register class &amp; teacher
            </Button>
          ) : undefined
        }
      />

      {!isAdmin ? (
        <AccessDenied message="Only a school administrator can register classes and class teachers." />
      ) : (
        <>
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
          {success ? (
            <p
              role="status"
              className="rounded-xl border border-gradely-green/30 bg-gradely-green/10 px-4 py-3 text-sm font-medium text-[#137026]"
            >
              {success}
            </p>
          ) : null}
          {loading ? <LoadingPanel label="Loading teacher assignments…" /> : null}

          {!loading ? (
            <>
              <Panel>
                <h2 className="text-lg font-bold text-gradely-text">
                  Active assignments
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Class and subject teacher assignments are managed by the
                  class teacher. This view is read-only.
                </p>

                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                      Class teachers
                    </h3>
                    {activeClassTeacherByClass.size === 0 ? (
                      <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-gradely-muted">
                        No active class-teacher assignments.
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {[...activeClassTeacherByClass.values()].map(
                          (assignment) => (
                            <li
                              key={assignment.id}
                              className="px-3 py-2.5 text-sm"
                            >
                              <p className="font-semibold text-gradely-text">
                                {assignment.className}
                              </p>
                              <p className="text-xs text-gradely-muted">
                                {assignment.firstName} {assignment.lastName} ·{' '}
                                {assignment.email}
                              </p>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                      Subject teachers
                    </h3>
                    {activeSubjectTeacherAssignments.length === 0 ? (
                      <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-gradely-muted">
                        No active subject-teacher assignments.
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {activeSubjectTeacherAssignments.map((assignment) => (
                          <li
                            key={assignment.id}
                            className="px-3 py-2.5 text-sm"
                          >
                            <p className="font-semibold text-gradely-text">
                              {assignment.className} ·{' '}
                              {assignment.subjectName}
                            </p>
                            <p className="text-xs text-gradely-muted">
                              {assignment.firstName} {assignment.lastName} ·{' '}
                              {assignment.email}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Panel>
            </>
          ) : null}
        </>
      )}

      <Modal
        open={registerOpen}
        title="Register a class and class teacher"
        description="This creates or reuses the class and creates a controlled class-teacher account in one transaction. Subjects and pupils are set up by the class teacher afterwards."
        onClose={() => setRegisterOpen(false)}
        wide
      >
        <form
          onSubmit={(event) => void submitRegister(event)}
          className="space-y-5"
        >
          <section className="space-y-4">
            <h3 className="text-sm font-bold tracking-wide text-gradely-navy uppercase">
              Step 1 · Class information
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FormField
                  label="Class name"
                  value={registerForm.className}
                  onChange={(event) =>
                    updateRegister({ className: event.target.value })
                  }
                  list="class-name-options"
                  placeholder="e.g. Basic 1"
                  required
                  minLength={2}
                  maxLength={80}
                />
                <datalist id="class-name-options">
                  {CLASS_NAME_OPTIONS.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <SelectField
                label="Class level"
                value={registerForm.level}
                onChange={(event) =>
                  updateRegister({ level: event.target.value })
                }
              >
                <option value="">Use the default level</option>
                {CLASS_LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </SelectField>
            </div>
            <SelectField
              label="Academic year"
              value={registerForm.academicYearId}
              onChange={(event) =>
                updateRegister({ academicYearId: event.target.value })
              }
              hint="Leave as school-wide to reuse the existing default class for this class name."
            >
              <option value="">School-wide (no specific year)</option>
              {academicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                  {year.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </SelectField>
          </section>

          <section className="space-y-4 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-bold tracking-wide text-gradely-navy uppercase">
              Step 2 · Class teacher
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="First name"
                value={registerForm.firstName}
                onChange={(event) =>
                  updateRegister({ firstName: event.target.value })
                }
                required
                minLength={2}
                maxLength={80}
              />
              <FormField
                label="Last name"
                value={registerForm.lastName}
                onChange={(event) =>
                  updateRegister({ lastName: event.target.value })
                }
                required
                minLength={2}
                maxLength={80}
              />
            </div>
            <FormField
              label="Email address"
              type="email"
              value={registerForm.email}
              onChange={(event) =>
                updateRegister({ email: event.target.value })
              }
              required
            />
            <FormField
              label="Mobile number (optional)"
              type="tel"
              value={registerForm.phone}
              onChange={(event) =>
                updateRegister({ phone: event.target.value })
              }
              placeholder="e.g. 024 000 0000"
              maxLength={20}
            />
            <FormField
              label="Initial password"
              type="password"
              value={registerForm.initialPassword}
              onChange={(event) =>
                updateRegister({ initialPassword: event.target.value })
              }
              required
              minLength={10}
              maxLength={128}
              hint="We email these details to the class teacher. They must replace this temporary password at first sign-in before opening the class workspace."
            />
          </section>

          {registerError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <p>{registerError}</p>
              {registerDetails.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {registerDetails.map((detail) => (
                    <li key={`${detail.field}:${detail.message}`}>
                      <span className="font-semibold">{detail.label}:</span>{' '}
                      {detail.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRegisterOpen(false)}
              disabled={registerBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={registerBusy}
              disabled={
                registerForm.className.trim() === '' ||
                registerForm.firstName.trim() === '' ||
                registerForm.lastName.trim() === '' ||
                registerForm.email.trim() === '' ||
                registerForm.initialPassword.length < 10
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              Register class &amp; teacher
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
