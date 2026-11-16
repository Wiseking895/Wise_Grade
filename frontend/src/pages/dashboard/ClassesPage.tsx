import { BookOpen, Copy, KeyRound, Layers, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import { formatDate } from '../../lib/format'
import { useSchool } from '../../schools/use-school'
import {
  assignSubjectToClass,
  listClassSubjectTeacherAssignments,
  listClassSubjects,
  listClasses,
  listSubjectTeacherInvitations,
  listSubjects,
  reissueSubjectTeacherInvitation,
  removeSubjectFromClass,
  revokeSubjectTeacher,
  revokeSubjectTeacherInvitation,
  updateClassSubject,
} from '../../schools/api'
import type {
  ClassSubject,
  IssuedSubjectTeacherInvitation,
  SchoolClass,
  Subject,
  SubjectTeacherAssignment,
  SubjectTeacherInvitation,
} from '../../schools/types'

const NEW_SUBJECT = '__new__'

interface TeacherDetailsForm {
  firstName: string
  lastName: string
  email: string
  phone: string
}

const EMPTY_TEACHER_DETAILS: TeacherDetailsForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
}

function invitationTone(
  status: SubjectTeacherInvitation['status'],
): 'neutral' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'PENDING':
      return 'info'
    case 'USED':
      return 'success'
    case 'EXPIRED':
      return 'warning'
    default:
      return 'neutral'
  }
}

function invitationStatusLabel(
  status: SubjectTeacherInvitation['status'],
): string {
  switch (status) {
    case 'PENDING':
      return 'Active code'
    case 'USED':
      return 'Used (legacy)'
    case 'EXPIRED':
      return 'Expired'
    case 'REVOKED':
      return 'Revoked'
    case 'REISSUED':
      return 'Replaced'
    default:
      return status
  }
}

