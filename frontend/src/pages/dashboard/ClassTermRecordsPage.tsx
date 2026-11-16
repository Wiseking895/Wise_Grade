import {
  CalendarCheck,
  CheckCircle2,
  HeartHandshake,
  MessageSquareText,
  RefreshCw,
  Save,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FormField from '../../components/FormField'
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
  TextareaField,
} from '../../components/ui'
import {
  getReportEligibility,
  listReportClasses,
  listReportInputs,
  upsertReportInput,
} from '../../reports/api'
import type { ReportClass } from '../../reports/types'
import {
  buildAttendancePlan,
  buildTextPlan,
  completedCount,
  completionSummary,
  hasMixedDaysOpened,
  hasUnsavedChanges,
  initialDaysOpened,
  isRowComplete,
  rowsFromInputs,
  type TermRecordKind,
  type TermRecordRow,
} from '../../reports/term-records'
import { useAcademicTerms } from '../../reports/use-academic-terms'
import { useUnsavedChangesWarning } from '../../reports/use-unsaved-changes-warning'
import { useSchool } from '../../schools/use-school'

const PAGE_COPY: Record<
  TermRecordKind,
  {
    title: string
    description: string
    noun: string
    saveLabel: string
    icon: typeof CalendarCheck
    emptyTitle: string
    emptyDescription: string
  }
