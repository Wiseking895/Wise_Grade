import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  Save,
  Users,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
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
import { DraftNotice } from '../../reports/components'
import type {
  ReportClass,
  ReportEligibilityItem,
  ReportInput,
} from '../../reports/types'
import { useAcademicTerms } from '../../reports/use-academic-terms'
import { useSchool } from '../../schools/use-school'

interface InputRowState {
  pupilId: string
  pupilName: string
  eligible: boolean
  failureMessage: string | null
  daysOpened: string
  daysAttended: string
  teacherRemarks: string
  attitude: string
  closingDate: string
  reopeningDate: string
  saving: boolean
  savedAt: string | null
}

function rowFromInput(
  pupil: ReportEligibilityItem,
  input: ReportInput | undefined,
): InputRowState {
  return {
    pupilId: pupil.pupilId,
    pupilName: pupil.pupilName,
    eligible: pupil.eligible,
    failureMessage: pupil.failure?.message ?? null,
    daysOpened:
      input?.daysOpened === null || input?.daysOpened === undefined
        ? ''
        : String(input.daysOpened),
    daysAttended:
      input?.daysAttended === null || input?.daysAttended === undefined
        ? ''
        : String(input.daysAttended),
    teacherRemarks: input?.teacherRemarks ?? '',
    attitude: input?.attitude ?? '',
    closingDate: input?.closingDate?.slice(0, 10) ?? '',
    reopeningDate: input?.reopeningDate?.slice(0, 10) ?? '',
    saving: false,
    savedAt: input?.updatedAt ?? null,
  }
}

function optionalNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default function ReportInputsPage() {
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
  const [rows, setRows] = useState<InputRowState[]>([])
  const [className, setClassName] = useState('')
  const [loadingClasses, setLoadingClasses] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load classes available for report inputs.',
      )
    } finally {
      setLoadingClasses(false)
    }
  }, [schoolId, selected])

  const loadRows = useCallback(async () => {
    if (!schoolId || !selected || !classId) {
      setRows([])
      return
    }

    try {
      setLoading(true)
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
      const byPupil = new Map(
        inputsResponse.inputs.map((input) => [input.pupilId, input]),
      )
      setClassName(eligibilityResponse.eligibility.className)
      setRows(
        eligibilityResponse.eligibility.pupils.map((pupil) =>
          rowFromInput(pupil, byPupil.get(pupil.pupilId)),
        ),
      )
      setError(null)
      setSuccess(null)
    } catch (cause) {
      setRows([])
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load report inputs.',
      )
    } finally {
      setLoading(false)
    }
  }, [classId, schoolId, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClasses()
  }, [loadClasses])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows()
  }, [loadRows])

  function patchRow(pupilId: string, patch: Partial<InputRowState>) {
    setRows((current) =>
      current.map((row) =>
        row.pupilId === pupilId ? { ...row, ...patch } : row,
      ),
    )
    setSuccess(null)
  }

  async function saveRow(row: InputRowState) {
    if (!schoolId || !selected) return

    const daysOpened = optionalNumber(row.daysOpened)
    const daysAttended = optionalNumber(row.daysAttended)

    if (
      daysOpened !== null &&
      (!Number.isInteger(daysOpened) || daysOpened < 1 || daysOpened > 400)
    ) {
      setError('School days opened must be a whole number between 1 and 400.')
      return
    }

    if (
      daysAttended !== null &&
      (!Number.isInteger(daysAttended) ||
        daysAttended < 0 ||
        daysAttended > 400)
    ) {
      setError('Days attended must be a whole number between 0 and 400.')
      return
    }

    if (
      daysOpened !== null &&
      daysAttended !== null &&
      daysAttended > daysOpened
    ) {
      setError('Days attended cannot exceed school days opened.')
      return
    }

    try {
      patchRow(row.pupilId, { saving: true })
      setError(null)
      const response = await upsertReportInput(schoolId, {
        academicYearId: selected.yearId,
        academicTermId: selected.termId,
        classId,
        pupilId: row.pupilId,
        daysOpened,
        daysAttended,
        teacherRemarks: row.teacherRemarks.trim() || null,
        attitude: row.attitude.trim() || null,
        closingDate: row.closingDate || null,
        reopeningDate: row.reopeningDate || null,
      })
      patchRow(row.pupilId, {
        saving: false,
        savedAt: response.input.updatedAt,
      })
      setSuccess(`Saved authorized report inputs for ${row.pupilName}.`)
    } catch (cause) {
      patchRow(row.pupilId, { saving: false })
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save report inputs.',
      )
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report inputs"
        description="Enter verified attendance, term dates, teacher remarks and attitude notes. Only a school administrator or the assigned class teacher may edit these values."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadClasses()
              void loadRows()
              void reloadTerms()
            }}
            loading={loadingClasses || loading || termsLoading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <DraftNotice description="Remarks and attendance are stored as authorized report inputs. They are never invented by the system and are copied into the immutable report snapshot at generation time." />

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Academic term"
            value={selectedTermId}
            onChange={(event) => setSelectedTermId(event.target.value)}
            disabled={termsLoading || options.length === 0}
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
            onChange={(event) => setClassId(event.target.value)}
            disabled={loadingClasses || classes.length === 0}
            hint="Only classes you are assigned to are listed for teachers."
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

      {loadingClasses || loading || termsLoading ? (
        <LoadingPanel label="Loading report inputs…" />
      ) : !selected ? (
        <Panel>
          <p className="text-sm text-gradely-muted">
            Create an academic year and term before entering report inputs.
          </p>
        </Panel>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No pupils available"
          description="Add pupils to this class before entering attendance, remarks and attitude notes."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-gradely-text">
                {className || 'Class'} · {rows.length} pupils
              </h2>
              <p className="mt-0.5 text-xs text-gradely-muted">
                Values are saved per pupil and copied into report snapshots.
              </p>
            </div>
            <Badge tone="info">
              <ClipboardList aria-hidden="true" className="mr-1 size-3.5" />
              Authorized staff only
            </Badge>
          </div>

          {rows.map((row) => (
            <Panel key={row.pupilId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-gradely-text">
                    {row.pupilName}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={row.eligible ? 'success' : 'warning'}>
                      {row.eligible ? 'Eligible' : 'Generation skipped'}
                    </Badge>
                    {row.failureMessage ? (
                      <span className="text-xs text-gradely-muted">
                        {row.failureMessage}
                      </span>
                    ) : null}
                    {row.savedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-gradely-muted">
                        <CheckCircle2
                          aria-hidden="true"
                          className="size-3.5 text-gradely-green"
                        />
                        Saved {new Date(row.savedAt).toLocaleString('en-GB')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  loading={row.saving}
                  onClick={() => void saveRow(row)}
                >
                  <Save aria-hidden="true" className="size-4" />
                  Save pupil
                </Button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField
                  label="School days opened"
                  type="number"
                  min={1}
                  max={400}
                  value={row.daysOpened}
                  onChange={(event) =>
                    patchRow(row.pupilId, { daysOpened: event.target.value })
                  }
                  placeholder="e.g. 60"
                />
                <FormField
                  label="Days attended"
                  type="number"
                  min={0}
                  max={400}
                  value={row.daysAttended}
                  onChange={(event) =>
                    patchRow(row.pupilId, { daysAttended: event.target.value })
                  }
                  placeholder="e.g. 58"
                />
                <FormField
                  label="Closing date"
                  type="date"
                  value={row.closingDate}
                  onChange={(event) =>
                    patchRow(row.pupilId, { closingDate: event.target.value })
                  }
                />
                <FormField
                  label="Reopening date"
                  type="date"
                  value={row.reopeningDate}
                  onChange={(event) =>
                    patchRow(row.pupilId, { reopeningDate: event.target.value })
                  }
                />
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <TextareaField
                  label="Teacher's remarks"
                  rows={4}
                  maxLength={1000}
                  value={row.teacherRemarks}
                  onChange={(event) =>
                    patchRow(row.pupilId, {
                      teacherRemarks: event.target.value,
                    })
                  }
                  placeholder="Only enter remarks verified by the class teacher. Leave blank rather than inventing a remark."
                  hint={`${row.teacherRemarks.length}/1000 characters`}
                />
                <TextareaField
                  label="Attitude"
                  rows={4}
                  maxLength={400}
                  value={row.attitude}
                  onChange={(event) =>
                    patchRow(row.pupilId, { attitude: event.target.value })
                  }
                  placeholder="Only enter attitude notes verified by the class teacher. Leave blank rather than inventing a note."
                  hint={`${row.attitude.length}/400 characters`}
                />
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-xs text-gradely-muted">
                <CalendarDays aria-hidden="true" className="size-3.5" />
                Dates and attendance are historical values stored with this term.
              </p>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}