export default function ClassesPage() {
  const { schoolId, role } = useSchool()
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [subjectClass, setSubjectClass] = useState<SchoolClass | null>(null)
  const [classSubjects, setClassSubjects] = useState<ClassSubject[]>([])
  const [assignments, setAssignments] = useState<SubjectTeacherAssignment[]>([])
  const [invitations, setInvitations] = useState<SubjectTeacherInvitation[]>([])
  const [classSubjectsLoading, setClassSubjectsLoading] = useState(false)
  const [classSubjectsError, setClassSubjectsError] = useState<string | null>(
    null,
  )
  const [subjectBusy, setSubjectBusy] = useState(false)

  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectCode, setNewSubjectCode] = useState('')

  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null)
  const [editSubjectName, setEditSubjectName] = useState('')
  const [editSubjectCode, setEditSubjectCode] = useState('')

  const [assignTeacherNow, setAssignTeacherNow] = useState(false)
  const [teacherDetails, setTeacherDetails] = useState<TeacherDetailsForm>(
    EMPTY_TEACHER_DETAILS,
  )

  const [issuedInvitation, setIssuedInvitation] =
    useState<IssuedSubjectTeacherInvitation | null>(null)
  const [copied, setCopied] = useState(false)
  const [pendingInvitationRevoke, setPendingInvitationRevoke] =
    useState<SubjectTeacherInvitation | null>(null)

  // Classes are created automatically by class-teacher registration. Only the
  // assigned class teacher may change the subjects taught in their own class.
  const canManageSubjects = role === 'CLASS_TEACHER'

  const load = useCallback(async () => {
    if (!schoolId) return

    try {
      const [classResponse, subjectResponse] = await Promise.all([
        listClasses(schoolId, { includeArchived }),
        canManageSubjects
          ? listSubjects(schoolId)
          : Promise.resolve({ subjects: [] as Subject[] }),
      ])
      setError(null)
      setClasses(classResponse.classes)
      setSubjects(subjectResponse.subjects)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load classes.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, includeArchived, canManageSubjects])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function refreshClassSubjects(cls: SchoolClass) {
    if (!schoolId) return

    const [subjectResponse, assignmentResponse, invitationResponse] =
      await Promise.all([
        listClassSubjects(schoolId, cls.id),
        listClassSubjectTeacherAssignments(schoolId, cls.id),
        canManageSubjects
          ? listSubjectTeacherInvitations(schoolId, cls.id)
          : Promise.resolve({
              invitations: [] as SubjectTeacherInvitation[],
            }),
      ])

    setClassSubjects(subjectResponse.subjects)
    setAssignments(assignmentResponse.assignments)
    setInvitations(invitationResponse.invitations)
  }

  async function openClassSubjects(cls: SchoolClass) {
    if (!schoolId) return

    setSubjectClass(cls)
    setClassSubjects([])
    setAssignments([])
    setInvitations([])
    setClassSubjectsError(null)
    setClassSubjectsLoading(true)
    setSelectedSubjectId('')
    setNewSubjectName('')
    setNewSubjectCode('')
    setAssignTeacherNow(false)
    setTeacherDetails(EMPTY_TEACHER_DETAILS)
    cancelEditSubject()

    try {
      await refreshClassSubjects(cls)
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not load subjects for this class.',
      )
    } finally {
      setClassSubjectsLoading(false)
    }
  }

  function resetAddSubjectForm() {
    setSelectedSubjectId('')
    setNewSubjectName('')
    setNewSubjectCode('')
    setAssignTeacherNow(false)
    setTeacherDetails(EMPTY_TEACHER_DETAILS)
  }

  function startEditSubject(item: ClassSubject) {
    setEditingSubjectId(item.subjectId)
    setEditSubjectName(item.subjectName)
    setEditSubjectCode(item.subjectCode ?? '')
    setClassSubjectsError(null)
  }

  function cancelEditSubject() {
    setEditingSubjectId(null)
    setEditSubjectName('')
    setEditSubjectCode('')
  }

  async function saveSubjectEdit() {
    if (!schoolId || !subjectClass || !editingSubjectId) return

    if (!editSubjectName.trim()) {
      setClassSubjectsError('Enter a subject name.')
      return
    }

    setSubjectBusy(true)
    setClassSubjectsError(null)

    try {
      await updateClassSubject(
        schoolId,
        subjectClass.id,
        editingSubjectId,
        {
          name: editSubjectName.trim(),
          code: editSubjectCode.trim() || null,
        },
      )
      await refreshClassSubjects(subjectClass)
      cancelEditSubject()
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not update the subject.',
      )
    } finally {
      setSubjectBusy(false)
    }
  }

  async function addSubjectToClass() {
    if (!schoolId || !subjectClass) return

    const usingNewSubject = selectedSubjectId === NEW_SUBJECT

    if (!usingNewSubject && !selectedSubjectId) return
    if (usingNewSubject && !newSubjectName.trim()) return

    if (
      assignTeacherNow &&
      (!teacherDetails.firstName.trim() ||
        !teacherDetails.lastName.trim() ||
        !teacherDetails.email.trim())
    ) {
      setClassSubjectsError(
        'Enter the subject teacher’s first name, last name and email, or leave the subject teacher unassigned.',
      )
      return
    }

    setSubjectBusy(true)
    setClassSubjectsError(null)

    try {
      const result = await assignSubjectToClass(schoolId, subjectClass.id, {
        ...(usingNewSubject
          ? { name: newSubjectName.trim(), code: newSubjectCode.trim() || null }
          : { subjectId: selectedSubjectId }),
        ...(assignTeacherNow
          ? {
              subjectTeacher: {
                firstName: teacherDetails.firstName.trim(),
                lastName: teacherDetails.lastName.trim(),
                email: teacherDetails.email.trim(),
                phone: teacherDetails.phone.trim() || null,
              },
            }
          : {}),
      })

      if (result.invitation) {
        setIssuedInvitation(result.invitation)
        setCopied(false)
      }

      await refreshClassSubjects(subjectClass)
      resetAddSubjectForm()
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not assign the subject.',
      )
    } finally {
      setSubjectBusy(false)
    }
  }

  async function removeSubject(subjectId: string) {
    if (!schoolId || !subjectClass) return

    setSubjectBusy(true)
    setClassSubjectsError(null)

    try {
      await removeSubjectFromClass(schoolId, subjectClass.id, subjectId)
      await refreshClassSubjects(subjectClass)
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not remove the subject.',
      )
    } finally {
      setSubjectBusy(false)
    }
  }

  async function unassignTeacher(
    subjectId: string,
    assignmentId: string,
  ) {
    if (!schoolId || !subjectClass) return

    setSubjectBusy(true)
    setClassSubjectsError(null)

    try {
      await revokeSubjectTeacher(
        schoolId,
        subjectClass.id,
        subjectId,
        assignmentId,
      )
      await refreshClassSubjects(subjectClass)
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not unassign the subject teacher.',
      )
    } finally {
      setSubjectBusy(false)
    }
  }

  async function reissueInvitation(invitation: SubjectTeacherInvitation) {
    if (!schoolId || !subjectClass) return

    setSubjectBusy(true)
    setClassSubjectsError(null)

    try {
      const result = await reissueSubjectTeacherInvitation(
        schoolId,
        subjectClass.id,
        invitation.id,
      )
      setIssuedInvitation(result.invitation)
      setCopied(false)
      await refreshClassSubjects(subjectClass)
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not regenerate the access code.',
      )
    } finally {
      setSubjectBusy(false)
    }
  }

  async function confirmRevokeInvitation() {
    if (!schoolId || !subjectClass || !pendingInvitationRevoke) return

    setSubjectBusy(true)
    setClassSubjectsError(null)

    try {
      await revokeSubjectTeacherInvitation(
        schoolId,
        subjectClass.id,
        pendingInvitationRevoke.id,
      )
      setPendingInvitationRevoke(null)
      await refreshClassSubjects(subjectClass)
    } catch (cause) {
      setClassSubjectsError(
        cause instanceof Error
          ? cause.message
          : 'Could not revoke the access code.',
      )
    } finally {
      setSubjectBusy(false)
    }
  }

  async function copyCode() {
    if (!issuedInvitation) return

    try {
      await navigator.clipboard.writeText(issuedInvitation.code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const activeSubjects = classSubjects.filter((item) => item.isActive)
  const availableSubjects = subjects.filter(
    (subject) =>
      !subject.isArchived &&
      !activeSubjects.some((item) => item.subjectId === subject.id),
  )

  function assignmentsFor(subjectId: string) {
    return assignments.filter((item) => item.subjectId === subjectId)
  }

  function invitationsFor(subjectId: string) {
    return invitations.filter((item) => item.subjectId === subjectId)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Classes"
        description={
          canManageSubjects
            ? 'Manage the subjects offered by your assigned class. Add a subject teacher’s details to hand a subject over; they receive a reusable access code. Subjects without a subject teacher stay with you.'
            : 'These are the classes and subjects currently assigned to your teaching role. They are read-only.'
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gradely-muted">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => {
              setLoading(true)
              setIncludeArchived(event.target.checked)
            }}
            className="size-4 rounded border-slate-300"
          />
          Show archived classes
        </label>
        <span className="text-sm text-gradely-muted">
          Only classes assigned to your teaching role are shown.
        </span>
      </div>

      {loading ? <LoadingPanel label="Loading classes…" /> : null}

      {!loading && classes.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No classes found"
          description="No class has been assigned to you yet."
        />
      ) : null}

      {!loading && classes.length > 0 ? (
        <Panel className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-gradely-light text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Class
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Level
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Academic year
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Order
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classes.map((cls) => (
                  <tr key={cls.id} className="align-middle">
                    <td className="px-4 py-3 font-semibold whitespace-nowrap text-gradely-text">
                      {cls.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gradely-muted">
                      {cls.level ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gradely-muted">
                      {cls.academicYearName ?? 'School-wide'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gradely-muted">
                      {cls.sortOrder}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={cls.isArchived ? 'warning' : 'success'}>
                        {cls.isArchived ? 'Archived' : 'Active'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void openClassSubjects(cls)}
                        >
                          <BookOpen aria-hidden="true" className="size-3.5" />
                          {canManageSubjects ? 'Subjects' : 'View subjects'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Modal
        open={subjectClass !== null}
        title={subjectClass ? `${subjectClass.name} subjects` : 'Class subjects'}
        description={
          canManageSubjects
            ? 'Add the subjects offered by this class. Assign a subject teacher by entering their details; a reusable access code is shown once. Removing an assignment keeps historical records.'
            : 'Subjects and subject teachers currently assigned to this class.'
        }
        onClose={() => setSubjectClass(null)}
        wide
      >
        {classSubjectsLoading ? (
          <LoadingPanel label="Loading class subjects…" />
        ) : (
          <div className="space-y-5">
            {classSubjectsError ? (
              <ErrorNotice message={classSubjectsError} />
            ) : null}

            {activeSubjects.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                No subjects are assigned to this class yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {activeSubjects.map((item) => {
                  const subjectAssignments = assignmentsFor(item.subjectId)
                  const subjectInvitations = invitationsFor(item.subjectId)

                  return (
                    <li key={item.id} className="space-y-3 px-4 py-3">
                      {editingSubjectId === item.subjectId ? (
                        <div className="space-y-3 rounded-lg border border-slate-200 bg-gradely-light p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <FormField
                              label="Subject name"
                              value={editSubjectName}
                              onChange={(event) =>
                                setEditSubjectName(event.target.value)
                              }
                              maxLength={100}
                              required
                            />
                            <FormField
                              label="Subject code (optional)"
                              value={editSubjectCode}
                              onChange={(event) =>
                                setEditSubjectCode(event.target.value)
                              }
                              maxLength={24}
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void saveSubjectEdit()}
                              disabled={subjectBusy || !editSubjectName.trim()}
                              loading={subjectBusy}
                            >
                              Save changes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditSubject}
                              disabled={subjectBusy}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gradely-text">
                              {item.subjectName}
                            </p>
                            <p className="text-xs text-gradely-muted">
                              {item.subjectCode ?? 'No code'}
                            </p>
                          </div>
                          {canManageSubjects ? (
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={subjectBusy}
                                onClick={() => startEditSubject(item)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={subjectBusy}
                                onClick={() => void removeSubject(item.subjectId)}
                              >
                                Remove
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )}

                      <div className="rounded-lg bg-gradely-light px-3 py-2">
                        <p className="text-xs font-semibold text-gradely-muted">
                          Subject teacher
                        </p>
                        {subjectAssignments.length === 0 ? (
                          <p className="mt-1 text-sm text-gradely-muted">
                            Unassigned — the class teacher remains responsible
                            for this subject.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {subjectAssignments.map((assignment) => (
                              <li
                                key={assignment.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-sm text-gradely-text"
                              >
                                <span>
                                  {assignment.firstName}{' '}
                                  {assignment.lastName}
                                  <span className="ml-1 text-xs text-gradely-muted">
                                    {assignment.email}
                                  </span>
                                </span>
                                {canManageSubjects ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={subjectBusy}
                                    onClick={() =>
                                      void unassignTeacher(
                                        item.subjectId,
                                        assignment.id,
                                      )
                                    }
                                  >
                                    Unassign
                                  </Button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {canManageSubjects && subjectInvitations.length > 0 ? (
                        <div className="rounded-lg border border-slate-200 px-3 py-2">
                          <p className="text-xs font-semibold text-gradely-muted">
                            Access codes
                          </p>
                          <ul className="mt-1 space-y-1.5">
                            {subjectInvitations.map((invitation) => (
                              <li
                                key={invitation.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <span className="flex flex-wrap items-center gap-1.5 text-gradely-text">
                                  <Badge tone={invitationTone(invitation.status)}>
                                    {invitationStatusLabel(invitation.status)}
                                  </Badge>
                                  <span className="text-gradely-muted">
                                    {invitation.firstName}{' '}
                                    {invitation.lastName} · expires{' '}
                                    {formatDate(invitation.expiresAt)}
                                  </span>
                                </span>
                                {invitation.status !== 'USED' ? (
                                  <span className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={subjectBusy}
                                      onClick={() =>
                                        void reissueInvitation(invitation)
                                      }
                                    >
                                      <KeyRound
                                        aria-hidden="true"
                                        className="size-3.5"
                                      />
                                      Regenerate
                                    </Button>
                                    {invitation.status !== 'REVOKED' ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={subjectBusy}
                                        onClick={() =>
                                          setPendingInvitationRevoke(invitation)
                                        }
                                      >
                                        Revoke
                                      </Button>
                                    ) : null}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}

            {canManageSubjects ? (
              <div className="rounded-xl border border-slate-200 bg-gradely-light p-4">
                <h3 className="text-sm font-bold text-gradely-text">
                  Add a class subject
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Subject"
                    value={selectedSubjectId}
                    onChange={(event) => {
                      setSelectedSubjectId(event.target.value)
                      if (event.target.value !== NEW_SUBJECT) {
                        setNewSubjectName('')
                        setNewSubjectCode('')
                      }
                    }}
                  >
                    <option value="">Select a subject</option>
                    {availableSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                    <option value={NEW_SUBJECT}>Add a new subject…</option>
                  </SelectField>

                  {selectedSubjectId === NEW_SUBJECT ? (
                    <>
                      <FormField
                        label="New subject name"
                        value={newSubjectName}
                        onChange={(event) =>
                          setNewSubjectName(event.target.value)
                        }
                        maxLength={100}
                        required
                      />
                      <FormField
                        label="Subject code (optional)"
                        value={newSubjectCode}
                        onChange={(event) =>
                          setNewSubjectCode(event.target.value)
                        }
                        maxLength={24}
                      />
                    </>
                  ) : null}
                </div>

                <label className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gradely-text">
                  <input
                    type="checkbox"
                    checked={assignTeacherNow}
                    onChange={(event) =>
                      setAssignTeacherNow(event.target.checked)
                    }
                    className="size-4 rounded border-slate-300"
                  />
                  Assign a subject teacher to this subject
                </label>

                {assignTeacherNow ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FormField
                      label="Subject teacher first name"
                      value={teacherDetails.firstName}
                      onChange={(event) =>
                        setTeacherDetails((current) => ({
                          ...current,
                          firstName: event.target.value,
                        }))
                      }
                      required
                      minLength={2}
                      maxLength={80}
                    />
                    <FormField
                      label="Subject teacher last name"
                      value={teacherDetails.lastName}
                      onChange={(event) =>
                        setTeacherDetails((current) => ({
                          ...current,
                          lastName: event.target.value,
                        }))
                      }
                      required
                      minLength={2}
                      maxLength={80}
                    />
                    <FormField
                      label="Subject teacher email"
                      type="email"
                      value={teacherDetails.email}
                      onChange={(event) =>
                        setTeacherDetails((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      required
                    />
                    <FormField
                      label="Mobile number (optional)"
                      type="tel"
                      value={teacherDetails.phone}
                      onChange={(event) =>
                        setTeacherDetails((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      maxLength={20}
                    />
                    <p className="text-xs text-gradely-muted sm:col-span-2">
                      The subject teacher is attached to this exact class and
                      subject only. They receive no access to other subjects or
                      classes, and cannot register pupils or change settings.
                    </p>
                  </div>
                ) : null}

                <div className="mt-3">
                  <Button
                    onClick={() => void addSubjectToClass()}
                    disabled={
                      subjectBusy ||
                      (!selectedSubjectId ||
                        (selectedSubjectId === NEW_SUBJECT &&
                          !newSubjectName.trim()))
                    }
                    loading={subjectBusy}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    Add subject
                  </Button>
                </div>
                {availableSubjects.length === 0 ? (
                  <p className="mt-2 text-xs text-gradely-muted">
                    Every active catalogue subject is already assigned. You can
                    still add a new subject.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={issuedInvitation !== null}
        title="Subject teacher access code"
        description="Share this code with the subject teacher. It is shown only once and stays valid until you regenerate or revoke it."
        onClose={() => setIssuedInvitation(null)}
      >
        {issuedInvitation ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gradely-gold/40 bg-gradely-gold/10 p-4">
              <p className="text-xs font-semibold tracking-wide text-[#7a5400] uppercase">
                {issuedInvitation.subjectName} ·{' '}
                {issuedInvitation.firstName} {issuedInvitation.lastName}
              </p>
              <p className="mt-2 break-all font-mono text-base font-bold text-gradely-navy">
                {issuedInvitation.code}
              </p>
              <p className="mt-2 text-xs text-gradely-muted">
                Expires {formatDate(issuedInvitation.expiresAt)}. The code is
                stored only as a secure hash; it cannot be shown again.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copyCode()}>
                <Copy aria-hidden="true" className="size-4" />
                {copied ? 'Copied' : 'Copy code'}
              </Button>
              <Button onClick={() => setIssuedInvitation(null)}>Done</Button>
            </div>

            <p className="text-xs text-gradely-muted">
              The subject teacher enters this code from the login page via
              <strong> Enter access code</strong>. No account or password is
              created. Delivery by SMS or email is not automatic — share the
              code through a channel you trust.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingInvitationRevoke !== null}
        title="Revoke this access code?"
        description={
          pendingInvitationRevoke
            ? `The code for ${pendingInvitationRevoke.firstName} ${pendingInvitationRevoke.lastName} (${pendingInvitationRevoke.subjectName}) will stop working, and any session it opened will end. You can generate a new code afterwards.`
            : ''
        }
        confirmLabel="Revoke code"
        danger
        busy={subjectBusy}
        onConfirm={() => void confirmRevokeInvitation()}
        onCancel={() => setPendingInvitationRevoke(null)}
      />
    </div>
  )
}
