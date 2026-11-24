import { Mail, Pencil, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react'
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
import { apiErrorMessage } from '../../lib/api-error-message'
import { ApiError } from '../../lib/api'
import {
  listAcademicYears,
  listClasses,
  listTeacherAssignments,
  listTeachers,
  registerClassWithTeacher,
  removeTeacherMembership,
  resendTeacherCredentials,
  restoreTeacherMembership,
  updateTeacher,
} from '../../schools/api'
import {
  fieldFeedback,
  type FieldFeedback,
} from '../../schools/validation-feedback'
import type {
  AcademicYear,
  ClassTeacherAssignment,
  OnboardingEmailStatus,
  SchoolClass,
  Teacher,
  TeacherAssignments,
  UpdateTeacherInput,
} from '../../schools/types'

interface RegisterFormState {
  className: string
  level: string
  academicYearId: string
  firstName: string
  lastName: string
  email: string
  phone: string
}

const EMPTY_REGISTER: RegisterFormState = {
  className: '',
  level: '',
  academicYearId: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
}

interface EditFormState {
  firstName: string
  lastName: string
  phone: string
  classId: string
}

const EMPTY_EDIT: EditFormState = {
  firstName: '',
  lastName: '',
  phone: '',
  classId: '',
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
 * Reports what actually happened to the onboarding email. A queued message is
 * not described as delivered, and a failed send points the administrator at the
 * resend action.
 */
function onboardingMessage(
  teacherName: string,
  email: string,
  status: OnboardingEmailStatus | undefined,
): string {
  if (status === 'sent') {
    return `${teacherName} is registered. The onboarding email to ${email} was accepted by the mail server; it contains their login details and a generated temporary password. Delivery to the inbox cannot be confirmed here. They must choose a personal password before opening the class workspace.`
  }

  if (status === 'queued') {
    return `${teacherName} is registered. The onboarding email to ${email} is queued for delivery. If it does not arrive, use Resend credentials.`
  }

  return `${teacherName} is registered, but the onboarding email to ${email} could not be sent. Use Resend credentials to generate and email a fresh temporary password.`
}

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
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerForm, setRegisterForm] =
    useState<RegisterFormState>(EMPTY_REGISTER)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [registerDetails, setRegisterDetails] = useState<FieldFeedback[]>([])
  const [registerBusy, setRegisterBusy] = useState(false)
  const [resendingMembershipId, setResendingMembershipId] = useState<
    string | null
  >(null)

  const [editing, setEditing] = useState<Teacher | null>(null)
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT)
  const [editError, setEditError] = useState<string | null>(null)
  const [editDetails, setEditDetails] = useState<FieldFeedback[]>([])
  const [editBusy, setEditBusy] = useState(false)

  const [removing, setRemoving] = useState<Teacher | null>(null)
  const [removeEmail, setRemoveEmail] = useState('')
  const [removeReason, setRemoveReason] = useState('')
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const [restoring, setRestoring] = useState<Teacher | null>(null)
  const [restoreEmail, setRestoreEmail] = useState('')
  const [restoreReason, setRestoreReason] = useState('')
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)

  const load = useCallback(async () => {
    if (!schoolId) return

    if (!isAdmin) {
      setLoading(false)
      return
    }

    try {
      const [assignmentResponse, yearResponse, teacherResponse, classResponse] =
        await Promise.all([
          listTeacherAssignments(schoolId),
          listAcademicYears(schoolId),
          listTeachers(schoolId),
          listClasses(schoolId),
        ])
      setError(null)
      setAssignments(assignmentResponse.assignments)
      setAcademicYears(yearResponse.academicYears)
      setTeachers(teacherResponse.teachers)
      setClasses(classResponse.classes)
    } catch (cause) {
      setError(
        apiErrorMessage(cause, 'Could not load teacher assignments.'),
      )
    } finally {
      setLoading(false)
    }
  }, [isAdmin, schoolId])

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
        },
      })
      setSuccess(
        onboardingMessage(
          `${result.teacher.firstName} ${result.teacher.lastName}`,
          result.teacher.email,
          result.onboardingEmail,
        ),
      )
      setRegisterOpen(false)
      resetRegisterForm()
      await load()
    } catch (cause) {
      setRegisterError(
        apiErrorMessage(
          cause,
          'Could not register the class and class teacher.',
        ),
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

  async function resendCredentials(
    assignment: ClassTeacherAssignment,
  ): Promise<void> {
    if (!schoolId || resendingMembershipId) return

    setResendingMembershipId(assignment.membershipId)
    setError(null)

    try {
      const result = await resendTeacherCredentials(
        schoolId,
        assignment.membershipId,
      )
      setSuccess(
        onboardingMessage(
          `${assignment.firstName} ${assignment.lastName}`,
          assignment.email,
          result.onboardingEmail,
        ),
      )
    } catch (cause) {
      setError(
        apiErrorMessage(
          cause,
          'Could not reissue the class teacher credentials.',
        ),
      )
    } finally {
      setResendingMembershipId(null)
    }
  }

  function currentClassIdFor(membershipId: string): string {
    return (
      assignments.classTeachers.find(
        (assignment) =>
          assignment.membershipId === membershipId &&
          assignment.endedAt === null,
      )?.classId ?? ''
    )
  }

  function openEdit(teacher: Teacher) {
    setEditing(teacher)
    setEditForm({
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      phone: teacher.phone ?? '',
      classId:
        teacher.role === 'CLASS_TEACHER'
          ? currentClassIdFor(teacher.membershipId)
          : '',
    })
    setEditError(null)
    setEditDetails([])
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId || !editing || editBusy) return

    const input: UpdateTeacherInput = {
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      phone: editForm.phone.trim() || null,
    }

    if (editing.role === 'CLASS_TEACHER' && editForm.classId) {
      const currentClassId = currentClassIdFor(editing.membershipId)

      if (editForm.classId !== currentClassId) {
        input.classId = editForm.classId
      }
    }

    setEditBusy(true)
    setEditError(null)
    setEditDetails([])

    try {
      const result = await updateTeacher(
        schoolId,
        editing.membershipId,
        input,
      )
      const name = `${result.teacher.firstName} ${result.teacher.lastName}`

      setSuccess(`${name}'s profile was updated.`)
      setEditing(null)
      setEditForm(EMPTY_EDIT)
      await load()
    } catch (cause) {
      setEditError(
        apiErrorMessage(cause, "Could not update this teacher's profile."),
      )
      setEditDetails(
        cause instanceof ApiError ? fieldFeedback(cause.details) : [],
      )
    } finally {
      setEditBusy(false)
    }
  }

  function openRemove(teacher: Teacher) {
    setRemoving(teacher)
    setRemoveEmail('')
    setRemoveReason('')
    setRemoveError(null)
  }

  async function submitRemove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId || !removing || removeBusy) return

    setRemoveBusy(true)
    setRemoveError(null)

    try {
      const result = await removeTeacherMembership(
        schoolId,
        removing.membershipId,
        {
          confirmEmail: removeEmail.trim(),
          reason: removeReason.trim() || null,
        },
      )
      setSuccess(
        `${removing.firstName} ${removing.lastName}: ${result.message}`,
      )
      setRemoving(null)
      await load()
    } catch (cause) {
      setRemoveError(
        apiErrorMessage(cause, "Could not remove this teacher's access."),
      )
    } finally {
      setRemoveBusy(false)
    }
  }

  function openRestore(teacher: Teacher) {
    setRestoring(teacher)
    setRestoreEmail('')
    setRestoreReason('')
    setRestoreError(null)
  }

  async function submitRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId || !restoring || restoreBusy) return

    setRestoreBusy(true)
    setRestoreError(null)

    try {
      const result = await restoreTeacherMembership(
        schoolId,
        restoring.membershipId,
        {
          confirmEmail: restoreEmail.trim(),
          reason: restoreReason.trim() || null,
        },
      )
      setSuccess(
        `${restoring.firstName} ${restoring.lastName}: ${result.message}`,
      )
      setRestoring(null)
      await load()
    } catch (cause) {
      setRestoreError(
        apiErrorMessage(cause, 'Could not restore this teacher’s access.'),
      )
    } finally {
      setRestoreBusy(false)
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
                              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm"
                            >
                              <div>
                                <p className="font-semibold text-gradely-text">
                                  {assignment.className}
                                </p>
                                <p className="text-xs text-gradely-muted">
                                  {assignment.firstName} {assignment.lastName} ·{' '}
                                  {assignment.email}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                loading={
                                  resendingMembershipId ===
                                  assignment.membershipId
                                }
                                disabled={resendingMembershipId !== null}
                                onClick={() => void resendCredentials(assignment)}
                              >
                                <Mail aria-hidden="true" className="size-3.5" />
                                Resend credentials
                              </Button>
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

              <Panel>
                <h2 className="text-lg font-bold text-gradely-text">
                  Teacher accounts
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  Edit a teacher&apos;s name, phone number or class assignment.
                  Email addresses are the account&apos;s global sign-in
                  identity and can only be changed by the platform
                  administrator. Removing access suspends only this
                  school&apos;s membership: the account, academic records and
                  any access to another school are preserved, and access can be
                  restored here later. Passwords are never shown or set here.
                </p>

                {teachers.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-gradely-muted">
                    No teacher accounts have been registered for this school
                    yet.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {teachers.map((teacher) => {
                      const active = teacher.status === 'ACTIVE'

                      return (
                        <li
                          key={teacher.membershipId}
                          className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-gradely-text">
                              {teacher.firstName} {teacher.lastName}
                              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-gradely-muted uppercase">
                                {teacher.role === 'CLASS_TEACHER'
                                  ? 'Class teacher'
                                  : 'Subject teacher'}
                              </span>
                              {!active ? (
                                <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-red-700 uppercase">
                                  Removed
                                </span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 break-words text-xs text-gradely-muted">
                              {teacher.email}
                              {teacher.phone ? ` · ${teacher.phone}` : ''}
                            </p>
                          </div>

                          {active ? (
                            <div className="flex shrink-0 items-center gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => openEdit(teacher)}
                              >
                                <Pencil
                                  aria-hidden="true"
                                  className="size-3.5"
                                />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => openRemove(teacher)}
                              >
                                <Trash2
                                  aria-hidden="true"
                                  className="size-3.5"
                                />
                                Remove access
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => openRestore(teacher)}
                            >
                              <RotateCcw
                                aria-hidden="true"
                                className="size-3.5"
                              />
                              Restore access
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Panel>
            </>
          ) : null}
        </>
      )}

      <Modal
        open={editing !== null}
        title={
          editing
            ? `Edit ${editing.firstName} ${editing.lastName}`
            : 'Edit teacher'
        }
        description="Changes apply immediately. The sign-in email address is managed by the platform administrator and cannot be changed here. No password field is shown because administrators cannot set or view passwords."
        onClose={() => {
          if (!editBusy) setEditing(null)
        }}
        wide
      >
        <form onSubmit={(event) => void submitEdit(event)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="First name"
              value={editForm.firstName}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  firstName: event.target.value,
                }))
              }
              required
              minLength={2}
              maxLength={80}
            />
            <FormField
              label="Last name"
              value={editForm.lastName}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  lastName: event.target.value,
                }))
              }
              required
              minLength={2}
              maxLength={80}
            />
          </div>
          <FormField
            label="Email address"
            type="email"
            value={editing?.email ?? ''}
            readOnly
            disabled
            hint="The global sign-in address. Contact the platform administrator to change it."
          />
          <FormField
            label="Mobile number (optional)"
            type="tel"
            value={editForm.phone}
            onChange={(event) =>
              setEditForm((current) => ({
                ...current,
                phone: event.target.value,
              }))
            }
            placeholder="e.g. 024 000 0000"
            maxLength={20}
          />
          {editing?.role === 'CLASS_TEACHER' ? (
            <SelectField
              label="Class assignment"
              value={editForm.classId}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  classId: event.target.value,
                }))
              }
              hint={
                editForm.classId
                  ? 'Moving the teacher ends their previous class assignment.'
                  : 'This teacher is not currently assigned to a class.'
              }
            >
              <option value="">Keep current class assignment</option>
              {classes
                .filter((schoolClass) => !schoolClass.isArchived)
                .map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>
                    {schoolClass.name}
                  </option>
                ))}
            </SelectField>
          ) : null}

          {editError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <p>{editError}</p>
              {editDetails.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {editDetails.map((detail) => (
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
              onClick={() => setEditing(null)}
              disabled={editBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={editBusy}
              disabled={
                editForm.firstName.trim() === '' ||
                editForm.lastName.trim() === ''
              }
            >
              <Pencil aria-hidden="true" className="size-4" />
              Save changes
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={removing !== null}
        title={
          removing
            ? `Remove ${removing.firstName} ${removing.lastName}'s access?`
            : 'Remove teacher access'
        }
        description="This suspends the teacher's membership in this school and ends their active class and subject assignments. The account, pupils, scores, reports and audit history are preserved, and access to any other school is untouched."
        onClose={() => {
          if (!removeBusy) setRemoving(null)
        }}
      >
        <form
          onSubmit={(event) => void submitRemove(event)}
          className="space-y-4"
        >
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-900">
            This does not delete the account or any academic data. To confirm,
            type the teacher&apos;s current email address exactly.
          </p>
          <FormField
            label="Teacher email address"
            type="email"
            value={removeEmail}
            onChange={(event) => setRemoveEmail(event.target.value)}
            placeholder={removing?.email ?? ''}
            required
          />
          <FormField
            label="Reason (optional)"
            value={removeReason}
            onChange={(event) => setRemoveReason(event.target.value)}
            maxLength={500}
            hint="Stored in the audit trail for this school."
          />

          {removeError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {removeError}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRemoving(null)}
              disabled={removeBusy}
            >
              Keep access
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={removeBusy}
              disabled={
                !removing ||
                removeEmail.trim().toLowerCase() !==
                  removing.email.trim().toLowerCase()
              }
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Remove access
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={restoring !== null}
        title={
          restoring
            ? `Restore ${restoring.firstName} ${restoring.lastName}'s access?`
            : 'Restore teacher access'
        }
        description="This reactivates the teacher's membership in this school only. It does not recreate ended class or subject assignments, and it does not grant access to any other school. A deleted or deactivated account cannot be restored here."
        onClose={() => {
          if (!restoreBusy) setRestoring(null)
        }}
      >
        <form
          onSubmit={(event) => void submitRestore(event)}
          className="space-y-4"
        >
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-sm leading-relaxed text-sky-900">
            The teacher will have to sign in again. To confirm, type the
            teacher&apos;s current email address exactly.
          </p>
          <FormField
            label="Teacher email address"
            type="email"
            value={restoreEmail}
            onChange={(event) => setRestoreEmail(event.target.value)}
            placeholder={restoring?.email ?? ''}
            required
          />
          <FormField
            label="Reason (optional)"
            value={restoreReason}
            onChange={(event) => setRestoreReason(event.target.value)}
            maxLength={500}
            hint="Stored in the audit trail for this school."
          />

          {restoreError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {restoreError}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRestoring(null)}
              disabled={restoreBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={restoreBusy}
              disabled={
                !restoring ||
                restoreEmail.trim().toLowerCase() !==
                  restoring.email.trim().toLowerCase()
              }
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Restore access
            </Button>
          </div>
        </form>
      </Modal>

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
            <p className="rounded-xl border border-slate-200 bg-gradely-light px-3.5 py-3 text-xs leading-relaxed text-gradely-muted">
              Gradely generates a strong temporary password automatically and
              emails it to the teacher together with their login email, class and
              the official login link. Nobody types or chooses it here, and it is
              never shown in this dashboard. The teacher must create a personal
              password at first sign-in.
            </p>
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
                registerForm.email.trim() === ''
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
