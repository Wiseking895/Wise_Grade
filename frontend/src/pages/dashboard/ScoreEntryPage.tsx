import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Printer,
  RefreshCw,
  Save,
  Send,
  Table2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  Panel,
  SelectField,
} from '../../components/ui'
import {
  getScoreEntry,
  listAuthorizedClassSubjects,
  saveScoreDraft,
  submitScoreResults,
} from '../../assessment/api'
import {
  SUBMISSION_STATUS_LABELS,
  findPreviewBand,
  formatPercent,
  formatScore,
  positionDisplay,
  previewPupilResult,
  pupilName,
  submissionTone,
} from '../../assessment/helpers'
import {
  earlyYearsPerformance,
  isEarlyYearsClass,
} from '../../assessment/early-years'
import { rankProvisionalPositions } from '../../assessment/positions'
import {
  categoryRawTotal,
  isSubmissionLocked,
  printableScore,
  registerReadiness,
  scoreNavigationTarget,
  splitComponents,
  validateScoreInput,
} from '../../assessment/register'
import type {
  AssessmentComponent,
  AuthorizedClassSubject,
  ScoreEntryView,
} from '../../assessment/types'
import { getClassDashboard, listAcademicYears } from '../../schools/api'
import type { AcademicYear, ClassDashboardClass } from '../../schools/types'
import { ApiError, type ApiFieldError } from '../../lib/api'
import { useSchool } from '../../schools/use-school'
import { useAuth } from '../../auth/use-auth'

type ScoreValues = Record<string, Record<string, string>>

interface RegisterMeta {
  label: string
  value: string
  wide?: boolean
}

function valuesFromView(view: ScoreEntryView): ScoreValues {
  const next: ScoreValues = {}

  for (const pupil of view.pupils) {
    next[pupil.pupilId] = { ...pupil.scores }
  }

  return next
}

function normalizeScore(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') {
    return null
  }

  return value.trim()
}

function formatMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function rowBackground(index: number, invalid: boolean): string {
  if (invalid) return 'bg-red-50'
  return index % 2 === 0 ? 'bg-white' : 'bg-[#f4f7fc]'
}