> = {
  attendance: {
    title: 'Class attendance',
    description:
      "Record the school days in the term and each pupil's days present. Only your assigned class teacher can edit these values, and they are copied into the report snapshot at generation time.",
    noun: 'Attendance',
    saveLabel: 'Save attendance',
    icon: CalendarCheck,
    emptyTitle: 'No pupils in this class',
    emptyDescription:
      'Add pupils to this class before recording attendance for the term.',
  },
  remarks: {
    title: "Teacher's remarks",
    description:
      "Write an individual end-of-term remark for each pupil. Every remark is stored per pupil, class, academic year and term, and is copied into the report snapshot at generation time.",
    noun: 'Remarks',
    saveLabel: 'Save remarks',
    icon: MessageSquareText,
    emptyTitle: 'No pupils in this class',
    emptyDescription:
      'Add pupils to this class before writing teacher remarks for the term.',
  },
  attitude: {
    title: 'Attitude',
    description:
      "Record each pupil's attitude for the term using the same free-text form printed on the report card. No grading scale is applied, and the saved note is copied into the report snapshot at generation time.",
    noun: 'Attitude',
    saveLabel: 'Save attitude notes',
    icon: HeartHandshake,
    emptyTitle: 'No pupils in this class',
    emptyDescription:
      'Add pupils to this class before recording attitude notes for the term.',
  },
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

function savedLabel(value: string | null): string | null {
  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return null

  return date.toLocaleString('en-GB')
}

/**
 * Shared implementation for the three Class Teacher term-record pages:
 * attendance, teacher's remarks and attitude.
 *
 * All three read and write the same authorised `ReportInput` row, so a save on
 * one page leaves the other fields untouched. The selected academic year, term
 * and class are part of every write, and switching any of them while a value is
 * unsaved asks for confirmation first so one term can never overwrite another.
 */
export default function ClassTermRecordsPage({
  kind,
}: {
  kind: TermRecordKind
}) {
  const copy = PAGE_COPY[kind]
  const { schoolId } = useSchool()
  const {
    options,
    selected,
    selectedTermId,
    setSelectedTermId,
    loading: termsLoading,
    error: termsError,
    reload: reloadTerms,
  } = useAcademicTerms(schoolId)

  const [classes, setClasses] = useState<ReportClass[]>([])
  const [classId, setClassId] = useState('')
  const [className, setClassName] = useState('')
  const [rows, setRows] = useState<TermRecordRow[]>([])
  const [totalDays, setTotalDays] = useState('')
  const [loadingClasses, setLoadingClasses] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [savingPupils, setSavingPupils] = useState<Record<string, boolean>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const loadSequence = useRef(0)

  const dirty = useMemo(
    () => hasUnsavedChanges(kind, rows, totalDays),
    [kind, rows, totalDays],
  )

  useUnsavedChangesWarning(
    dirty,
    'You have unsaved changes. Leave this page and discard them?',
  )

  const loadClasses = useCallback(async () => {
    if (!schoolId || !selected) {
      setClasses([])
      setClassId('')
      return
    }

    try {
      setLoadingClasses(true)
      const response = await listReportClasses(
        schoolId,
        selected.yearId,
        selected.termId,
      )
      setClasses(response.classes)
      setClassId((current) =>
        response.classes.some((item) => item.id === current)
          ? current
          : (response.classes[0]?.id ?? ''),
      )
    } catch (cause) {
      setClasses([])
      setError(
        errorMessage(cause, 'Could not load the classes available to you.'),
      )
    } finally {
      setLoadingClasses(false)
    }
  }, [schoolId, selected])

  const loadRows = useCallback(async () => {
    const sequence = loadSequence.current + 1
    loadSequence.current = sequence

    if (!schoolId || !selected || !classId) {
      setRows([])
      setTotalDays('')
      return
    }

    try {
      setLoadingRows(true)
      const [eligibilityResponse, inputsResponse] = await Promise.all([
        getReportEligibility(schoolId, {
          academicYearId: selected.yearId,
          academicTermId: selected.termId,
          classId,
        }),
        listReportInputs(schoolId, {
          academicTermId: selected.termId,
          classId,
        }),
      ])

      if (sequence !== loadSequence.current) return

      const nextRows = rowsFromInputs(
        eligibilityResponse.eligibility.pupils,
        inputsResponse.inputs,
      )
      setClassName(eligibilityResponse.eligibility.className)
      setRows(nextRows)
      setTotalDays(kind === 'attendance' ? initialDaysOpened(nextRows) : '')
      setRowErrors({})
      setError(null)
      setSuccess(null)
    } catch (cause) {
      if (sequence !== loadSequence.current) return
      setRows([])
      setTotalDays('')
      setError(
        errorMessage(
          cause,
          'Could not load the saved records for this class and term.',
        ),
      )
    } finally {
      if (sequence === loadSequence.current) setLoadingRows(false)
    }
  }, [classId, kind, schoolId, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClasses()
  }, [loadClasses])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows()
  }, [loadRows])

  function patchRow(pupilId: string, patch: Partial<TermRecordRow>) {
    setRows((current) =>
      current.map((row) =>
        row.pupilId === pupilId ? { ...row, ...patch } : row,
      ),
    )
    setSuccess(null)
  }

  function setRowSaving(pupilId: string, saving: boolean) {
    setSavingPupils((current) => ({ ...current, [pupilId]: saving }))
  }

  function setRowError(pupilId: string, message: string | null) {
    setRowErrors((current) => {
      const next = { ...current }

      if (message) next[pupilId] = message
      else delete next[pupilId]

      return next
    })
  }

  function changeTerm(nextTermId: string) {
    if (nextTermId === selectedTermId) return

    if (
      dirty &&
      !window.confirm(
        'You have unsaved changes in this term. Switch terms and discard them?',
      )
    ) {
      return
    }

    setSelectedTermId(nextTermId)
  }

  function changeClass(nextClassId: string) {
    if (nextClassId === classId) return

    if (
      dirty &&
      !window.confirm(
        'You have unsaved changes in this class. Switch classes and discard them?',
      )
    ) {
      return
    }

    setClassId(nextClassId)
  }

  function refresh() {
    if (
      dirty &&
      !window.confirm(
        'You have unsaved changes. Refresh and discard them?',
      )
    ) {
      return
    }

    void reloadTerms()
    void loadClasses()
    void loadRows()
  }

  async function saveAttendanceRows(targets: TermRecordRow[]) {
    if (!schoolId || !selected) return

    const plan = buildAttendancePlan(totalDays, rows)
    const targetIds = new Set(targets.map((row) => row.pupilId))
    const planned = plan.rows.filter((row) => targetIds.has(row.pupilId))

    if (totalDays.trim() === '') {
      setError('Enter the school days in the term before saving attendance.')
      return
    }

    if (plan.totalError) {
      setError(plan.totalError)
      return
    }

    const invalid = planned.filter((row) => row.error !== null)
    const nextErrors: Record<string, string> = {}

    for (const row of invalid) {
      if (row.error) nextErrors[row.pupilId] = row.error
    }

    setRowErrors(nextErrors)

    if (invalid.length > 0) {
      setError(
        invalid.length === 1
          ? 'Correct the highlighted attendance value before saving.'
          : 'Correct the highlighted attendance values before saving.',
      )
      return
    }

    const changed = planned.filter((row) => row.dirty)

    if (changed.length === 0) {
      setSuccess('There are no attendance changes to save.')
      return
    }

    setError(null)
    setSuccess(null)
    setSavingAll(changed.length > 1)

    const settled = await Promise.allSettled(
      changed.map(async (row) => {
        setRowSaving(row.pupilId, true)

        try {
          const response = await upsertReportInput(schoolId, {
            academicYearId: selected.yearId,
            academicTermId: selected.termId,
            classId,
            pupilId: row.pupilId,
            daysOpened: row.daysOpened,
            daysAttended: row.daysAttended,
          })
          return { row, updatedAt: response.input.updatedAt }
        } finally {
          setRowSaving(row.pupilId, false)
        }
      }),
    )

    const failures: string[] = []
    let saved = 0

    settled.forEach((result, index) => {
      const plannedRow = changed[index]!

      if (result.status === 'fulfilled') {
        saved += 1
        patchRow(plannedRow.pupilId, {
          savedDaysOpened: plannedRow.daysOpened,
          savedDaysAttended: plannedRow.daysAttended,
          savedAt: result.value.updatedAt,
        })
        setRowError(plannedRow.pupilId, null)
      } else {
        const pupil = rows.find((row) => row.pupilId === plannedRow.pupilId)
        const message = errorMessage(
          result.reason,
          'Could not save this attendance record.',
        )
        failures.push(`${pupil?.pupilName ?? 'Pupil'}: ${message}`)
        setRowError(plannedRow.pupilId, message)
      }
    })

    setSavingAll(false)

    if (failures.length > 0) {
      setError(
        `Saved ${saved} of ${changed.length} attendance records. ${failures.join(
          ' ',
        )}`,
      )
    } else {
      setSuccess(
        `Saved attendance for ${saved} ${
          saved === 1 ? 'pupil' : 'pupils'
        } in this class and term.`,
      )
    }
  }

  async function saveTextRows(
    textKind: 'remarks' | 'attitude',
    targets: TermRecordRow[],
  ) {
    if (!schoolId || !selected) return

    const plan = buildTextPlan(textKind, rows)
    const targetIds = new Set(targets.map((row) => row.pupilId))
    const planned = plan.rows.filter((row) => targetIds.has(row.pupilId))
    const invalid = planned.filter((row) => row.error !== null)
    const nextErrors: Record<string, string> = {}

    for (const row of invalid) {
      if (row.error) nextErrors[row.pupilId] = row.error
    }

    setRowErrors(nextErrors)

    if (invalid.length > 0) {
      setError('Correct the highlighted entries before saving.')
      return
    }

    const changed = planned.filter((row) => row.dirty)

    if (changed.length === 0) {
      setSuccess(
        textKind === 'remarks'
          ? 'There are no remark changes to save.'
          : 'There are no attitude changes to save.',
      )
      return
    }

    setError(null)
    setSuccess(null)
    setSavingAll(changed.length > 1)

    const settled = await Promise.allSettled(
      changed.map(async (row) => {
        setRowSaving(row.pupilId, true)

        try {
          const response = await upsertReportInput(schoolId, {
            academicYearId: selected.yearId,
            academicTermId: selected.termId,
            classId,
            pupilId: row.pupilId,
            ...(textKind === 'remarks'
              ? { teacherRemarks: row.value }
              : { attitude: row.value }),
          })
          return { row, updatedAt: response.input.updatedAt }
        } finally {
          setRowSaving(row.pupilId, false)
        }
      }),
    )

    const failures: string[] = []
    let saved = 0

    settled.forEach((result, index) => {
      const plannedRow = changed[index]!

      if (result.status === 'fulfilled') {
        saved += 1
        patchRow(
          plannedRow.pupilId,
          textKind === 'remarks'
            ? {
                savedTeacherRemarks: plannedRow.value,
                savedAt: result.value.updatedAt,
              }
            : {
                savedAttitude: plannedRow.value,
                savedAt: result.value.updatedAt,
              },
        )
        setRowError(plannedRow.pupilId, null)
      } else {
        const pupil = rows.find((row) => row.pupilId === plannedRow.pupilId)
        const message = errorMessage(
          result.reason,
          textKind === 'remarks'
            ? 'Could not save this remark.'
            : 'Could not save this attitude note.',
        )
        failures.push(`${pupil?.pupilName ?? 'Pupil'}: ${message}`)
        setRowError(plannedRow.pupilId, message)
      }
    })

    setSavingAll(false)

    if (failures.length > 0) {
      setError(
        `Saved ${saved} of ${changed.length} entries. ${failures.join(' ')}`,
      )
    } else {
      setSuccess(
        textKind === 'remarks'
          ? `Saved remarks for ${saved} ${
              saved === 1 ? 'pupil' : 'pupils'
            } in this class and term.`
          : `Saved attitude notes for ${saved} ${
              saved === 1 ? 'pupil' : 'pupils'
            } in this class and term.`,
      )
    }
  }

  function saveRow(row: TermRecordRow) {
    if (kind === 'attendance') {
      void saveAttendanceRows([row])
    } else {
      void saveTextRows(kind, [row])
    }
  }

  function saveAll() {
    if (kind === 'attendance') {
      void saveAttendanceRows(rows)
    } else {
      void saveTextRows(kind, rows)
    }
  }

  const attendancePlan = useMemo(
    () => (kind === 'attendance' ? buildAttendancePlan(totalDays, rows) : null),
    [kind, rows, totalDays],
  )
  const textPlan = useMemo(
    () =>
      kind === 'attendance' ? null : buildTextPlan(kind, rows),
    [kind, rows],
  )
  const planByPupil = useMemo(() => {
    const plan = attendancePlan ?? textPlan
    return new Map((plan?.rows ?? []).map((row) => [row.pupilId, row]))
  }, [attendancePlan, textPlan])

  const completed = completedCount(kind, rows)
  const complete = rows.length > 0 && completed === rows.length
  const mixedTotals =
    kind === 'attendance' && !dirty && hasMixedDaysOpened(rows)
  const Icon = copy.icon
  const busy = loadingClasses || loadingRows || termsLoading

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            loading={busy}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Academic term"
            value={selectedTermId}
            onChange={(event) => changeTerm(event.target.value)}
            disabled={termsLoading || options.length === 0}
            hint="Records are stored separately for every academic year and term."
          >
            {options.length === 0 ? (
              <option value="">No terms available</option>
            ) : null}
            {options.map((option) => (
              <option key={option.termId} value={option.termId}>
                {option.label}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Class"
            value={classId}
            onChange={(event) => changeClass(event.target.value)}
            disabled={loadingClasses || classes.length === 0}
            hint="Only the class assigned to you is listed for a class teacher."
          >
            {classes.length === 0 ? (
              <option value="">No classes available</option>
            ) : null}
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>

        {selected ? (
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gradely-muted">
            <span className="font-semibold text-gradely-text">
              {className || 'Class'}
            </span>
            <span aria-hidden="true">-</span>
            <span>{selected.label}</span>
          </p>
        ) : null}
      </Panel>

      {termsError ? (
        <ErrorNotice message={termsError} onRetry={() => void reloadTerms()} />
      ) : null}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void loadRows()} />
      ) : null}
      {success ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-semibold text-[#137026]"
        >
          {success}
        </div>
      ) : null}

      {busy ? (
        <LoadingPanel label={`Loading ${copy.noun.toLowerCase()} records...`} />
      ) : !selected ? (
        <Panel>
          <p className="text-sm text-gradely-muted">
            Create an academic year and term before recording {copy.noun.toLowerCase()}.
          </p>
        </Panel>
      ) : classes.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No class available"
          description="Only a class you are assigned to as its class teacher can be used on this page."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
        />
      ) : (
        <div className="space-y-4">
          <Panel className="border-gradely-blue/20 bg-gradely-light/40">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                  <Icon aria-hidden="true" className="size-4.5 text-gradely-blue" />
                  {copy.noun}
                  <span className="font-normal text-gradely-muted">
                    ({rows.length} {rows.length === 1 ? 'pupil' : 'pupils'})
                  </span>
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  {completionSummary(kind, completed, rows.length)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={complete ? 'success' : 'warning'}>
                  {complete ? 'Complete' : 'Incomplete'}
                </Badge>
                {dirty ? <Badge tone="info">Unsaved changes</Badge> : null}
                <Button
                  size="sm"
                  onClick={saveAll}
                  loading={savingAll}
                  disabled={!dirty || savingAll}
                >
                  <Save aria-hidden="true" className="size-4" />
                  {copy.saveLabel}
                </Button>
              </div>
            </div>

            {kind === 'attendance' ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FormField
                  label="School days in the term"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={400}
                  step={1}
                  value={totalDays}
                  onChange={(event) => {
                    setTotalDays(event.target.value)
                    setSuccess(null)
                  }}
                  error={attendancePlan?.totalError ?? undefined}
                  hint="The same term total is saved with every pupil's attendance record."
                  placeholder="e.g. 60"
                />
              </div>
            ) : null}

            {mixedTotals ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-3 text-xs font-medium text-[#7a5400]">
                <span aria-hidden="true">!</span>
                Saved attendance records in this class use different school-day
                totals. Enter one total for the term and save again to align
                them.
              </p>
            ) : null}
          </Panel>

          <div className="space-y-3">
            {rows.map((row) => {
              const planRow = planByPupil.get(row.pupilId)
              const rowDirty = planRow?.dirty ?? false
              const rowComplete = isRowComplete(kind, row)
              const updated = savedLabel(row.savedAt)
              const remarkValue = row.teacherRemarks
              const attitudeValue = row.attitude

              return (
                <Panel key={row.pupilId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-gradely-text">
                        {row.pupilName}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={rowComplete ? 'success' : 'warning'}>
                          {rowComplete ? 'Recorded' : 'Missing'}
                        </Badge>
                        {rowDirty ? <Badge tone="info">Unsaved</Badge> : null}
                        {!row.eligible ? (
                          <span className="text-xs text-gradely-muted">
                            Report generation would currently skip this pupil
                            {row.failureMessage ? `: ${row.failureMessage}` : '.'}
                          </span>
                        ) : null}
                        {updated ? (
                          <span className="inline-flex items-center gap-1 text-xs text-gradely-muted">
                            <CheckCircle2
                              aria-hidden="true"
                              className="size-3.5 text-gradely-green"
                            />
                            Saved {updated}
                          </span>
                        ) : (
                          <span className="text-xs text-gradely-muted">
                            No saved entry yet
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={savingPupils[row.pupilId] === true}
                      disabled={savingAll || !rowDirty}
                      onClick={() => saveRow(row)}
                    >
                      <Save aria-hidden="true" className="size-4" />
                      Save pupil
                    </Button>
                  </div>

                  <div className="mt-4 max-w-xl">
                    {kind === 'attendance' ? (
                      <FormField
                        label="Days present"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={400}
                        step={1}
                        value={row.daysAttended}
                        onChange={(event) =>
                          patchRow(row.pupilId, {
                            daysAttended: event.target.value,
                          })
                        }
                        error={rowErrors[row.pupilId] ?? planRow?.error ?? undefined}
                        hint="Leave blank when the pupil's attendance is not recorded. A blank value is never saved as zero."
                        placeholder="e.g. 58"
                      />
                    ) : null}

                    {kind === 'remarks' ? (
                      <TextareaField
                        label="Teacher's remark"
                        rows={4}
                        maxLength={1000}
                        value={remarkValue}
                        onChange={(event) =>
                          patchRow(row.pupilId, {
                            teacherRemarks: event.target.value,
                          })
                        }
                        error={rowErrors[row.pupilId] ?? planRow?.error ?? undefined}
                        placeholder="Write the class teacher's verified remark for this pupil. Leave blank rather than inventing a remark."
                        hint={`${remarkValue.length}/1000 characters. Printed on the report card exactly as written.`}
                      />
                    ) : null}

                    {kind === 'attitude' ? (
                      <TextareaField
                        label="Attitude"
                        rows={3}
                        maxLength={400}
                        value={attitudeValue}
                        onChange={(event) =>
                          patchRow(row.pupilId, {
                            attitude: event.target.value,
                          })
                        }
                        error={rowErrors[row.pupilId] ?? planRow?.error ?? undefined}
                        placeholder="Describe this pupil's attitude in the same free-text form used on the report card. Leave blank rather than inventing a note."
                        hint={`${attitudeValue.length}/400 characters. Printed on the report card exactly as written.`}
                      />
                    ) : null}
                  </div>
                </Panel>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
