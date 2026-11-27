import {
  Archive,
  Camera,
  Eye,
  Pencil,
  Plus,
  Search,
  UserRound,
  ArrowRightLeft,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import FormField from '../../components/FormField'
import PupilPhotoField from '../../components/PupilPhotoField'
import { ApiError, apiAssetUrl } from '../../lib/api'
import type { PreparedPupilPhoto } from '../../lib/images'
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
import {
  formatDate,
  pupilName,
  statusLabel,
  todayInputValue,
} from '../../lib/format'
import { apiErrorMessage } from '../../lib/api-error-message'
import {
  archivePupil,
  createPupil,
  getPupil,
  listAcademicYears,
  listClasses,
  listPupils,
  movePupil,
  removePupilPhoto,
  updatePupil,
  uploadPupilPhoto,
} from '../../schools/api'
import type {
  AcademicYear,
  Pupil,
  PupilDetail,
  PupilDuplicateConflictMeta,
  PupilInput,
  PupilStatus,
  SchoolClass,
} from '../../schools/types'
import { useSchool } from '../../schools/use-school'

const PAGE_SIZE = 25

interface PupilFormState {
  firstName: string
  lastName: string
  otherNames: string
  admissionNumber: string
  gender: string
  dateOfBirth: string
  classId: string
  academicYearId: string
  startedOn: string
  status: 'ACTIVE' | 'INACTIVE'
}

interface MoveFormState {
  classId: string
  academicYearId: string
  startedOn: string
}

const EMPTY_PUPIL: PupilFormState = {
  firstName: '',
  lastName: '',
  otherNames: '',
  admissionNumber: '',
  gender: '',
  dateOfBirth: '',
  classId: '',
  academicYearId: '',
  startedOn: todayInputValue(),
  status: 'ACTIVE',
}

const EMPTY_MOVE: MoveFormState = {
  classId: '',
  academicYearId: '',
  startedOn: todayInputValue(),
}

function releasePreparedPhoto(photo: PreparedPupilPhoto | null): void {
  if (photo) {
    URL.revokeObjectURL(photo.previewUrl)
  }
}

function isPupilDuplicateConflictMeta(
  value: unknown,
): value is PupilDuplicateConflictMeta {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<PupilDuplicateConflictMeta>

  return (
    typeof candidate.category === 'string' &&
    typeof candidate.requiresConfirmation === 'boolean' &&
    Boolean(candidate.existingPupil) &&
    typeof candidate.existingPupil === 'object'
  )
}

export default function PupilsPage() {
  const { schoolId, isAdmin, role } = useSchool()
  // Pupil records are owned by the assigned class teacher. School
  // administrators and subject teachers have read-only visibility.
  const canManagePupils = role === 'CLASS_TEACHER'
  // Photographs are shared pupil identity data: the assigned class teacher and
  // a school administrator may manage them, while other staff remain read-only.
  const canManagePhotos =
    role === 'CLASS_TEACHER' || role === 'SCHOOL_ADMIN'
  const [pupils, setPupils] = useState<Pupil[]>([])
  const [total, setTotal] = useState(0)
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [page, setPage] = useState(1)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | PupilStatus>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingPupil, setEditingPupil] = useState<PupilDetail | null>(null)
  const [form, setForm] = useState<PupilFormState>(EMPTY_PUPIL)
  const [formError, setFormError] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [duplicatePrompt, setDuplicatePrompt] =
    useState<PupilDuplicateConflictMeta | null>(null)
  const [pendingPhoto, setPendingPhoto] = useState<PreparedPupilPhoto | null>(
    null,
  )

  const [photoOpen, setPhotoOpen] = useState(false)
  const [photoPupil, setPhotoPupil] = useState<Pupil | null>(null)
  const [photoPending, setPhotoPending] = useState<PreparedPupilPhoto | null>(
    null,
  )
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<PupilDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [moveOpen, setMoveOpen] = useState(false)
  const [movingPupil, setMovingPupil] = useState<Pupil | null>(null)
  const [moveForm, setMoveForm] = useState<MoveFormState>(EMPTY_MOVE)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false)

  const [pendingArchive, setPendingArchive] = useState<Pupil | null>(null)
  const [busy, setBusy] = useState(false)

  const loadMeta = useCallback(async () => {
    if (!schoolId) return

    try {
      const [classResponse, yearResponse] = await Promise.all([
        listClasses(schoolId),
        listAcademicYears(schoolId),
      ])
      setClasses(classResponse.classes)
      setYears(yearResponse.academicYears)
      setClassFilter(
        (current) =>
          current ||
          (classResponse.classes.length === 1 ? classResponse.classes[0].id : ''),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load classes and academic years.',
      )
    }
  }, [schoolId])

  const loadPupils = useCallback(async () => {
    if (!schoolId) return

    try {
      const response = await listPupils(schoolId, {
        q: search || undefined,
        classId: classFilter || undefined,
        academicYearId: yearFilter || undefined,
        status: statusFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setError(null)
      setPupils(response.pupils)
      setTotal(response.total)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load pupils.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, search, classFilter, yearFilter, statusFilter, page])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPupils()
  }, [loadPupils])

  function closePupilForm() {
    releasePreparedPhoto(pendingPhoto)
    setPendingPhoto(null)
    setFormOpen(false)
  }

  function openCreate() {
    setEditingPupil(null)
    setForm({
      ...EMPTY_PUPIL,
      classId: classes[0]?.id ?? '',
      academicYearId:
        years.find((year) => year.isCurrent)?.id ?? years[0]?.id ?? '',
    })
    setFormError(null)
    setPendingPhoto(null)
    setFormOpen(true)
  }

  function openEdit(pupil: Pupil) {
    setEditingPupil({ ...pupil, enrollments: [] })
    setForm({
      firstName: pupil.firstName,
      lastName: pupil.lastName,
      otherNames: pupil.otherNames ?? '',
      admissionNumber: pupil.admissionNumber,
      gender: pupil.gender ?? '',
      dateOfBirth: pupil.dateOfBirth ?? '',
      classId: pupil.currentClassId ?? '',
      academicYearId: '',
      startedOn: todayInputValue(),
      status: pupil.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    })
    setFormError(null)
    setPendingPhoto(null)
    setFormOpen(true)
  }

  async function openDetail(pupil: Pupil) {
    if (!schoolId) return

    setDetailOpen(true)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)

    try {
      const response = await getPupil(schoolId, pupil.id)
      setDetail(response.pupil)
    } catch (cause) {
      setDetailError(
        cause instanceof Error ? cause.message : 'Could not load the pupil.',
      )
    } finally {
      setDetailLoading(false)
    }
  }

  async function persistPupil(
    confirmDifferentPupil: boolean,
    existingPupilId?: string,
  ): Promise<boolean> {
    if (!schoolId) return false

    setFormBusy(true)
    setFormError(null)

    const confirmation: Partial<PupilInput> = confirmDifferentPupil
      ? {
          confirmDifferentPupil: true,
          duplicateOfPupilId: existingPupilId ?? null,
        }
      : {}

    try {
      let savedPupil: PupilDetail

      if (editingPupil) {
        const input: PupilInput = {
          firstName: form.firstName,
          lastName: form.lastName,
          otherNames: form.otherNames.trim() === '' ? null : form.otherNames,
          admissionNumber: form.admissionNumber,
          gender: form.gender === '' ? null : (form.gender as PupilInput['gender']),
          dateOfBirth:
            form.dateOfBirth.trim() === '' ? null : form.dateOfBirth,
          status: form.status,
          ...confirmation,
        }
        const response = await updatePupil(schoolId, editingPupil.id, input)
        savedPupil = response.pupil
      } else {
        const input: PupilInput = {
          firstName: form.firstName,
          lastName: form.lastName,
          otherNames: form.otherNames.trim() === '' ? null : form.otherNames,
          admissionNumber: form.admissionNumber,
          gender: form.gender === '' ? null : (form.gender as PupilInput['gender']),
          dateOfBirth:
            form.dateOfBirth.trim() === '' ? null : form.dateOfBirth,
          classId: form.classId || null,
          academicYearId: form.academicYearId || null,
          startedOn: form.startedOn,
          ...confirmation,
        }
        const response = await createPupil(schoolId, input)
        savedPupil = response.pupil
      }

      if (pendingPhoto) {
        try {
          const response = await uploadPupilPhoto(schoolId, savedPupil.id, {
            mimeType: pendingPhoto.mimeType,
            base64: pendingPhoto.base64,
            originalName: pendingPhoto.originalName,
          })
          savedPupil = response.pupil
        } catch (cause) {
          // The pupil record itself was saved. Keep the form open in edit mode
          // so submitting again updates this pupil instead of creating a
          // duplicate, and keep the prepared photograph for an immediate retry.
          setEditingPupil(savedPupil)
          await loadPupils()
          setFormError(
            `${
              editingPupil
                ? 'The pupil record was updated'
                : 'The pupil was registered'
            }, but the photograph could not be uploaded. ${apiErrorMessage(
              cause,
              'The upload did not finish. Check your connection and try again.',
            )} The photograph is still selected; save again to retry.`,
          )
          return false
        }
      }

      setSuccess(
        editingPupil
          ? 'Pupil record updated.'
          : 'Pupil registered and enrolled.',
      )
      releasePreparedPhoto(pendingPhoto)
      setPendingPhoto(null)
      setDuplicatePrompt(null)
      setFormOpen(false)
      await loadPupils()
      return true
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code?.startsWith('PUPIL_DUPLICATE_') &&
        isPupilDuplicateConflictMeta(cause.meta)
      ) {
        setDuplicatePrompt(cause.meta)
        setFormError(null)
      } else {
        setFormError(
          cause instanceof Error ? cause.message : 'Could not save the pupil.',
        )
      }
      return false
    } finally {
      setFormBusy(false)
    }
  }

  function submitPupil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void persistPupil(false)
  }

  async function confirmDifferentPupil() {
    if (!duplicatePrompt) return
    await persistPupil(true, duplicatePrompt.existingPupil.id)
  }

  async function openExistingDuplicate() {
    if (!schoolId || !duplicatePrompt) return

    const pupilId = duplicatePrompt.existingPupil.id
    setDuplicatePrompt(null)
    setFormOpen(false)
    setDetailOpen(true)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)

    try {
      const response = await getPupil(schoolId, pupilId)
      setDetail(response.pupil)
    } catch (cause) {
      setDetailError(
        cause instanceof Error ? cause.message : 'Could not load the pupil.',
      )
    } finally {
      setDetailLoading(false)
    }
  }

  function openPhoto(pupil: Pupil) {
    releasePreparedPhoto(photoPending)
    setPhotoPending(null)
    setPhotoPupil(pupil)
    setPhotoError(null)
    setPhotoOpen(true)
  }

  async function savePupilPhoto() {
    if (!schoolId || !photoPupil || !photoPending) return

    setPhotoBusy(true)
    setPhotoError(null)

    try {
      const response = await uploadPupilPhoto(schoolId, photoPupil.id, {
        mimeType: photoPending.mimeType,
        base64: photoPending.base64,
        originalName: photoPending.originalName,
      })
      const updated = response.pupil

      setPupils((current) =>
        current.map((pupil) =>
          pupil.id === updated.id ? { ...pupil, ...updated } : pupil,
        ),
      )
      setPhotoPupil((current) =>
        current ? { ...current, ...updated } : current,
      )
      releasePreparedPhoto(photoPending)
      setPhotoPending(null)
      setSuccess('Pupil photograph saved. New reports will use it.')
    } catch (cause) {
      setPhotoError(
        apiErrorMessage(
          cause,
          'Could not save the pupil photograph. Check your connection and try again.',
        ),
      )
    } finally {
      setPhotoBusy(false)
    }
  }

  async function removeSavedPupilPhoto(pupilId: string) {
    if (!schoolId) return

    try {
      const response = await removePupilPhoto(schoolId, pupilId)
      const updated = response.pupil

      setPupils((current) =>
        current.map((pupil) =>
          pupil.id === updated.id ? { ...pupil, ...updated } : pupil,
        ),
      )
      setEditingPupil((current) =>
        current && current.id === updated.id
          ? { ...current, ...updated }
          : current,
      )
      setPhotoPupil((current) =>
        current && current.id === updated.id
          ? { ...current, ...updated }
          : current,
      )
      setDetail((current) =>
        current && current.id === updated.id
          ? { ...current, ...updated }
          : current,
      )
      setSuccess('Pupil photograph removed. It is no longer printed on new reports.')
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : 'Could not remove the pupil photograph.',
      )
    }
  }

  function openMove(pupil: Pupil) {
    setMovingPupil(pupil)
    setMoveForm({
      classId: pupil.currentClassId ?? classes[0]?.id ?? '',
      academicYearId:
        years.find((year) => year.isCurrent)?.id ?? years[0]?.id ?? '',
      startedOn: todayInputValue(),
    })
    setMoveError(null)
    setMoveOpen(true)
  }

  async function confirmMove() {
    if (!schoolId || !movingPupil) return

    setBusy(true)
    setMoveError(null)

    try {
      await movePupil(schoolId, movingPupil.id, moveForm)
      setSuccess('Pupil moved to the new class. Enrollment history was preserved.')
      setMoveConfirmOpen(false)
      setMoveOpen(false)
      await loadPupils()
    } catch (cause) {
      setMoveError(
        cause instanceof Error ? cause.message : 'Could not move the pupil.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmArchive() {
    if (!schoolId || !pendingArchive) return

    setBusy(true)
    setError(null)

    try {
      await archivePupil(schoolId, pendingArchive.id)
      setSuccess('Pupil archived. The enrollment history remains available.')
      setPendingArchive(null)
      await loadPupils()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not archive the pupil.',
      )
    } finally {
      setBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentYear = years.find((year) => year.isCurrent)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pupils"
        description={
          isAdmin
            ? 'Read-only view of pupil records. School administrators can manage profile photographs; registration, editing and class moves are performed by the assigned class teacher.'
            : canManagePupils
              ? 'Register pupils, search the roll, and move pupils between classes through auditable enrollments.'
              : 'Pupils currently enrolled in the classes assigned to you. Subject teachers have read-only access.'
        }
        actions={
          canManagePupils ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" className="size-4" />
              Add pupil
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            setLoading(true)
            setError(null)
            void loadPupils()
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

      <Panel>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setLoading(true)
            setError(null)
            setPage(1)
            setSearch(searchDraft.trim())
          }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <div className="sm:col-span-2">
            <label
              htmlFor="pupil-search"
              className="block text-sm font-semibold text-gradely-text"
            >
              Search pupils
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="pupil-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Name or admission number"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-gradely-blue focus:ring-2 focus:ring-gradely-blue/25 focus:outline-none"
              />
              <Button type="submit" variant="secondary">
                <Search aria-hidden="true" className="size-4" />
                Search
              </Button>
            </div>
          </div>

          {classes.length > 1 ? (
            <SelectField
              label="Class"
              value={classFilter}
              onChange={(event) => {
                setLoading(true)
                setError(null)
                setPage(1)
                setClassFilter(event.target.value)
              }}
            >
              <option value="">All classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </SelectField>
          ) : null}

          <SelectField
            label="Academic year"
            value={yearFilter}
            onChange={(event) => {
              setLoading(true)
              setError(null)
              setPage(1)
              setYearFilter(event.target.value)
            }}
          >
            <option value="">All years</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(event) => {
              setLoading(true)
              setError(null)
              setPage(1)
              setStatusFilter(event.target.value as '' | PupilStatus)
            }}
          >
            <option value="">Active (default)</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="ARCHIVED">Archived</option>
          </SelectField>
        </form>
      </Panel>

      {loading ? <LoadingPanel label="Loading pupils…" /> : null}

      {!loading && pupils.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No pupils match these filters"
          description={
            canManagePupils
              ? 'Adjust the search or filters, or register the first pupil.'
              : 'No pupils are currently visible in your assigned classes.'
          }
          action={
            canManagePupils ? (
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" className="size-4" />
                Add pupil
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {!loading && pupils.length > 0 ? (
        <Panel className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-gradely-light text-xs font-semibold tracking-wide text-gradely-muted uppercase">
                <tr>
                  <th scope="col" className="px-3 py-3">
                    Pupil
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Admission no.
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Class
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Gender
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Date of birth
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pupils.map((pupil) => (
                  <tr key={pupil.id} className="align-middle">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-gradely-light">
                          {pupil.photoUrl ? (
                            <img
                              src={apiAssetUrl(pupil.photoUrl)}
                              alt=""
                              crossOrigin="use-credentials"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <UserRound
                              aria-hidden="true"
                              className="size-5 text-gradely-muted"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gradely-text">
                            {pupilName(pupil)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-gradely-muted">
                      {pupil.admissionNumber}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gradely-muted">
                      {pupil.currentClassName ?? 'Not enrolled'}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gradely-muted">
                      {pupil.gender ? statusLabel(pupil.gender) : '—'}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gradely-muted">
                      {formatDate(pupil.dateOfBirth)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Badge
                        tone={
                          pupil.status === 'ACTIVE'
                            ? 'success'
                            : pupil.status === 'ARCHIVED'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {statusLabel(pupil.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="px-1"
                          onClick={() => void openDetail(pupil)}
                        >
                          <Eye aria-hidden="true" className="size-3.5" />
                          View
                        </Button>
                        {canManagePhotos ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-1"
                            onClick={() => openPhoto(pupil)}
                          >
                            <Camera aria-hidden="true" className="size-3.5" />
                            Photo
                          </Button>
                        ) : null}
                        {canManagePupils ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="px-1"
                              onClick={() => openEdit(pupil)}
                            >
                              <Pencil aria-hidden="true" className="size-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="px-1"
                              onClick={() => openMove(pupil)}
                              disabled={pupil.status === 'ARCHIVED'}
                            >
                              <ArrowRightLeft
                                aria-hidden="true"
                                className="size-3.5"
                              />
                              Move
                            </Button>
                            {pupil.status !== 'ARCHIVED' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-1"
                                onClick={() => setPendingArchive(pupil)}
                              >
                                <Archive
                                  aria-hidden="true"
                                  className="size-3.5"
                                />
                                Archive
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 text-sm text-gradely-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing {pupils.length} of {total} pupil{total === 1 ? '' : 's'}
              {currentYear ? ` · current year ${currentYear.name}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true)
                  setPage((value) => Math.max(1, value - 1))
                }}
              >
                Previous
              </Button>
              <span className="px-2 text-xs font-semibold">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => {
                  setLoading(true)
                  setPage((value) => value + 1)
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Modal
        open={formOpen}
        title={editingPupil ? 'Edit pupil' : 'Register pupil'}
        description={
          editingPupil
            ? 'Update the pupil record. Class changes use the enrollment workflow.'
            : 'Register the pupil and optionally place them in a class for an academic year.'
        }
        onClose={closePupilForm}
        wide
      >
        <form onSubmit={(event) => void submitPupil(event)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="First name"
              value={form.firstName}
              onChange={(event) =>
                setForm((current) => ({
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
              value={form.lastName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  lastName: event.target.value,
                }))
              }
              required
              minLength={2}
              maxLength={80}
            />
            <FormField
              label="Other names"
              value={form.otherNames}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  otherNames: event.target.value,
                }))
              }
              maxLength={120}
            />
            <FormField
              label="Admission number"
              value={form.admissionNumber}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  admissionNumber: event.target.value,
                }))
              }
              hint="Unique within this school. Stored in uppercase."
              required
              maxLength={40}
            />
            <SelectField
              label="Gender"
              value={form.gender}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  gender: event.target.value,
                }))
              }
            >
              <option value="">Not supplied</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </SelectField>
            <FormField
              label="Date of birth"
              type="date"
              value={form.dateOfBirth}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  dateOfBirth: event.target.value,
                }))
              }
            />
            {editingPupil ? (
              <SelectField
                label="Enrollment status"
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as 'ACTIVE' | 'INACTIVE',
                  }))
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </SelectField>
            ) : (
              <>
                {classes.length === 1 ? (
                  <div>
                    <p className="text-sm font-semibold text-gradely-text">
                      Class
                    </p>
                    <p className="mt-1.5 rounded-xl border border-slate-200 bg-gradely-light px-3.5 py-2.5 text-sm font-semibold text-gradely-text">
                      {classes[0].name}
                    </p>
                    <p className="mt-1.5 text-xs text-gradely-muted">
                      Pupils are registered into your assigned class.
                    </p>
                  </div>
                ) : classes.length === 0 ? (
                  <p className="rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-sm text-[#7a5400]">
                    No class is currently assigned to you. Ask a school
                    administrator to assign you to a class before registering
                    pupils.
                  </p>
                ) : (
                  <SelectField
                    label="Class"
                    value={form.classId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        classId: event.target.value,
                      }))
                    }
                    hint="Class and academic year must be supplied together."
                  >
                    <option value="">Not enrolled</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name}
                      </option>
                    ))}
                  </SelectField>
                )}
                <SelectField
                  label="Academic year"
                  value={form.academicYearId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      academicYearId: event.target.value,
                    }))
                  }
                >
                  <option value="">Not enrolled</option>
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                    </option>
                  ))}
                </SelectField>
                <FormField
                  label="Enrollment start date"
                  type="date"
                  value={form.startedOn}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      startedOn: event.target.value,
                    }))
                  }
                  disabled={!form.classId || !form.academicYearId}
                />
              </>
            )}
          </div>

          <PupilPhotoField
            pupilName={
              [form.firstName, form.lastName, form.otherNames]
                .map((part) => part.trim())
                .filter(Boolean)
                .join(' ') || 'Pupil'
            }
            currentUrl={editingPupil?.photoUrl ?? null}
            pending={pendingPhoto}
            onChange={setPendingPhoto}
            onRemoveSaved={() => {
              if (editingPupil) {
                void removeSavedPupilPhoto(editingPupil.id)
              }
            }}
            disabled={formBusy}
          />

          {formError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={closePupilForm}
              disabled={formBusy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={formBusy}>
              {editingPupil ? 'Save pupil' : 'Register pupil'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={photoOpen}
        title="Pupil photograph"
        description="Capture, crop and save the photograph printed at the top-right of this pupil's terminal report."
        onClose={() => {
          releasePreparedPhoto(photoPending)
          setPhotoPending(null)
          setPhotoOpen(false)
        }}
      >
        {photoPupil ? (
          <div className="space-y-4">
            <PupilPhotoField
              pupilName={pupilName(photoPupil)}
              currentUrl={photoPupil.photoUrl}
              pending={photoPending}
              onChange={setPhotoPending}
              onRemoveSaved={() => void removeSavedPupilPhoto(photoPupil.id)}
              disabled={photoBusy}
            />

            {photoError ? (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {photoError}
              </p>
            ) : null}

            {photoBusy ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs text-gradely-muted"
              >
                Uploading the photograph. Keep this window open until it
                finishes.
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={photoBusy}
                onClick={() => {
                  releasePreparedPhoto(photoPending)
                  setPhotoPending(null)
                  setPhotoOpen(false)
                }}
              >
                Close
              </Button>
              <Button
                type="button"
                loading={photoBusy}
                disabled={!photoPending || photoBusy}
                onClick={() => void savePupilPhoto()}
              >
                Save photograph
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={moveOpen}
        title="Move pupil"
        description="The current enrollment is completed and a new enrollment record is created. History is preserved."
        onClose={() => setMoveOpen(false)}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setMoveError(null)

            if (!moveForm.classId || !moveForm.academicYearId) {
              setMoveError('Choose both a class and an academic year.')
              return
            }

            setMoveConfirmOpen(true)
          }}
          className="space-y-4"
        >
          <div className="rounded-xl bg-gradely-light p-3 text-sm">
            <p className="font-semibold text-gradely-text">
              {movingPupil ? pupilName(movingPupil) : ''}
            </p>
            <p className="text-xs text-gradely-muted">
              Current class: {movingPupil?.currentClassName ?? 'Not enrolled'}
            </p>
          </div>
          {classes.length === 1 ? (
            <div>
              <p className="text-sm font-semibold text-gradely-text">
                New class
              </p>
              <p className="mt-1.5 rounded-xl border border-slate-200 bg-gradely-light px-3.5 py-2.5 text-sm font-semibold text-gradely-text">
                {classes[0].name}
              </p>
              <p className="mt-1.5 text-xs text-gradely-muted">
                Transfers are limited to your assigned class.
              </p>
            </div>
          ) : (
            <SelectField
              label="New class"
              value={moveForm.classId}
              onChange={(event) =>
                setMoveForm((current) => ({
                  ...current,
                  classId: event.target.value,
                }))
              }
              required
            >
              <option value="">Select a class</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField
            label="Academic year"
            value={moveForm.academicYearId}
            onChange={(event) =>
              setMoveForm((current) => ({
                ...current,
                academicYearId: event.target.value,
              }))
            }
            required
          >
            <option value="">Select an academic year</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectField>
          <FormField
            label="Enrollment start date"
            type="date"
            value={moveForm.startedOn}
            onChange={(event) =>
              setMoveForm((current) => ({
                ...current,
                startedOn: event.target.value,
              }))
            }
            required
          />
          {moveError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {moveError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMoveOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              <ArrowRightLeft aria-hidden="true" className="size-4" />
              Review move
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailOpen}
        title="Pupil record"
        description="Identity and complete class enrollment history."
        onClose={() => setDetailOpen(false)}
        wide
      >
        {detailLoading ? <LoadingPanel label="Loading pupil record…" /> : null}
        {detailError ? <ErrorNotice message={detailError} /> : null}
        {detail ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs font-semibold text-gradely-muted uppercase">
                  Pupil
                </p>
                <p className="mt-1 font-bold text-gradely-text">
                  {pupilName(detail)}
                </p>
                <p className="text-xs text-gradely-muted">
                  {detail.admissionNumber}
                </p>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs font-semibold text-gradely-muted uppercase">
                  Current class
                </p>
                <p className="mt-1 font-bold text-gradely-text">
                  {detail.currentClassName ?? 'Not enrolled'}
                </p>
                <Badge
                  tone={detail.status === 'ACTIVE' ? 'success' : 'warning'}
                >
                  {statusLabel(detail.status)}
                </Badge>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs font-semibold text-gradely-muted uppercase">
                  Gender
                </p>
                <p className="mt-1 text-sm text-gradely-text">
                  {detail.gender ? statusLabel(detail.gender) : 'Not supplied'}
                </p>
              </div>
              <div className="rounded-xl bg-gradely-light p-3">
                <p className="text-xs font-semibold text-gradely-muted uppercase">
                  Date of birth
                </p>
                <p className="mt-1 text-sm text-gradely-text">
                  {formatDate(detail.dateOfBirth)}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-gradely-text">
                Enrollment history
              </h3>
              {detail.enrollments.length === 0 ? (
                <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm text-gradely-muted">
                  This pupil has no enrollment records.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-gradely-light text-xs font-semibold text-gradely-muted uppercase">
                      <tr>
                        <th scope="col" className="px-3 py-2">
                          Class
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Academic year
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Started
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Ended
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.enrollments.map((enrollment) => (
                        <tr key={enrollment.id}>
                          <td className="px-3 py-2 whitespace-nowrap font-medium text-gradely-text">
                            {enrollment.className}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                            {enrollment.academicYearName}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                            {formatDate(enrollment.startedOn)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gradely-muted">
                            {formatDate(enrollment.endedOn)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              tone={
                                enrollment.status === 'ACTIVE'
                                  ? 'success'
                                  : 'neutral'
                              }
                            >
                              {statusLabel(enrollment.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={duplicatePrompt !== null}
        title={
          duplicatePrompt?.category === 'NAME_CONFLICT'
            ? 'A pupil with this name already exists'
            : duplicatePrompt?.category === 'EXACT_DUPLICATE'
              ? 'This pupil is already registered'
              : 'This admission number is already in use'
        }
        description={
          duplicatePrompt?.category === 'NAME_CONFLICT'
            ? 'The complete name matches an existing pupil in this school, but the admission number is different.'
            : 'The record cannot be saved because it conflicts with an existing pupil in this school.'
        }
        onClose={() => {
          if (!formBusy) setDuplicatePrompt(null)
        }}
      >
        {duplicatePrompt ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-gradely-light/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                Existing pupil
              </p>
              <p className="mt-1 text-base font-bold text-gradely-text">
                {duplicatePrompt.existingPupil.fullName}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gradely-muted">Admission</dt>
                  <dd className="font-medium text-gradely-text">
                    {duplicatePrompt.existingPupil.admissionNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gradely-muted">Class</dt>
                  <dd className="font-medium text-gradely-text">
                    {duplicatePrompt.existingPupil.currentClassName ??
                      'Not enrolled'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gradely-muted">Status</dt>
                  <dd>
                    <Badge
                      tone={
                        duplicatePrompt.existingPupil.status === 'ACTIVE'
                          ? 'success'
                          : duplicatePrompt.existingPupil.status === 'INACTIVE'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {statusLabel(duplicatePrompt.existingPupil.status)}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </div>

            {duplicatePrompt.category === 'NAME_CONFLICT' ? (
              <p className="text-sm leading-relaxed text-gradely-text">
                Are these records for the same pupil? If they are, do not
                register a second record. Ask a school administrator to open
                Pupil duplicates, compare both records and merge them safely.
                If this is a different pupil who happens to share the same
                name, confirm below to continue.
              </p>
            ) : null}

            {duplicatePrompt.category === 'EXACT_DUPLICATE' ? (
              <p className="text-sm leading-relaxed text-gradely-text">
                This exact name and admission number already exist. Open the
                existing record instead of creating another one.
              </p>
            ) : null}

            {duplicatePrompt.category === 'ADMISSION_CONFLICT' ? (
              <p className="text-sm leading-relaxed text-gradely-text">
                Admission numbers must be unique across the school. Change the
                admission number in the form before saving.
              </p>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <Button
                variant="secondary"
                onClick={() => setDuplicatePrompt(null)}
                disabled={formBusy}
              >
                {duplicatePrompt.category === 'NAME_CONFLICT'
                  ? 'Cancel'
                  : 'Close'}
              </Button>

              {duplicatePrompt.category === 'EXACT_DUPLICATE' ? (
                <Button
                  variant="secondary"
                  onClick={() => void openExistingDuplicate()}
                  disabled={formBusy}
                >
                  View existing record
                </Button>
              ) : null}

              {duplicatePrompt.category === 'NAME_CONFLICT' ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setDuplicatePrompt(null)}
                    disabled={formBusy}
                  >
                    Same pupil — resolve with an administrator
                  </Button>
                  <Button
                    onClick={() => void confirmDifferentPupil()}
                    loading={formBusy}
                  >
                    These are different pupils — continue
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={moveConfirmOpen}
        title="Confirm class move"
        description={
          movingPupil
            ? `${pupilName(movingPupil)} will be enrolled in the selected class and academic year. The previous active enrollment will be marked completed.`
            : ''
        }
        confirmLabel="Confirm move"
        busy={busy}
        onConfirm={() => void confirmMove()}
        onCancel={() => setMoveConfirmOpen(false)}
      />

      <ConfirmDialog
        open={pendingArchive !== null}
        title="Archive this pupil?"
        description={
          pendingArchive
            ? `${pupilName(pendingArchive)} will be removed from active lists and current enrollment. The pupil and all enrollment history remain stored and can be reviewed.`
            : ''
        }
        confirmLabel="Archive pupil"
        danger
        busy={busy}
        onConfirm={() => void confirmArchive()}
        onCancel={() => setPendingArchive(null)}
      />
    </div>
  )
}