export default function ScoreEntryPage() {
  const { schoolId, membership, role, isSubjectSession } = useSchool()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const initialTermId = searchParams.get('termId') ?? ''
  const initialClassId = searchParams.get('classId') ?? ''
  const initialSubjectId = searchParams.get('subjectId') ?? ''

  const [years, setYears] = useState<AcademicYear[]>([])
  const [yearId, setYearId] = useState('')
  const [termId, setTermId] = useState(initialTermId)
  const [authorized, setAuthorized] = useState<AuthorizedClassSubject[]>([])
  const [assignedClasses, setAssignedClasses] = useState<ClassDashboardClass[]>(
    [],
  )
  const [classId, setClassId] = useState(initialClassId)
  const [subjectId, setSubjectId] = useState(initialSubjectId)

  const [view, setView] = useState<ScoreEntryView | null>(null)
  const [values, setValues] = useState<ScoreValues>({})
  const loadRequestRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<ApiFieldError[]>([])
  const [success, setSuccess] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [pendingChange, setPendingChange] = useState<(() => void) | null>(null)

  const selectedYear = years.find((year) => year.id === yearId)
  const selectedTerm = selectedYear?.terms.find((term) => term.id === termId)

  const classOptions = useMemo(() => {
    const map = new Map<string, string>()

    for (const cls of assignedClasses) {
      map.set(cls.classId, cls.className)
    }

    for (const pair of authorized) {
      map.set(pair.classId, pair.className)
    }

    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [assignedClasses, authorized])

  // A class teacher or restricted subject session never selects a class when
  // they hold zero or one active assignment. The assigned class is resolved by
  // the backend.
  const singleClassTeacher =
    (role === 'CLASS_TEACHER' || isSubjectSession) && classOptions.length <= 1

  const subjectOptions = useMemo(
    () => authorized.filter((pair) => pair.classId === classId),
    [authorized, classId],
  )

  const selectedClass = classOptions.find((option) => option.id === classId)
  const selectedSubject = subjectOptions.find(
    (option) => option.subjectId === subjectId,
  )

  // The server flag is authoritative; the class name keeps the register
  // consistent before the score sheet has loaded.
  const earlyYears =
    view?.earlyYears ??
    isEarlyYearsClass({ name: selectedClass?.name ?? null })

  const locked = isSubmissionLocked(view?.submission?.status ?? null)

  // A sheet owned by an active subject teacher is strictly read-only for the
  // class teacher, including drafts, submission and corrections.
  const readOnly = view?.readOnly ?? selectedSubject?.readOnly ?? false
  const subjectTeacherName =
    view?.subjectTeacherName ?? selectedSubject?.subjectTeacherName ?? null
  const editsDisabled = locked || readOnly

  const componentGroups = useMemo(() => {
    if (!view?.policy) {
      return { sba: [] as AssessmentComponent[], exam: [] as AssessmentComponent[] }
    }

    return splitComponents(view.policy.components)
  }, [view])

  const groupTotals = useMemo(
    () => ({
      sba: categoryRawTotal(componentGroups.sba, {}),
      exam: categoryRawTotal(componentGroups.exam, {}),
    }),
    [componentGroups],
  )

  const showRemark =
    earlyYears ||
    (view?.policy?.gradingScheme.bands.some(
      (band) => band.remark.trim() !== '',
    ) ??
      false)

  const localReadiness = useMemo(
    () =>
      view?.policy
        ? registerReadiness(view.policy.components, view.pupils, values)
        : null,
    [values, view],
  )

  // Live provisional ranking. This mirrors the backend's integer-hundredth
  // comparison and configured tie policy, so the register updates on every
  // keystroke without waiting for a save, submission or acceptance.
  const provisionalPositions = useMemo(() => {
    const positions = new Map<string, number | null>()

    if (!view?.policy || !view.ranking.enabled) {
      return positions
    }

    const eligible = view.pupils.filter(
      (pupil) => pupil.subjectPositionStatus !== 'NOT_ELIGIBLE',
    )
    const ranks = rankProvisionalPositions(
      eligible.map((pupil) => {
        const preview = previewPupilResult(
          view.policy!.components,
          values[pupil.pupilId] ?? {},
          view.policy!.calculationMode,
        )

        return {
          pupilId: pupil.pupilId,
          name: [pupil.firstName, pupil.lastName, pupil.otherNames]
            .filter(
              (part): part is string => Boolean(part && part.trim()),
            )
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
          finalScore: preview.final,
        }
      }),
      view.ranking.tiePolicy,
    )

    // Every eligible pupil gets an explicit entry. An incomplete pupil maps to
    // null so clearing a mark immediately shows a dash instead of falling back
    // to the last saved backend position.
    for (const pupil of eligible) {
      positions.set(pupil.pupilId, ranks.get(pupil.pupilId) ?? null)
    }

    return positions
  }, [values, view])

  const teacherName = user
    ? `${user.firstName} ${user.lastName}`.trim()
    : ''
  const ownerName =
    view?.ownerName ?? subjectTeacherName ?? teacherName ?? ''

  const meta: RegisterMeta[] = [
    {
      label: 'School',
      value: membership?.schoolName ?? '--',
      wide: true,
    },
    {
      label: 'Academic year',
      value: selectedYear?.name ?? '--',
    },
    {
      label: 'Term',
      value: selectedTerm?.name ?? '--',
    },
    {
      label: 'Class',
      value: selectedClass?.name ?? '--',
    },
    {
      label: 'Subject',
      value: selectedSubject?.subjectName ?? '--',
    },
    {
      label: 'Teacher / entered by',
      value: ownerName || '--',
    },
    {
      label: 'Pupils on roll',
      value: view ? String(view.pupils.length) : '--',
    },
  ]

  const loadYears = useCallback(async () => {
    if (!schoolId) return

    try {
      const [yearResponse, pairResponse, dashboardResponse] = await Promise.all([
        listAcademicYears(schoolId),
        listAuthorizedClassSubjects(schoolId),
        role === 'CLASS_TEACHER'
          ? getClassDashboard(schoolId)
          : Promise.resolve({ classes: [] as ClassDashboardClass[] }),
      ])
      const pairs = pairResponse.classSubjects
      const assigned = dashboardResponse.classes
      const pairClassIds = [
        ...new Set([
          ...pairs.map((pair) => pair.classId),
          ...assigned.map((item) => item.classId),
        ]),
      ]
      const assignedClassId =
        role === 'CLASS_TEACHER' && pairClassIds.length === 1
          ? pairClassIds[0]
          : undefined

      setYears(yearResponse.academicYears)
      setAuthorized(pairs)
      setAssignedClasses(assigned)

      const nextYear =
        yearResponse.academicYears.find((year) => year.isCurrent) ??
        yearResponse.academicYears[0]
      const requestedTermYear = yearResponse.academicYears.find((year) =>
        year.terms.some((term) => term.id === initialTermId),
      )
      setYearId((current) => current || requestedTermYear?.id || nextYear?.id || '')
      setTermId(
        (current) =>
          current ||
          nextYear?.terms.find((term) => term.isCurrent)?.id ||
          nextYear?.terms[0]?.id ||
          '',
      )

      // The assigned class wins for a single-class class teacher. A manipulated
      // classId in the URL is ignored and corrected here and on the server.
      const requestedClassId =
        assignedClassId ??
        (initialClassId && pairClassIds.includes(initialClassId)
          ? initialClassId
          : pairClassIds[0] ?? '')

      setClassId(requestedClassId)
      setSubjectId((current) => {
        if (
          current &&
          pairs.some(
            (pair) =>
              pair.classId === requestedClassId && pair.subjectId === current,
          )
        ) {
          return current
        }

        const requestedSubject = pairs.find(
          (pair) =>
            pair.classId === requestedClassId &&
            pair.subjectId === initialSubjectId,
        )

        return (
          requestedSubject?.subjectId ??
          pairs.find((pair) => pair.classId === requestedClassId)?.subjectId ??
          ''
        )
      })
    } catch (cause) {
      setErrorDetails([])
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load score entry options.',
      )
    }
  }, [initialClassId, initialSubjectId, initialTermId, role, schoolId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadYears()
  }, [loadYears])

  const loadView = useCallback(async () => {
    if (!schoolId || !termId || !classId || !subjectId) {
      // Invalidate any in-flight request so a late response cannot restore a
      // sheet after the selection was cleared.
      loadRequestRef.current += 1
      setView(null)
      setValues({})
      setLoading(false)
      return
    }

    // Only the most recent selection may update the register. Without this
    // guard, a slow refresh of the previous subject can resolve after the new
    // subject and silently replace it with stale scores.
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId

    try {
      setLoading(true)
      const response = await getScoreEntry(schoolId, {
        academicTermId: termId,
        classId,
        subjectId,
      })

      if (loadRequestRef.current !== requestId) return

      setView(response.scoreEntry)
      setValues(valuesFromView(response.scoreEntry))
      setDirty(false)
      setError(null)
      setErrorDetails([])
    } catch (cause) {
      if (loadRequestRef.current !== requestId) return

      setView(null)
      setValues({})
      setErrorDetails([])
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the score sheet.',
      )
    } finally {
      if (loadRequestRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [classId, schoolId, subjectId, termId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadView()
  }, [loadView])

  useEffect(() => {
    if (!dirty) return

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function guardSelectionChange(action: () => void) {
    if (!dirty) {
      action()
      return
    }

    setPendingChange(() => action)
  }

  function changeYear(nextYearId: string) {
    guardSelectionChange(() => {
      setYearId(nextYearId)
      const nextYear = years.find((year) => year.id === nextYearId)
      setTermId(
        nextYear?.terms.find((term) => term.isCurrent)?.id ??
          nextYear?.terms[0]?.id ??
          '',
      )
    })
  }

  function changeTerm(nextTermId: string) {
    guardSelectionChange(() => setTermId(nextTermId))
  }

  function changeClass(nextClassId: string) {
    guardSelectionChange(() => {
      setClassId(nextClassId)
      const firstSubject = authorized.find(
        (pair) => pair.classId === nextClassId,
      )
      setSubjectId(firstSubject?.subjectId ?? '')
    })
  }

  function changeSubject(nextSubjectId: string) {
    guardSelectionChange(() => setSubjectId(nextSubjectId))
  }

  function updateScore(
    pupilId: string,
    componentId: string,
    value: string,
  ) {
    if (editsDisabled) return

    setValues((current) => ({
      ...current,
      [pupilId]: {
        ...(current[pupilId] ?? {}),
        [componentId]: value,
      },
    }))
    setDirty(true)
    setSuccess(null)
  }

  function buildInput() {
    if (!view) return null

    return {
      academicTermId: termId,
      classId,
      subjectId,
      expectedVersion: view.submission?.version ?? 0,
      pupils: view.pupils.map((pupil) => ({
        pupilId: pupil.pupilId,
        scores: view.policy!.components.map((component) => ({
          componentId: component.id,
          score: normalizeScore(values[pupil.pupilId]?.[component.id]),
        })),
      })),
    }
  }

  async function save() {
    if (!schoolId || readOnly) return

    const input = buildInput()

    if (!input) return

    setSaving(true)
    setError(null)
    setErrorDetails([])
    setSuccess(null)

    try {
      const response = await saveScoreDraft(schoolId, input)
      setView(response.scoreEntry)
      setValues(valuesFromView(response.scoreEntry))
      setDirty(false)
      setSuccess(
        response.scoreEntry.submission?.status === 'DRAFT'
          ? 'Draft saved. Missing cells remain unfilled and are not treated as zero.'
          : 'Draft saved.',
      )
    } catch (cause) {
      setErrorDetails(
        cause instanceof ApiError && Array.isArray(cause.details)
          ? cause.details
          : [],
      )
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the draft.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!schoolId || readOnly) return

    const input = buildInput()

    if (!input) return

    setSubmitting(true)
    setError(null)
    setErrorDetails([])
    setSuccess(null)

    try {
      const response = await submitScoreResults(schoolId, input)
      setSuccess(
        `Results submitted for ${response.submission.className} ${response.submission.subjectName}. They are now locked until a school administrator returns them for correction.`,
      )
      // The submitted sheet is locked and immutable; clear the local dirty flag
      // immediately so changing subject does not prompt about "unsaved" edits
      // while the refreshed register is still loading.
      setDirty(false)
      await loadView()
    } catch (cause) {
      setErrorDetails(
        cause instanceof ApiError && Array.isArray(cause.details)
          ? cause.details
          : [],
      )
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not submit the results.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  function handleCellPaste(
    event: ClipboardEvent<HTMLInputElement>,
    pupilIndex: number,
    componentIndex: number,
  ) {
    if (!view?.policy || editsDisabled) return

    const text = event.clipboardData.getData('text')

    if (!text.includes('\t') && !text.includes('\n') && !text.includes('\r')) {
      return
    }

    event.preventDefault()

    const groups = splitComponents(view.policy.components)
    const orderedComponents = [...groups.sba, ...groups.exam]
    const rows = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((line, index, all) => !(index === all.length - 1 && line === ''))

    setValues((current) => {
      const next: ScoreValues = { ...current }

      rows.forEach((row, rowOffset) => {
        const pupil = view.pupils[pupilIndex + rowOffset]

        if (!pupil) return

        const pupilValues = { ...(next[pupil.pupilId] ?? {}) }

        row.split('\t').forEach((cell, columnOffset) => {
          const component = orderedComponents[componentIndex + columnOffset]

          if (!component) return

          pupilValues[component.id] = cell.trim()
        })

        next[pupil.pupilId] = pupilValues
      })

      return next
    })
    setDirty(true)
    setSuccess('Pasted values into the register. Review them, then save the draft.')
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    pupilIndex: number,
    componentIndex: number,
  ) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!editsDisabled && !saving && !submitting) void save()
      return
    }

    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return

    event.preventDefault()
    const targetId = scoreNavigationTarget(
      event.key,
      pupilIndex,
      componentIndex,
      view?.pupils.length ?? 0,
      event.shiftKey,
    )

    if (targetId) {
      document.getElementById(targetId)?.focus()
    }
  }

  const canSubmit =
    Boolean(view) &&
    !readOnly &&
    Boolean(localReadiness?.canSubmit) &&
    !locked &&
    !saving &&
    !submitting

  return (
    <div className="space-y-6 print:space-y-0">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:hidden">
        <div className="bg-gradely-navy px-5 py-5 text-white sm:px-6">
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.35em] text-gradely-gold">
            WISE GRADE
          </p>
          <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                SCHOOL-BASED ASSESSMENT (SBA)
              </h1>
              <p className="mt-1 text-xs text-white/75">
                Smarter Reports. Better Learning.
              </p>
            </div>
            {view?.policy ? (
              <div className="flex flex-wrap items-center gap-2">
                {view.submission ? (
                  <Badge tone={submissionTone(view.submission.status)}>
                    {SUBMISSION_STATUS_LABELS[view.submission.status]}
                  </Badge>
                ) : null}
                {locked ? (
                  <Badge tone="warning">
                    <Lock aria-hidden="true" className="mr-1 size-3" />
                    Locked
                  </Badge>
                ) : null}
                {readOnly ? (
                  <Badge tone="info">
                    <Lock aria-hidden="true" className="mr-1 size-3" />
                    Read-only
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-4">
          {meta.map((item) => (
            <div
              key={item.label}
              className={item.wide ? 'col-span-2' : undefined}
            >
              <dt className="text-[0.65rem] font-bold uppercase tracking-wide text-gradely-muted">
                {item.label}
              </dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-gradely-text">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        {view ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-gradely-light px-5 py-3 sm:px-6">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDiscardOpen(true)}
              disabled={!dirty || saving || submitting}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Reload
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void save()}
              loading={saving}
              disabled={
                editsDisabled || submitting || view.pupils.length === 0
              }
            >
              <Save aria-hidden="true" className="size-4" />
              Save draft
            </Button>
            <Button
              size="sm"
              onClick={() => setSubmitOpen(true)}
              loading={submitting}
              disabled={!canSubmit}
            >
              <Send aria-hidden="true" className="size-4" />
              Submit results
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer aria-hidden="true" className="size-4" />
              Print register
            </Button>
            <span className="ml-auto text-xs text-gradely-muted">
              {dirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="print:hidden">
          <ErrorNotice message={error} onRetry={() => void loadView()} />
        </div>
      ) : null}
      {errorDetails.length > 0 ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 print:hidden"
        >
          <p className="font-semibold">The server rejected these values:</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {errorDetails.map((detail, index) => (
              <li key={`${detail.field}-${index}`}>
                {detail.message}{' '}
                <span className="font-mono text-xs text-red-700/70">
                  ({detail.field})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {success ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-medium text-[#137026] print:hidden"
        >
          {success}
        </div>
      ) : null}

      <div className="print:hidden">
        <Panel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label="Academic year"
              value={yearId}
              onChange={(event) => changeYear(event.target.value)}
            >
              <option value="">Select a year</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Academic term"
              value={termId}
              onChange={(event) => changeTerm(event.target.value)}
            >
              <option value="">Select a term</option>
              {selectedYear?.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </SelectField>
            {singleClassTeacher ? (
              <div>
                <p className="text-sm font-semibold text-gradely-text">
                  Class
                </p>
                <p className="mt-1.5 rounded-xl border border-slate-200 bg-gradely-light px-3.5 py-2.5 text-sm font-semibold text-gradely-text">
                  {selectedClass?.name ??
                    (classOptions.length === 0
                      ? 'No class assigned'
                      : 'Assigned class')}
                </p>
                <p className="mt-1.5 text-xs text-gradely-muted">
                  {classOptions.length === 0
                    ? isSubjectSession
                      ? 'This access code is not linked to an active class assignment. Ask your class teacher for a new code.'
                      : 'Ask a school administrator to assign you to a class.'
                    : 'Automatically loaded from your active class assignment.'}
                </p>
              </div>
            ) : (
              <SelectField
                label="Class"
                value={classId}
                onChange={(event) => changeClass(event.target.value)}
              >
                <option value="">Select a class</option>
                {classOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </SelectField>
            )}
            <SelectField
              label="Subject"
              value={subjectId}
              onChange={(event) => changeSubject(event.target.value)}
              disabled={!classId}
            >
              <option value="">Select a subject</option>
              {subjectOptions.map((option) => (
                <option key={option.subjectId} value={option.subjectId}>
                  {option.subjectName}
                </option>
              ))}
            </SelectField>
          </div>

          {authorized.length === 0 ? (
            <p className="mt-4 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-sm text-[#7a5400]">
              {isSubjectSession
                ? 'Your assigned subject is not currently available. Ask your class teacher to check the class subject or issue a new access code.'
                : role === 'CLASS_TEACHER'
                  ? classOptions.length === 0
                    ? 'No class is currently assigned to you. Ask a school administrator to assign you to a class.'
                    : 'No subjects have been registered for your assigned class yet. Register subjects from your Class Dashboard before entering scores.'
                  : 'You do not have an authorized class and subject yet. Ask a school administrator to assign you or grant an explicit permission.'}
            </p>
          ) : null}
        </Panel>
      </div>

      {loading ? (
        <LoadingPanel label="Loading the SBA register..." />
      ) : !view ? (
        <EmptyState
          icon={Table2}
          title={
            singleClassTeacher
              ? 'Choose a term and subject'
              : 'Choose a term, class and subject'
          }
          description={
            singleClassTeacher
              ? 'The register loads the active assessment policy for your assigned class and term, together with the current pupil roster.'
              : 'The register loads the active assessment policy for that class and term, together with the current pupil roster.'
          }
        />
      ) : !view.policy ? (
        <EmptyState
          icon={AlertTriangle}
          title="No assessment policy applies"
          description="A school administrator must configure an assessment policy for this class or term before scores can be entered."
        />
      ) : (
        <>
          <div className="print:hidden">
            <Panel>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-gradely-text">
                      Score sheet
                    </h2>
                    {view.submission ? (
                      <Badge tone={submissionTone(view.submission.status)}>
                        {SUBMISSION_STATUS_LABELS[view.submission.status]}
                      </Badge>
                    ) : null}
                    {locked ? (
                      <Badge tone="warning">
                        <Lock aria-hidden="true" className="mr-1 size-3" />
                        Locked
                      </Badge>
                    ) : null}
                    {readOnly ? (
                      <Badge tone="info">
                        <Lock aria-hidden="true" className="mr-1 size-3" />
                        Read-only
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>

              {view.submission?.status === 'RETURNED_FOR_CORRECTION' &&
              view.submission.lastComment ? (
                <div className="mt-4 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-sm text-[#7a5400]">
                  <p className="font-bold">Returned for correction</p>
                  <p className="mt-1">{view.submission.lastComment}</p>
                </div>
              ) : null}

              {readOnly ? (
                <p className="mt-4 rounded-xl border border-gradely-blue/30 bg-gradely-blue/10 p-3 text-sm text-gradely-navy">
                  <span className="font-bold">Read-only sheet.</span>{' '}
                  {subjectTeacherName
                    ? `${subjectTeacherName} is the assigned subject teacher and owns this score sheet.`
                    : 'An assigned subject teacher owns this score sheet.'}{' '}
                  You can review the saved scores, assessment components and
                  submission status, but you cannot edit, overwrite, delete or
                  submit them.
                </p>
              ) : null}

              {locked ? (
                <p className="mt-4 rounded-xl border border-slate-200 bg-gradely-light p-3 text-sm text-gradely-muted">
                  {view.submission?.status === 'SUBMITTED'
                    ? 'These results are submitted and locked. A school administrator can return them for correction.'
                    : 'These results have been accepted and are immutable. Later changes require a new assessment cycle.'}
                </p>
              ) : null}

            </Panel>
          </div>

          {view.pupils.length === 0 ? (
            <EmptyState
              icon={Table2}
              title="No active pupils"
              description="Enrol pupils in this class for the academic year before entering scores."
            />
          ) : (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-bold text-gradely-text">
                      {selectedClass?.name ?? view.submission?.className ?? 'Class'}{' '}
                      -{' '}
                      {selectedSubject?.subjectName ??
                        view.submission?.subjectName ??
                        'Subject'}{' '}
                      register
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-gradely-muted">
                      {readOnly
                        ? `Read-only: ${subjectTeacherName ?? 'the assigned subject teacher'} owns this sheet. Review the saved scores, components and submission status only.`
                        : 'Tab moves across the register. Enter or the up/down arrow keys move down a column; Shift+Enter moves up. Ctrl+Enter saves a draft. Paste tab-separated values from a spreadsheet to fill several pupils at once.'}
                    </p>
                  </div>
                  <div className="shrink-0 text-xs text-gradely-muted sm:text-right">
                    <p className="font-semibold text-gradely-text">
                      {dirty ? 'Unsaved changes' : 'All changes saved'}
                    </p>
                    <p>
                      {localReadiness?.completePupils ?? 0}/
                      {view.pupils.length} complete
                    </p>
                  </div>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gradely-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-gradely-gold"
                    />
                    Blank means missing
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-gradely-green"
                    />
                    0 is a real score
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-red-500"
                    />
                    Invalid input is marked in red
                  </span>
                  {view.ranking.enabled &&
                  view.submission?.status !== 'ACCEPTED' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-gradely-navy"
                      />
                      Provisional positions update as scores change
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="max-h-[72vh] overflow-auto">
                <table className="w-max min-w-full border-collapse text-sm">
                  <caption className="sr-only">
                    SBA score register for the selected class and subject
                  </caption>
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-gradely-navy text-left text-xs font-bold text-white">
                      <th
                        scope="col"
                        rowSpan={2}
                        className="border border-white/25 px-2 py-2 text-center"
                      >
                        No.
                      </th>
                      <th
                        scope="col"
                        rowSpan={2}
                        className="border border-white/25 px-2 py-2"
                      >
                        Admission no.
                      </th>
                      <th
                        scope="col"
                        rowSpan={2}
                        className="sticky left-0 z-30 min-w-[9.5rem] border border-white/25 bg-gradely-navy px-3 py-2 sm:min-w-[11rem]"
                      >
                        Pupil
                      </th>
                      {componentGroups.sba.length > 0 ? (
                        <th
                          scope="colgroup"
                          colSpan={componentGroups.sba.length}
                          className="border border-white/25 px-2 py-2 text-center"
                        >
                          Continuous assessment (SBA)
                        </th>
                      ) : null}
                      {componentGroups.sba.length > 0 ? (
                        <th
                          scope="col"
                          rowSpan={2}
                          className="border border-white/25 px-2 py-2 text-right"
                        >
                          <span className="block">Class Score</span>
                          <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                            /{formatMark(groupTotals.sba.maximum)}
                          </span>
                        </th>
                      ) : null}
                      {componentGroups.sba.length > 0 ? (
                        <th
                          scope="col"
                          rowSpan={2}
                          className="border border-white/25 px-2 py-2 text-right"
                        >
                          <span className="block">SBA Scaled</span>
                          <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                            /{formatMark(groupTotals.sba.weight)}
                          </span>
                        </th>
                      ) : null}
                      {componentGroups.exam.length > 0 ? (
                        <th
                          scope="colgroup"
                          colSpan={componentGroups.exam.length}
                          className="border border-white/25 px-2 py-2 text-center"
                        >
                          End-of-Term Examination
                        </th>
                      ) : null}
                      {componentGroups.exam.length > 1 ? (
                        <th
                          scope="col"
                          rowSpan={2}
                          className="border border-white/25 px-2 py-2 text-right"
                        >
                          <span className="block">Examination Total</span>
                          <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                            /{formatMark(groupTotals.exam.maximum)}
                          </span>
                        </th>
                      ) : null}
                      {componentGroups.exam.length > 0 ? (
                        <th
                          scope="col"
                          rowSpan={2}
                          className="border border-white/25 px-2 py-2 text-right"
                        >
                          <span className="block">Examination Scaled</span>
                          <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                            /{formatMark(groupTotals.exam.weight)}
                          </span>
                        </th>
                      ) : null}
                      <th
                        scope="col"
                        rowSpan={2}
                        className="border border-white/25 px-2 py-2 text-right"
                      >
                        <span className="block">Final Score</span>
                        <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                          /100
                        </span>
                      </th>
                      <th
                        scope="col"
                        rowSpan={2}
                        className="border border-white/25 px-2 py-2 text-center"
                      >
                        <span className="block">Position</span>
                      </th>
                      <th
                        scope="col"
                        rowSpan={2}
                        className="border border-white/25 px-2 py-2"
                      >
                        {earlyYears ? 'Remark' : 'Grade'}
                      </th>
                      {!earlyYears && showRemark ? (
                        <th
                          scope="col"
                          rowSpan={2}
                          className="border border-white/25 px-2 py-2"
                        >
                          Remark
                        </th>
                      ) : null}
                    </tr>
                    <tr className="bg-gradely-navy text-xs font-bold text-white">
                      {componentGroups.sba.map((component) => (
                        <th
                          key={component.id}
                          scope="col"
                          className="border border-white/25 px-2 py-2 text-center"
                        >
                          <span className="block">{component.name}</span>
                          <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                            max {formatMark(Number(component.maximumScore))}
                            {view.policy!.calculationMode ===
                            'COMPONENT_WEIGHTED'
                              ? ` (${formatPercent(component.weightPercent)})`
                              : ''}
                          </span>
                        </th>
                      ))}
                      {componentGroups.exam.map((component) => (
                        <th
                          key={component.id}
                          scope="col"
                          className="border border-white/25 px-2 py-2 text-center"
                        >
                          <span className="block">{component.name}</span>
                          <span className="mt-0.5 block text-[0.65rem] font-normal text-white/80">
                            max {formatMark(Number(component.maximumScore))}
                            {view.policy!.calculationMode ===
                            'COMPONENT_WEIGHTED'
                              ? ` (${formatPercent(component.weightPercent)})`
                              : ''}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.pupils.map((pupil, pupilIndex) => {
                      const pupilValues = values[pupil.pupilId] ?? {}
                      const preview = previewPupilResult(
                        view.policy!.components,
                        pupilValues,
                        view.policy!.calculationMode,
                      )
                      const band = findPreviewBand(
                        view.policy!.gradingScheme.bands,
                        preview.final,
                      )
                      const earlyYearsResult = earlyYears
                        ? earlyYearsPerformance(preview.finalUnrounded)
                        : null
                      const checks = view.policy!.components.map((component) =>
                        validateScoreInput(
                          pupilValues[component.id],
                          component.maximumScore,
                        ),
                      )
                      const missingCount = checks.filter(
                        (check) => check.state === 'missing',
                      ).length
                      const invalidCount = checks.filter(
                        (check) => check.state === 'invalid',
                      ).length
                      const complete =
                        missingCount === 0 && invalidCount === 0
                      const sbaTotal = categoryRawTotal(
                        componentGroups.sba,
                        pupilValues,
                      )
                      const examTotal = categoryRawTotal(
                        componentGroups.exam,
                        pupilValues,
                      )
                      const background = rowBackground(
                        pupilIndex,
                        invalidCount > 0,
                      )

                      return (
                        <tr
                          key={pupil.pupilId}
                          className={`${background} border-b border-slate-200`}
                        >
                          <td className="border border-slate-300 px-2 py-1 text-center text-xs font-semibold tabular-nums text-gradely-muted">
                            {String(pupilIndex + 1).padStart(2, '0')}
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-xs tabular-nums text-gradely-text">
                            {pupil.admissionNumber}
                          </td>
                          <th
                            scope="row"
                            className={`sticky left-0 z-10 min-w-[9.5rem] max-w-[16rem] border border-slate-300 px-3 py-1 text-left sm:min-w-[11rem] ${background}`}
                          >
                            <p className="truncate font-semibold text-gradely-text">
                              {pupilName(pupil)}
                            </p>
                            <span
                              id={`register-status-${pupilIndex}`}
                              className={`mt-0.5 block text-[0.62rem] font-bold uppercase tracking-wide ${
                                invalidCount > 0
                                  ? 'text-red-700'
                                  : missingCount > 0
                                    ? 'text-[#7a5400]'
                                    : 'text-[#137026]'
                              }`}
                            >
                              {invalidCount > 0
                                ? `${invalidCount} invalid`
                                : missingCount > 0
                                  ? `${missingCount} missing`
                                  : 'Complete'}
                            </span>
                          </th>
                          {componentGroups.sba.map((component, componentIndex) => {
                            const rawValue = pupilValues[component.id] ?? ''
                            const check = validateScoreInput(
                              rawValue,
                              component.maximumScore,
                            )
                            const invalid = check.state === 'invalid'
                            const missing = check.state === 'missing'
                            const errorId = `score-error-${pupilIndex}-${componentIndex}`

                            return (
                              <td
                                key={component.id}
                                className="border border-slate-300 px-1 py-1"
                              >
                                <div className="relative">
                                  <input
                                    id={`score-${pupilIndex}-${componentIndex}`}
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    value={rawValue}
                                    onChange={(event) =>
                                      updateScore(
                                        pupil.pupilId,
                                        component.id,
                                        event.target.value,
                                      )
                                    }
                                    onFocus={(event) =>
                                      event.currentTarget.select()
                                    }
                                    onPaste={(event) =>
                                      handleCellPaste(
                                        event,
                                        pupilIndex,
                                        componentIndex,
                                      )
                                    }
                                    onKeyDown={(event) =>
                                      handleCellKeyDown(
                                        event,
                                        pupilIndex,
                                        componentIndex,
                                      )
                                    }
                                    disabled={editsDisabled}
                                    placeholder="-"
                                    title={
                                      check.message ??
                                      (missing ? 'Missing score' : undefined)
                                    }
                                    aria-label={`${pupilName(pupil)} ${component.name}, maximum ${component.maximumScore}${missing ? ', missing score' : ''}`}
                                    aria-invalid={invalid ? true : undefined}
                                    aria-describedby={
                                      invalid
                                        ? errorId
                                        : `register-status-${pupilIndex}`
                                    }
                                    className={`w-16 rounded-md border px-1.5 py-1 text-right text-sm tabular-nums shadow-sm outline-none transition-colors focus:border-gradely-blue focus:ring-2 focus:ring-gradely-blue/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-gradely-muted ${
                                      invalid
                                        ? 'border-red-500 bg-red-50 text-red-800'
                                        : missing
                                          ? 'border-slate-300 bg-white'
                                          : 'border-slate-300 bg-white'
                                    }`}
                                  />
                                  {missing ? (
                                    <span
                                      aria-hidden="true"
                                      className="pointer-events-none absolute left-1 top-1 size-1.5 rounded-full bg-gradely-gold"
                                    />
                                  ) : null}
                                  {invalid && check.message ? (
                                    <span
                                      id={errorId}
                                      className="sr-only"
                                    >
                                      {check.message}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            )
                          })}
                          {componentGroups.sba.length > 0 ? (
                            <td className="border border-slate-300 px-2 py-1 text-right text-xs tabular-nums text-gradely-text">
                              {sbaTotal.enteredTotal === null
                                ? '--'
                                : formatScore(sbaTotal.enteredTotal)}
                              <span className="ml-1 text-[0.65rem] text-gradely-muted">
                                /{formatMark(sbaTotal.maximum)}
                              </span>
                            </td>
                          ) : null}
                          {componentGroups.sba.length > 0 ? (
                            <td className="border border-slate-300 px-2 py-1 text-right text-xs font-semibold tabular-nums text-gradely-text">
                              {formatScore(preview.sba)}
                              <span className="ml-1 text-[0.65rem] font-normal text-gradely-muted">
                                /{formatMark(sbaTotal.weight)}
                              </span>
                            </td>
                          ) : null}
                          {componentGroups.exam.map((component, componentIndex) => {
                            const baseIndex = componentGroups.sba.length
                            const rawValue = pupilValues[component.id] ?? ''
                            const check = validateScoreInput(
                              rawValue,
                              component.maximumScore,
                            )
                            const invalid = check.state === 'invalid'
                            const missing = check.state === 'missing'
                            const errorId = `score-error-${pupilIndex}-${baseIndex + componentIndex}`

                            return (
                              <td
                                key={component.id}
                                className="border border-slate-300 px-1 py-1"
                              >
                                <div className="relative">
                                  <input
                                    id={`score-${pupilIndex}-${baseIndex + componentIndex}`}
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    value={rawValue}
                                    onChange={(event) =>
                                      updateScore(
                                        pupil.pupilId,
                                        component.id,
                                        event.target.value,
                                      )
                                    }
                                    onFocus={(event) =>
                                      event.currentTarget.select()
                                    }
                                    onPaste={(event) =>
                                      handleCellPaste(
                                        event,
                                        pupilIndex,
                                        baseIndex + componentIndex,
                                      )
                                    }
                                    onKeyDown={(event) =>
                                      handleCellKeyDown(
                                        event,
                                        pupilIndex,
                                        baseIndex + componentIndex,
                                      )
                                    }
                                    disabled={editsDisabled}
                                    placeholder="-"
                                    title={
                                      check.message ??
                                      (missing ? 'Missing score' : undefined)
                                    }
                                    aria-label={`${pupilName(pupil)} ${component.name}, maximum ${component.maximumScore}${missing ? ', missing score' : ''}`}
                                    aria-invalid={invalid ? true : undefined}
                                    aria-describedby={
                                      invalid
                                        ? errorId
                                        : `register-status-${pupilIndex}`
                                    }
                                    className={`w-16 rounded-md border px-1.5 py-1 text-right text-sm tabular-nums shadow-sm outline-none transition-colors focus:border-gradely-blue focus:ring-2 focus:ring-gradely-blue/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-gradely-muted ${
                                      invalid
                                        ? 'border-red-500 bg-red-50 text-red-800'
                                        : 'border-slate-300 bg-white'
                                    }`}
                                  />
                                  {missing ? (
                                    <span
                                      aria-hidden="true"
                                      className="pointer-events-none absolute left-1 top-1 size-1.5 rounded-full bg-gradely-gold"
                                    />
                                  ) : null}
                                  {invalid && check.message ? (
                                    <span
                                      id={errorId}
                                      className="sr-only"
                                    >
                                      {check.message}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            )
                          })}
                          {componentGroups.exam.length > 1 ? (
                            <td className="border border-slate-300 px-2 py-1 text-right text-xs tabular-nums text-gradely-text">
                              {examTotal.enteredTotal === null
                                ? '--'
                                : formatScore(examTotal.enteredTotal)}
                              <span className="ml-1 text-[0.65rem] text-gradely-muted">
                                /{formatMark(examTotal.maximum)}
                              </span>
                            </td>
                          ) : null}
                          {componentGroups.exam.length > 0 ? (
                            <td className="border border-slate-300 px-2 py-1 text-right text-xs font-semibold tabular-nums text-gradely-text">
                              {formatScore(preview.exam)}
                              <span className="ml-1 text-[0.65rem] font-normal text-gradely-muted">
                                /{formatMark(examTotal.weight)}
                              </span>
                            </td>
                          ) : null}
                          <td className="border border-slate-300 px-2 py-1 text-right text-xs font-bold tabular-nums text-gradely-navy">
                            {formatScore(preview.final)}
                            <span className="ml-1 text-[0.65rem] font-normal text-gradely-muted">
                              /100
                            </span>
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-center text-xs font-semibold tabular-nums text-gradely-text">
                            {positionDisplay(
                              pupil,
                              provisionalPositions.get(pupil.pupilId) ?? null,
                            )}
                          </td>
                          <td className="border border-slate-300 px-2 py-1 text-xs">
                            {earlyYears ? (
                              earlyYearsResult && complete ? (
                                <span className="font-bold text-gradely-text">
                                  {earlyYearsResult.display}
                                </span>
                              ) : (
                                <span className="text-gradely-muted">
                                  {invalidCount > 0 ? 'Check' : '--'}
                                </span>
                              )
                            ) : band && complete ? (
                              <span className="font-bold text-gradely-text">
                                {band.gradeLabel}
                              </span>
                            ) : (
                              <span className="text-gradely-muted">
                                {invalidCount > 0 ? 'Check' : '--'}
                              </span>
                            )}
                          </td>
                          {!earlyYears && showRemark ? (
                            <td className="max-w-[12rem] border border-slate-300 px-2 py-1 text-xs text-gradely-muted">
                              {band && complete ? band.remark : '--'}
                            </td>
                          ) : null}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm print:hidden">
            <p className="flex items-center gap-2 text-gradely-muted">
              {readOnly ? (
                <>
                  <Lock aria-hidden="true" className="size-4 text-gradely-blue" />
                  Read-only — owned by {subjectTeacherName ?? 'the subject teacher'}
                </>
              ) : dirty ? (
                <>
                  <AlertTriangle
                    aria-hidden="true"
                    className="size-4 text-[#7a5400]"
                  />
                  Unsaved changes
                </>
              ) : (
                <>
                  <CheckCircle2
                    aria-hidden="true"
                    className="size-4 text-[#137026]"
                  />
                  All changes saved
                </>
              )}
            </p>
            {view.submission ? (
              <p className="text-xs text-gradely-muted">
                Submission version {view.submission.version}
                {view.submission.submittedAt
                  ? ` - submitted ${new Date(view.submission.submittedAt).toLocaleString()}`
                  : ''}
              </p>
            ) : null}
          </div>
        </>
      )}

      {view?.policy && view.pupils.length > 0 ? (
        <div className="hidden print:block print-register">
          <header className="mb-3 border-b-2 border-slate-800 pb-2">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[8pt] font-bold uppercase tracking-[0.3em]">
                  WISE GRADE
                </p>
                <h1 className="text-[15pt] font-extrabold uppercase leading-tight">
                  School-Based Assessment (SBA) Register
                </h1>
                <p className="text-[9pt]">
                  {membership?.schoolName ?? 'School'}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[8pt]">
                <div>
                  <dt className="inline font-bold">Academic year: </dt>
                  <dd className="inline">{selectedYear?.name ?? '--'}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Term: </dt>
                  <dd className="inline">{selectedTerm?.name ?? '--'}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Class: </dt>
                  <dd className="inline">{selectedClass?.name ?? '--'}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Subject: </dt>
                  <dd className="inline">{selectedSubject?.subjectName ?? '--'}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Teacher: </dt>
                  <dd className="inline">{ownerName || '--'}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Pupils on roll: </dt>
                  <dd className="inline">{view.pupils.length}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">Status: </dt>
                  <dd className="inline">
                    {view.submission
                      ? SUBMISSION_STATUS_LABELS[view.submission.status]
                      : 'Draft (not saved)'}
                  </dd>
                </div>
              </dl>
            </div>
          </header>

          <table>
            <thead>
              <tr>
                <th scope="col">No.</th>
                <th scope="col">Admission no.</th>
                <th scope="col" className="text-left">Pupil</th>
                {componentGroups.sba.map((component) => (
                  <th key={component.id} scope="col">
                    {component.name}
                    <span className="block font-normal">
                      /{formatMark(Number(component.maximumScore))}
                    </span>
                  </th>
                ))}
                {componentGroups.sba.length > 0 ? (
                  <th scope="col">
                    Class Score
                    <span className="block font-normal">
                      /{formatMark(groupTotals.sba.maximum)}
                    </span>
                  </th>
                ) : null}
                {componentGroups.sba.length > 0 ? (
                  <th scope="col">
                    SBA Scaled
                    <span className="block font-normal">
                      /{formatMark(groupTotals.sba.weight)}
                    </span>
                  </th>
                ) : null}
                {componentGroups.exam.map((component) => (
                  <th key={component.id} scope="col">
                    {component.name}
                    <span className="block font-normal">
                      /{formatMark(Number(component.maximumScore))}
                    </span>
                  </th>
                ))}
                {componentGroups.exam.length > 1 ? (
                  <th scope="col">
                    Examination Total
                    <span className="block font-normal">
                      /{formatMark(groupTotals.exam.maximum)}
                    </span>
                  </th>
                ) : null}
                {componentGroups.exam.length > 0 ? (
                  <th scope="col">
                    Examination Scaled
                    <span className="block font-normal">
                      /{formatMark(groupTotals.exam.weight)}
                    </span>
                  </th>
                ) : null}
                <th scope="col">
                  Final Score
                  <span className="block font-normal">/100</span>
                </th>
                <th scope="col">Position</th>
                <th scope="col">{earlyYears ? 'Remark' : 'Grade'}</th>
                {!earlyYears && showRemark ? (
                  <th scope="col">Remark</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {view.pupils.map((pupil, pupilIndex) => {
                const pupilValues = values[pupil.pupilId] ?? {}
                const preview = previewPupilResult(
                  view.policy!.components,
                  pupilValues,
                  view.policy!.calculationMode,
                )
                const band = findPreviewBand(
                  view.policy!.gradingScheme.bands,
                  preview.final,
                )
                const earlyYearsResult = earlyYears
                  ? earlyYearsPerformance(preview.finalUnrounded)
                  : null
                const checks = view.policy!.components.map((component) =>
                  validateScoreInput(
                    pupilValues[component.id],
                    component.maximumScore,
                  ),
                )
                const complete = checks.every(
                  (check) => check.state === 'valid',
                )
                const sbaTotal = categoryRawTotal(
                  componentGroups.sba,
                  pupilValues,
                )
                const examTotal = categoryRawTotal(
                  componentGroups.exam,
                  pupilValues,
                )

                return (
                  <tr key={pupil.pupilId}>
                    <td className="text-center tabular-nums">
                      {pupilIndex + 1}
                    </td>
                    <td className="tabular-nums">{pupil.admissionNumber}</td>
                    <td className="text-left">{pupilName(pupil)}</td>
                    {componentGroups.sba.map((component) => (
                      <td key={component.id} className="text-right tabular-nums">
                        {printableScore(pupilValues[component.id])}
                      </td>
                    ))}
                    {componentGroups.sba.length > 0 ? (
                      <td className="text-right tabular-nums">
                        {sbaTotal.enteredTotal === null
                          ? ''
                          : formatScore(sbaTotal.enteredTotal)}
                        /{formatMark(sbaTotal.maximum)}
                      </td>
                    ) : null}
                    {componentGroups.sba.length > 0 ? (
                      <td className="text-right tabular-nums">
                        {formatScore(preview.sba)}/
                        {formatMark(sbaTotal.weight)}
                      </td>
                    ) : null}
                    {componentGroups.exam.map((component) => (
                      <td key={component.id} className="text-right tabular-nums">
                        {printableScore(pupilValues[component.id])}
                      </td>
                    ))}
                    {componentGroups.exam.length > 1 ? (
                      <td className="text-right tabular-nums">
                        {examTotal.enteredTotal === null
                          ? ''
                          : formatScore(examTotal.enteredTotal)}
                        /{formatMark(examTotal.maximum)}
                      </td>
                    ) : null}
                    {componentGroups.exam.length > 0 ? (
                      <td className="text-right tabular-nums">
                        {formatScore(preview.exam)}/
                        {formatMark(examTotal.weight)}
                      </td>
                    ) : null}
                    <td className="text-right font-bold tabular-nums">
                      {formatScore(preview.final)}/100
                    </td>
                    <td className="text-center tabular-nums">
                      {positionDisplay(
                        pupil,
                        provisionalPositions.get(pupil.pupilId) ?? null,
                      )}
                    </td>
                    <td className="text-center">
                      {earlyYears
                        ? earlyYearsResult && complete
                          ? earlyYearsResult.display
                          : ''
                        : band && complete
                          ? band.gradeLabel
                          : ''}
                    </td>
                    {!earlyYears && showRemark ? (
                      <td className="text-left">
                        {band && complete ? band.remark : ''}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>

          <footer className="mt-4 flex items-end justify-between gap-6 text-[8pt]">
            <div>
              <p>
                Blank cells are missing scores. A recorded 0 is a real score.
              </p>
              <p className="mt-1">
                Internal school document generated by Wise Grade. Not a released
                pupil report card.
              </p>
            </div>
            <div className="text-right">
              <p className="mt-6 border-t border-slate-600 pt-1">
                Teacher signature
              </p>
            </div>
          </footer>
        </div>
      ) : null}

      <ConfirmDialog
        open={discardOpen}
        title="Discard unsaved changes?"
        description="Reloading replaces the register with the last saved draft. Unsaved edits on this sheet will be lost."
        confirmLabel="Reload register"
        danger
        onConfirm={() => {
          setDiscardOpen(false)
          void loadView()
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      <ConfirmDialog
        open={pendingChange !== null}
        title="Discard unsaved changes?"
        description="Changing the academic year, term, class or subject replaces the register with another sheet. Unsaved edits will be lost."
        confirmLabel="Discard and continue"
        danger
        onConfirm={() => {
          const action = pendingChange
          setPendingChange(null)
          action?.()
        }}
        onCancel={() => setPendingChange(null)}
      />

      <ConfirmDialog
        open={submitOpen}
        title="Submit results for review?"
        description={
          view
            ? `All ${view.pupils.length} pupils have a complete result. Submitting saves the current register, locks it, and sends the sheet to a school administrator for academic acceptance. Missing scores block submission; an explicit 0 stays a real score. Acceptance makes the result eligible for report generation but does not generate reports itself.`
            : ''
        }
        confirmLabel="Submit and lock"
        busy={submitting}
        onConfirm={() => {
          setSubmitOpen(false)
          void submit()
        }}
        onCancel={() => setSubmitOpen(false)}
      />
    </div>
  )
}
