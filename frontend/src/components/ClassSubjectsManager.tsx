import { Copy, KeyRound, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import FormField from './FormField'
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorNotice,
  LoadingPanel,
  Modal,
  SelectField,
} from './ui'
import { formatDate } from '../lib/format'
import {
  assignSubjectToClass,
  listClassSubjectTeacherAssignments,
  listClassSubjects,
  listSubjectTeacherInvitations,
  listSubjects,
  reissueSubjectTeacherInvitation,
  removeSubjectFromClass,
  revokeSubjectTeacher,
  revokeSubjectTeacherInvitation,
  updateClassSubject,
} from '../schools/api'
import type {
  ClassSubject,
  IssuedSubjectTeacherInvitation,
  Subject,
  SubjectTeacherAssignment,
  SubjectTeacherInvitation,
} from '../schools/types'

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

/**
 * Class-scoped subject manager used by the Class Dashboard.
 *
 * The class is supplied by the dashboard's authoritative class context, not by
 * a selector. The backend independently verifies that the authenticated class
 * teacher owns this class before every mutation.
 */
export default function ClassSubjectsManager({
  open,
  onClose,
  schoolId,
  classId,
  className,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  schoolId: string
  classId: string
  className: string
  onChanged?: () => void
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classSubjects, setClassSubjects] = useState<ClassSubject[]>([])
  const [assignments, setAssignments] = useState<SubjectTeacherAssignment[]>([])
  const [invitations, setInvitations] = useState<SubjectTeacherInvitation[]>(
    [],
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const refresh = useCallback(async () => {
    if (!schoolId || !classId) return

    const [subjectResponse, assignmentResponse, invitationResponse] =
      await Promise.all([
        listClassSubjects(schoolId, classId),
        listClassSubjectTeacherAssignments(schoolId, classId),
        listSubjectTeacherInvitations(schoolId, classId),
      ])

    setClassSubjects(subjectResponse.subjects)
    setAssignments(assignmentResponse.assignments)
    setInvitations(invitationResponse.invitations)
  }, [schoolId, classId])

  const load = useCallback(async () => {
    if (!schoolId || !classId) return

    setSelectedSubjectId('')
    setNewSubjectName('')
    setNewSubjectCode('')
    setAssignTeacherNow(false)
    setTeacherDetails(EMPTY_TEACHER_DETAILS)
    setEditingSubjectId(null)
    setLoading(true)
    setError(null)

    try {
      const [subjectResponse] = await Promise.all([
        listSubjects(schoolId),
        refresh(),
      ])
      setSubjects(subjectResponse.subjects)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the class subjects.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, classId, refresh])

  useEffect(() => {
    if (!open) return

    // Fetching the class subject data is the intended external-system
    // synchronisation here; the reset inside load() prepares the modal.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [open, load])

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
    setError(null)
  }

  function cancelEditSubject() {
    setEditingSubjectId(null)
    setEditSubjectName('')
    setEditSubjectCode('')
  }

  async function saveSubjectEdit() {
    if (!schoolId || !editingSubjectId) return

    if (!editSubjectName.trim()) {
      setError('Enter a subject name.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      await updateClassSubject(schoolId, classId, editingSubjectId, {
        name: editSubjectName.trim(),
        code: editSubjectCode.trim() || null,
      })
      await refresh()
      cancelEditSubject()
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not update the subject.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function addSubjectToClass() {
    if (!schoolId) return

    const usingNewSubject = selectedSubjectId === NEW_SUBJECT

    if (!usingNewSubject && !selectedSubjectId) return
    if (usingNewSubject && !newSubjectName.trim()) return

    if (
      assignTeacherNow &&
      (!teacherDetails.firstName.trim() ||
        !teacherDetails.lastName.trim() ||
        !teacherDetails.email.trim())
    ) {
      setError(
        'Enter the subject teacher’s first name, last name and email, or leave the subject teacher unassigned.',
      )
      return
    }

    setBusy(true)
    setError(null)

    try {
      const result = await assignSubjectToClass(schoolId, classId, {
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

      await refresh()
      resetAddSubjectForm()
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not assign the subject.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeSubject(subjectId: string) {
    if (!schoolId) return

    setBusy(true)
    setError(null)

    try {
      await removeSubjectFromClass(schoolId, classId, subjectId)
      await refresh()
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not remove the subject.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function unassignTeacher(subjectId: string, assignmentId: string) {
    if (!schoolId) return

    setBusy(true)
    setError(null)

    try {
      await revokeSubjectTeacher(schoolId, classId, subjectId, assignmentId)
      await refresh()
      onChanged?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not unassign the subject teacher.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function reissueInvitation(invitation: SubjectTeacherInvitation) {
    if (!schoolId) return

    setBusy(true)
    setError(null)

    try {
      const result = await reissueSubjectTeacherInvitation(
        schoolId,
        classId,
        invitation.id,
      )
      setIssuedInvitation(result.invitation)
      setCopied(false)
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not regenerate the access code.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmRevokeInvitation() {
    if (!schoolId || !pendingInvitationRevoke) return

    setBusy(true)
    setError(null)

    try {
      await revokeSubjectTeacherInvitation(
        schoolId,
        classId,
        pendingInvitationRevoke.id,
      )
      setPendingInvitationRevoke(null)
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not revoke the access code.',
      )
    } finally {
      setBusy(false)
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
    <>
      <Modal
        open={open}
        title={`${className} subjects`}
        description="Add the subjects offered by your class. Assign a subject teacher by entering their details; a reusable access code is shown once. Subjects without a subject teacher stay with you."
        onClose={onClose}
        wide
      >
        {loading ? (
          <LoadingPanel label="Loading class subjects…" />
        ) : (
          <div className="space-y-5">
            {error ? <ErrorNotice message={error} /> : null}

            {activeSubjects.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                No subjects have been registered for this class yet.
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
                              disabled={busy || !editSubjectName.trim()}
                              loading={busy}
                            >
                              Save changes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditSubject}
                              disabled={busy}
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
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => startEditSubject(item)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void removeSubject(item.subjectId)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg bg-gradely-light px-3 py-2">
                        <p className="text-xs font-semibold text-gradely-muted">
                          Subject teacher
                        </p>
                        {subjectAssignments.length === 0 ? (
                          <p className="mt-1 text-sm text-gradely-muted">
                            Unassigned — you remain responsible for this
                            subject.
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void unassignTeacher(
                                      item.subjectId,
                                      assignment.id,
                                    )
                                  }
                                >
                                  Unassign
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {subjectInvitations.length > 0 ? (
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
                                    {invitation.lastName} · valid until{' '}
                                    {formatDate(
                                      invitation.closingDate ??
                                        invitation.expiresAt,
                                    )}
                                    {invitation.closingDate
                                      ? ' — School closing date'
                                      : ''}
                                  </span>
                                </span>
                                {invitation.status !== 'USED' ? (
                                  <span className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      disabled={busy}
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
                                        disabled={busy}
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

            <div className="rounded-xl border border-slate-200 bg-gradely-light p-4">
              <h3 className="text-sm font-bold text-gradely-text">
                Register a class subject
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
                      onChange={(event) => setNewSubjectName(event.target.value)}
                      maxLength={100}
                      required
                    />
                    <FormField
                      label="Subject code (optional)"
                      value={newSubjectCode}
                      onChange={(event) => setNewSubjectCode(event.target.value)}
                      maxLength={24}
                    />
                  </>
                ) : null}
              </div>

              <label className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gradely-text">
                <input
                  type="checkbox"
                  checked={assignTeacherNow}
                  onChange={(event) => setAssignTeacherNow(event.target.checked)}
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
                    busy ||
                    !selectedSubjectId ||
                    (selectedSubjectId === NEW_SUBJECT &&
                      !newSubjectName.trim())
                  }
                  loading={busy}
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
                Valid until{' '}
                {formatDate(
                  issuedInvitation.closingDate ?? issuedInvitation.expiresAt,
                )}
                {issuedInvitation.closingDate
                  ? ' — School closing date'
                  : ''}
                . The code is stored only as a secure hash; it cannot be shown
                again.
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
        busy={busy}
        onConfirm={() => void confirmRevokeInvitation()}
        onCancel={() => setPendingInvitationRevoke(null)}
      />
    </>
  )
}
