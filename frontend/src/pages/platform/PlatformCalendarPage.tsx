import {
  Archive,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import FormField from '../../components/FormField'
import { formatDate, formatDateTime, statusLabel } from '../../lib/format'
import {
  activatePlatformAcademicYear,
  applyPlatformCalendar,
  archivePlatformAcademicYear,
  closePlatformTerm,
  createPlatformAcademicYear,
  deactivatePlatformAcademicYear,
  getPlatformSchoolCalendar,
  listPlatformCalendarSchools,
  listPlatformCalendars,
  previewPlatformCalendarApply,
  resetPlatformAcademicYear,
  runPlatformCalendarForSchool,
  updatePlatformAcademicYear,
  upsertPlatformCalendarTerm,
} from '../../platform/api'
import { PLATFORM_REAUTH_PURPOSE } from '../../platform/reauth-purpose'
import { usePlatformReauth } from '../../platform/reauth-context'
import type {
  PlatformCalendarApplyInput,
  PlatformCalendarApplyPreview,
  PlatformCalendarApplyResult,
  PlatformCalendarSchoolSummary,
  PlatformCalendarTerm,
  PlatformCalendarTermConfig,
  PlatformCalendarYear,
  PlatformCalendarTransition,
  PlatformSchoolCalendar,
} from '../../platform/types'

interface YearFormState {
  mode: 'create' | 'edit'
  yearId?: string
  name: string
  startsOn: string
  endsOn: string
  activate: boolean
}

interface TermFormState {
  sequence: number
  name: string
  startsOn: string
  endsOn: string
  assessmentDeadline: string
  examinationStartsOn: string
  examinationEndsOn: string
  datesConfirmed: boolean
  acknowledgeImpacts: boolean
  existing: boolean
  status: string
}

interface ResetFormState {
  name: string
  startsOn: string
  endsOn: string
  terms: PlatformCalendarTermConfig[]
  acknowledgeImpacts: boolean
}

const TERM_TONE: Record<string, 'neutral' | 'success' | 'info' | 'warning'> = {
  PLANNED: 'neutral',
  OPEN: 'success',
  CLOSED: 'info',
}

function sequenceName(sequence: number, name?: string): string {
  return name && name.trim() !== '' ? name : `Term ${sequence}`
}

function configFromTerm(term: PlatformCalendarTerm): PlatformCalendarTermConfig {
  return {
    name: term.name,
    sequence: term.sequence,
    startsOn: term.startsOn,
    endsOn: term.endsOn,
    assessmentDeadline: term.assessmentDeadline,
    examinationStartsOn: term.examinationStartsOn,
    examinationEndsOn: term.examinationEndsOn,
    datesConfirmed: term.datesConfirmed,
  }
}

function describeTerm(term: PlatformCalendarTermConfig): string {
  return `${term.name}: ${term.startsOn} – ${term.endsOn}, deadline ${term.assessmentDeadline}, examinations ${term.examinationStartsOn} – ${term.examinationEndsOn}${term.datesConfirmed ? '' : ' (awaiting confirmation)'}`
}

function summarizeError(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export default function PlatformCalendarPage() {
  const { ensureReauth } = usePlatformReauth()

  const [calendars, setCalendars] = useState<PlatformSchoolCalendar[]>([])
  const [schools, setSchools] = useState<PlatformCalendarSchoolSummary[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [calendar, setCalendar] = useState<PlatformSchoolCalendar | null>(null)
  const [transitions, setTransitions] = useState<PlatformCalendarTransition[]>([])
  const [activeYearId, setActiveYearId] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [yearForm, setYearForm] = useState<YearFormState | null>(null)
  const [termForm, setTermForm] = useState<TermFormState | null>(null)
  const [resetForm, setResetForm] = useState<ResetFormState | null>(null)
  const [archiveYear, setArchiveYear] = useState<PlatformCalendarYear | null>(null)
  const [closeTerm, setCloseTerm] = useState<PlatformCalendarTerm | null>(null)

  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [runBusy, setRunBusy] = useState(false)

  const [targetMode, setTargetMode] = useState<'all' | 'selected'>('all')
  const [targetSchoolIds, setTargetSchoolIds] = useState<string[]>([])
  const [preview, setPreview] = useState<PlatformCalendarApplyPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyResult, setApplyResult] = useState<PlatformCalendarApplyResult | null>(
    null,
  )
  const [distributionError, setDistributionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [calendarResponse, schoolResponse] = await Promise.all([
        listPlatformCalendars(),
        listPlatformCalendarSchools(),
      ])
      setCalendars(calendarResponse.calendars)
      setSchools(schoolResponse.schools)
      setSchoolId((current) =>
        calendarResponse.calendars.some((item) => item.schoolId === current)
          ? current
          : (calendarResponse.calendars[0]?.schoolId ??
            schoolResponse.schools[0]?.id ??
            ''),
      )
    } catch (cause) {
      setError(summarizeError(cause, 'Could not load school calendars.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetailLoading(true)
      const response = await getPlatformSchoolCalendar(id)
      setCalendar(response.calendar)
      setTransitions(response.transitions)
    } catch (cause) {
      setError(summarizeError(cause, 'Could not load the calendar.'))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (schoolId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDetail(schoolId)
    }
  }, [schoolId, loadDetail])

  const resolvedYearId =
    calendar?.years.some((year) => year.id === activeYearId)
      ? activeYearId
      : (calendar?.currentYear?.id ?? calendar?.years[0]?.id ?? '')

  const activeYear = useMemo(
    () =>
      calendar?.years.find((year) => year.id === resolvedYearId) ?? null,
    [calendar, resolvedYearId],
  )

  const termBySequence = useMemo(() => {
    const map = new Map<number, PlatformCalendarTerm>()
    for (const term of activeYear?.terms ?? []) {
      map.set(term.sequence, term)
    }
    return map
  }, [activeYear])

  const schoolsUsingYear = useMemo(() => {
    if (!activeYear) return 0
    return calendars.filter((item) =>
      item.years.some((year) => year.name === activeYear.name),
    ).length
  }, [calendars, activeYear])

  const distributionComplete =
    activeYear !== null && schools.length > 0 && schoolsUsingYear === schools.length

  const refresh = useCallback(async () => {
    await loadDetail(schoolId)
    const response = await listPlatformCalendars()
    setCalendars(response.calendars)
  }, [loadDetail, schoolId])

  async function runNow() {
    if (!schoolId) return
    setRunBusy(true)
    setError(null)
    try {
      await runPlatformCalendarForSchool(schoolId)
      await refresh()
      setNotice('Calendar transition run completed.')
    } catch (cause) {
      setError(summarizeError(cause, 'Could not run the calendar.'))
    } finally {
      setRunBusy(false)
    }
  }

  function openCreateYear() {
    setFormError(null)
    setYearForm({
      mode: 'create',
      name: '',
      startsOn: '',
      endsOn: '',
      activate: false,
    })
  }

  function openEditYear(year: PlatformCalendarYear) {
    setFormError(null)
    setYearForm({
      mode: 'edit',
      yearId: year.id,
      name: year.name,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      activate: false,
    })
  }

  async function saveYear() {
    if (!yearForm || !schoolId) return
    setFormBusy(true)
    setFormError(null)
    try {
      if (yearForm.mode === 'create') {
        await createPlatformAcademicYear(schoolId, {
          name: yearForm.name,
          startsOn: yearForm.startsOn,
          endsOn: yearForm.endsOn,
          activate: yearForm.activate,
          terms: [],
        })
        setNotice('Academic year created. Configure its terms next.')
      } else if (yearForm.yearId) {
        await updatePlatformAcademicYear(schoolId, yearForm.yearId, {
          name: yearForm.name,
          startsOn: yearForm.startsOn,
          endsOn: yearForm.endsOn,
        })
        setNotice('Academic year dates updated and audited.')
      }
      setYearForm(null)
      await refresh()
    } catch (cause) {
      setFormError(summarizeError(cause, 'Could not save the academic year.'))
    } finally {
      setFormBusy(false)
    }
  }

  function openTerm(sequence: number, term?: PlatformCalendarTerm) {
    setFormError(null)
    setTermForm({
      sequence,
      name: sequenceName(sequence, term?.name),
      startsOn: term?.startsOn ?? '',
      endsOn: term?.endsOn ?? '',
      assessmentDeadline: term?.assessmentDeadline ?? '',
      examinationStartsOn: term?.examinationStartsOn ?? '',
      examinationEndsOn: term?.examinationEndsOn ?? '',
      datesConfirmed: term?.datesConfirmed ?? false,
      acknowledgeImpacts: false,
      existing: Boolean(term),
      status: term?.status ?? 'PLANNED',
    })
  }

  async function saveTerm() {
    if (!termForm || !schoolId || !activeYear) return
    setFormBusy(true)
    setFormError(null)
    try {
      await upsertPlatformCalendarTerm(
        schoolId,
        activeYear.id,
        termForm.sequence,
        {
          name: termForm.name,
          startsOn: termForm.startsOn,
          endsOn: termForm.endsOn,
          assessmentDeadline: termForm.assessmentDeadline,
          examinationStartsOn: termForm.examinationStartsOn,
          examinationEndsOn: termForm.examinationEndsOn,
          datesConfirmed: termForm.datesConfirmed,
          acknowledgeImpacts: termForm.acknowledgeImpacts || undefined,
        },
      )
      setTermForm(null)
      setNotice(
        termForm.datesConfirmed
          ? 'Term configuration confirmed and audited.'
          : 'Term saved as awaiting confirmation. The scheduler will not act on it.',
      )
      await refresh()
    } catch (cause) {
      setFormError(summarizeError(cause, 'Could not save the term.'))
    } finally {
      setFormBusy(false)
    }
  }

  async function setYearCurrent(year: PlatformCalendarYear, current: boolean) {
    if (!schoolId) return
    setFormBusy(true)
    setError(null)
    try {
      if (current) {
        await activatePlatformAcademicYear(schoolId, year.id)
        setNotice(`${year.name} is now the current academic year.`)
      } else {
        await deactivatePlatformAcademicYear(schoolId, year.id)
        setNotice(`${year.name} was deactivated.`)
      }
      await refresh()
    } catch (cause) {
      setError(
        summarizeError(
          cause,
          current
            ? 'Could not activate the academic year.'
            : 'Could not deactivate the academic year.',
        ),
      )
    } finally {
      setFormBusy(false)
    }
  }

  function openReset(year: PlatformCalendarYear) {
    setFormError(null)
    setResetForm({
      name: year.name,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      terms: year.terms.map(configFromTerm),
      acknowledgeImpacts: false,
    })
  }

  async function submitReset() {
    if (!resetForm || !activeYear || !schoolId) return

    if (!resetForm.acknowledgeImpacts) {
      setFormError('Confirm that you understand the impact of resetting the calendar.')
      return
    }

    setFormBusy(true)
    setFormError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      'Resetting an academic calendar corrects centrally controlled dates. Confirm your identity to continue.',
    )

    if (!token) {
      setFormBusy(false)
      return
    }

    try {
      const response = await resetPlatformAcademicYear(
        schoolId,
        activeYear.id,
        {
          name: resetForm.name,
          startsOn: resetForm.startsOn,
          endsOn: resetForm.endsOn,
          terms: resetForm.terms,
          acknowledgeImpacts: resetForm.acknowledgeImpacts,
        },
        token,
      )
      setResetForm(null)
      setNotice(
        response.changes.length > 0
          ? `Calendar reset. ${response.changes.join('; ')}`
          : 'Calendar reset completed. Configuration already matched the approved values.',
      )
      await refresh()
    } catch (cause) {
      setFormError(summarizeError(cause, 'Could not reset the calendar.'))
    } finally {
      setFormBusy(false)
    }
  }

  async function submitArchive() {
    if (!archiveYear || !schoolId) return
    setFormBusy(true)
    setFormError(null)

    const token = await ensureReauth(
      PLATFORM_REAUTH_PURPOSE.sensitive,
      `Archiving ${archiveYear.name} removes it from current operations while preserving every historical record. Confirm your identity to continue.`,
    )

    if (!token) {
      setFormBusy(false)
      return
    }

    try {
      await archivePlatformAcademicYear(schoolId, archiveYear.id, token)
      setArchiveYear(null)
      setNotice(
        `${archiveYear.name} archived. Historical records remain available and unchanged.`,
      )
      await refresh()
    } catch (cause) {
      setFormError(summarizeError(cause, 'Could not archive the academic year.'))
    } finally {
      setFormBusy(false)
    }
  }

  async function confirmClose() {
    if (!closeTerm || !schoolId) return
    setFormBusy(true)
    setFormError(null)
    try {
      await closePlatformTerm(schoolId, closeTerm.id)
      setCloseTerm(null)
      setNotice('Term closed.')
      await refresh()
    } catch (cause) {
      setFormError(
        summarizeError(
          cause,
          'This term cannot close until completion checks pass.',
        ),
      )
    } finally {
      setFormBusy(false)
    }
  }

  function applyInput(
    overrideSchoolIds?: string[],
  ): PlatformCalendarApplyInput | null {
    if (!activeYear || !calendar) return null

    return {
      sourceSchoolId: calendar.schoolId,
      yearId: activeYear.id,
      schoolIds:
        overrideSchoolIds ?? (targetMode === 'selected' ? targetSchoolIds : undefined),
    }
  }

  async function previewDistribution() {
    const input = applyInput()
    if (!input) return

    if (targetMode === 'selected' && targetSchoolIds.length === 0) {
      setDistributionError('Select at least one school to preview.')
      return
    }

    setPreviewBusy(true)
    setDistributionError(null)
    setApplyResult(null)
    try {
      const response = await previewPlatformCalendarApply(input)
      setPreview(response.preview)
    } catch (cause) {
      setDistributionError(
        summarizeError(cause, 'Could not preview the calendar distribution.'),
      )
    } finally {
      setPreviewBusy(false)
    }
  }

  async function applyDistribution(overrideSchoolIds?: string[]) {
    const input = applyInput(overrideSchoolIds)
    if (!input) return

    setApplyBusy(true)
    setDistributionError(null)
    try {
      const response = await applyPlatformCalendar(input)
      setApplyResult(response.result)
      setPreview(null)
      setNotice(
        `Distribution finished: ${response.result.succeeded} succeeded, ${response.result.failed} failed.`,
      )
      await refresh()
    } catch (cause) {
      setDistributionError(
        summarizeError(cause, 'Could not apply the calendar.'),
      )
    } finally {
      setApplyBusy(false)
    }
  }

  async function retryFailed() {
    if (!applyResult) return
    const failed = applyResult.results
      .filter((item) => item.status === 'FAILED')
      .map((item) => item.schoolId)
    if (failed.length === 0) return
    await applyDistribution(failed)
  }

  const failedCount = applyResult?.failed ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic calendar"
        description="Platform Super Admin control of academic years, terms, assessment deadlines, examination periods and central distribution. Schools receive a read-only calendar."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void load()}
              loading={loading}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
            <Button
              onClick={() => void runNow()}
              loading={runBusy}
              disabled={!schoolId}
            >
              <CalendarClock aria-hidden="true" className="size-4" />
              Run transitions
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorNotice message={error} onRetry={() => void load()} />
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm text-[#137026]"
        >
          {notice}
        </div>
      ) : null}
      {formError ? <ErrorNotice message={formError} /> : null}

      {loading ? <LoadingPanel label="Loading calendars…" /> : null}

      {!loading && calendars.length === 0 ? (
        <EmptyState
          title="No school calendars"
          description="Calendars are created automatically when a school registers, or by a Platform Super Admin."
          icon={CalendarDays}
        />
      ) : null}

      {calendars.length > 0 ? (
        <>
          <Panel>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Working calendar (source school)"
                value={schoolId}
                onChange={(event) => setSchoolId(event.target.value)}
              >
                {calendars.map((item) => (
                  <option key={item.schoolId} value={item.schoolId}>
                    {item.schoolName}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Academic year"
                value={resolvedYearId}
                onChange={(event) => {
                  setActiveYearId(event.target.value)
                  setPreview(null)
                  setApplyResult(null)
                  setDistributionError(null)
                }}
                disabled={!calendar || calendar.years.length === 0}
              >
                {calendar?.years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                    {year.isCurrent ? ' · current' : ''}
                    {year.isArchived ? ' · archived' : ''}
                  </option>
                ))}
                {(!calendar || calendar.years.length === 0) && (
                  <option value="">No academic year</option>
                )}
              </SelectField>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={openCreateYear}>
                <Plus aria-hidden="true" className="size-4" />
                Create academic year
              </Button>
              {activeYear ? (
                <Button
                  variant="secondary"
                  onClick={() => openEditYear(activeYear)}
                  disabled={activeYear.isArchived}
                >
                  Edit year dates
                </Button>
              ) : null}
            </div>
          </Panel>

          {detailLoading ? <LoadingPanel label="Loading calendar…" /> : null}

          {calendar ? (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">
                    Current academic year
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {calendar.currentYear?.name ?? '—'}
                  </p>
                  <p className="text-xs text-gradely-muted">
                    {calendar.currentYear
                      ? `${formatDate(calendar.currentYear.startsOn)} – ${formatDate(calendar.currentYear.endsOn)}`
                      : 'No current year'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">
                    Current term
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {calendar.currentTerm?.name ?? '—'}
                  </p>
                  <p className="text-xs text-gradely-muted">
                    {calendar.currentTerm
                      ? `${statusLabel(calendar.currentTerm.status)} · ${formatDate(calendar.currentTerm.startsOn)} – ${formatDate(calendar.currentTerm.endsOn)}`
                      : 'No open term'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">
                    Schools using {activeYear?.name ?? 'this year'}
                  </p>
                  <p className="mt-1 text-lg font-extrabold text-gradely-navy">
                    {schoolsUsingYear} / {schools.length}
                  </p>
                  <p className="text-xs text-gradely-muted">
                    {distributionComplete
                      ? 'Distributed to all active schools'
                      : 'Distribution incomplete'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-gradely-muted">
                    Calendar status
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeYear?.isCurrent ? (
                      <Badge tone="success">Active year</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive year</Badge>
                    )}
                    {activeYear?.isArchived ? (
                      <Badge tone="info">Archived</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-gradely-muted">
                    Server date {formatDate(calendar.serverDate)}
                  </p>
                </div>
              </section>

              {activeYear ? (
                <>
                  <Panel>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-gradely-text">
                          {activeYear.name}
                        </h2>
                        <p className="mt-1 text-sm text-gradely-muted">
                          {formatDate(activeYear.startsOn)} –{' '}
                          {formatDate(activeYear.endsOn)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!activeYear.isCurrent && !activeYear.isArchived ? (
                          <Button
                            size="sm"
                            onClick={() => void setYearCurrent(activeYear, true)}
                            loading={formBusy}
                          >
                            Activate
                          </Button>
                        ) : null}
                        {activeYear.isCurrent ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void setYearCurrent(activeYear, false)}
                            loading={formBusy}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                        {!activeYear.isArchived ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openReset(activeYear)}
                            >
                              <RotateCcw aria-hidden="true" className="size-4" />
                              Reset configuration
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => {
                                setFormError(null)
                                setArchiveYear(activeYear)
                              }}
                            >
                              <Archive aria-hidden="true" className="size-4" />
                              Archive year
                            </Button>
                          </>
                        ) : (
                          <Badge tone="info">Archived · read-only history</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-3">
                      {[1, 2, 3].map((sequence) => {
                        const term = termBySequence.get(sequence)

                        return (
                          <div
                            key={sequence}
                            className={`rounded-2xl border p-4 ${
                              term
                                ? term.datesConfirmed
                                  ? 'border-slate-200 bg-white'
                                  : 'border-amber-300 bg-amber-50/60'
                                : 'border-dashed border-slate-300 bg-slate-50'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <h3 className="text-sm font-bold text-gradely-navy">
                                  {term?.name ?? `Term ${sequence}`}
                                </h3>
                                <p className="mt-1 text-xs text-gradely-muted">
                                  {term
                                    ? `${formatDate(term.startsOn)} – ${formatDate(term.endsOn)}`
                                    : 'Not configured'}
                                </p>
                              </div>
                              {term ? (
                                <div className="flex flex-wrap gap-1.5">
                                  <Badge tone={TERM_TONE[term.status] ?? 'neutral'}>
                                    {statusLabel(term.status)}
                                  </Badge>
                                  {term.datesConfirmed ? (
                                    <Badge tone="success">Confirmed</Badge>
                                  ) : (
                                    <Badge tone="warning">
                                      Dates awaiting confirmation
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <Badge tone="warning">Awaiting configuration</Badge>
                              )}
                            </div>

                            {term ? (
                              <dl className="mt-3 space-y-1.5 text-xs">
                                <div className="flex justify-between gap-2">
                                  <dt className="text-gradely-muted">
                                    Assessment deadline
                                  </dt>
                                  <dd className="font-semibold text-gradely-text">
                                    {term.datesConfirmed
                                      ? formatDate(term.assessmentDeadline)
                                      : 'Awaiting confirmation'}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <dt className="text-gradely-muted">
                                    Examination period
                                  </dt>
                                  <dd className="font-semibold text-gradely-text">
                                    {term.datesConfirmed
                                      ? `${formatDate(term.examinationStartsOn)} – ${formatDate(term.examinationEndsOn)}`
                                      : 'Awaiting confirmation'}
                                  </dd>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <dt className="text-gradely-muted">Reports</dt>
                                  <dd className="font-semibold text-gradely-text">
                                    {statusLabel(term.reportStatus)}
                                  </dd>
                                </div>
                              </dl>
                            ) : (
                              <p className="mt-3 text-xs leading-relaxed text-gradely-muted">
                                The Platform Super Admin has not supplied dates
                                for this term. No date is inferred automatically.
                              </p>
                            )}

                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openTerm(sequence, term)}
                                disabled={activeYear.isArchived}
                              >
                                Configure term
                              </Button>
                              {term && term.status === 'OPEN' ? (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => {
                                    setFormError(null)
                                    setCloseTerm(term)
                                  }}
                                >
                                  Close term
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Panel>

                  <Panel>
                    <div className="flex items-start gap-3">
                      <span className="rounded-xl bg-gradely-blue/10 p-2.5">
                        <Send
                          aria-hidden="true"
                          className="size-5 text-gradely-blue"
                        />
                      </span>
                      <div>
                        <h2 className="text-base font-bold text-gradely-text">
                          Distribute {activeYear.name} across schools
                        </h2>
                        <p className="mt-1 text-sm text-gradely-muted">
                          Review the proposed changes first. Each school is
                          updated in its own transaction; unrelated settings and
                          all historical records are preserved.
                        </p>
                      </div>
                    </div>

                    {activeYear.terms.length === 0 ? (
                      <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-gradely-muted">
                        Configure at least one term before distributing this
                        academic year.
                      </p>
                    ) : (
                      <>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <SelectField
                            label="Distribution scope"
                            value={targetMode}
                            onChange={(event) => {
                              setTargetMode(event.target.value as 'all' | 'selected')
                              setPreview(null)
                              setApplyResult(null)
                            }}
                          >
                            <option value="all">
                              All eligible schools ({schools.length})
                            </option>
                            <option value="selected">
                              Selected schools only
                            </option>
                          </SelectField>
                          <div className="flex items-end">
                            <Button
                              onClick={() => void previewDistribution()}
                              loading={previewBusy}
                            >
                              <ClipboardCheck
                                aria-hidden="true"
                                className="size-4"
                              />
                              Preview changes
                            </Button>
                          </div>
                        </div>

                        {targetMode === 'selected' ? (
                          <div className="mt-4 max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-3">
                            {schools.map((school) => (
                              <label
                                key={school.id}
                                className="flex items-center gap-2 py-1 text-sm text-gradely-text"
                              >
                                <input
                                  type="checkbox"
                                  checked={targetSchoolIds.includes(school.id)}
                                  onChange={(event) =>
                                    setTargetSchoolIds((current) =>
                                      event.target.checked
                                        ? [...current, school.id]
                                        : current.filter((id) => id !== school.id),
                                    )
                                  }
                                />
                                {school.name}
                              </label>
                            ))}
                          </div>
                        ) : null}

                        {distributionError ? (
                          <div className="mt-4">
                            <ErrorNotice message={distributionError} />
                          </div>
                        ) : null}

                        {preview ? (
                          <div className="mt-4 space-y-3">
                            <div className="rounded-xl border border-gradely-blue/20 bg-gradely-blue/5 p-4 text-sm">
                              <p className="font-semibold text-gradely-navy">
                                {preview.affectedSchools} of {preview.totalSchools}{' '}
                                school(s) will change
                              </p>
                              <p className="mt-1 text-gradely-muted">
                                Source: {preview.sourceSchoolName} ·{' '}
                                {preview.yearName}
                              </p>
                            </div>
                            <div className="space-y-2">
                              {preview.schools.map((school) => (
                                <div
                                  key={school.schoolId}
                                  className="rounded-xl border border-slate-200 p-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-gradely-text">
                                      {school.schoolName}
                                    </p>
                                    <Badge
                                      tone={
                                        school.action === 'CREATE'
                                          ? 'info'
                                          : school.action === 'UPDATE'
                                            ? 'warning'
                                            : 'neutral'
                                      }
                                    >
                                      {school.action}
                                    </Badge>
                                  </div>
                                  {school.changes.length > 0 ? (
                                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-gradely-muted">
                                      {school.changes.map((change) => (
                                        <li key={change}>{change}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="mt-2 text-xs text-gradely-muted">
                                      No calendar changes required.
                                    </p>
                                  )}
                                  {school.warnings.length > 0 ? (
                                    <ul className="mt-2 space-y-1 text-xs text-amber-800">
                                      {school.warnings.map((warning) => (
                                        <li key={warning}>{warning}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                            <div className="flex justify-end">
                              <Button
                                onClick={() => void applyDistribution()}
                                loading={applyBusy}
                                disabled={preview.affectedSchools === 0}
                              >
                                <CheckCircle2
                                  aria-hidden="true"
                                  className="size-4"
                                />
                                Apply to {preview.affectedSchools} school(s)
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {applyResult ? (
                          <div className="mt-5 space-y-3">
                            <div
                              className={`rounded-xl border p-4 text-sm ${
                                applyResult.failed > 0
                                  ? 'border-red-300 bg-red-50 text-red-900'
                                  : 'border-gradely-green/30 bg-gradely-green/10 text-[#137026]'
                              }`}
                            >
                              <p className="font-semibold">
                                Distribution summary: {applyResult.succeeded}{' '}
                                succeeded, {applyResult.failed} failed,{' '}
                                {applyResult.totalSchools} total.
                              </p>
                              {applyResult.failed > 0 ? (
                                <p className="mt-1">
                                  Failed schools are listed below. A failure in
                                  one school never marks another school as
                                  successful.
                                </p>
                              ) : null}
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-slate-200 text-xs">
                                <thead>
                                  <tr className="text-left uppercase tracking-wide text-gradely-muted">
                                    <th className="px-2 py-1.5 font-semibold">
                                      School
                                    </th>
                                    <th className="px-2 py-1.5 font-semibold">
                                      Status
                                    </th>
                                    <th className="px-2 py-1.5 font-semibold">
                                      Action
                                    </th>
                                    <th className="px-2 py-1.5 font-semibold">
                                      Detail
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {applyResult.results.map((result) => (
                                    <tr key={result.schoolId}>
                                      <td className="px-2 py-2 font-semibold text-gradely-text">
                                        {result.schoolName}
                                      </td>
                                      <td className="px-2 py-2">
                                        <Badge
                                          tone={
                                            result.status === 'SUCCEEDED'
                                              ? 'success'
                                              : 'warning'
                                          }
                                        >
                                          {result.status}
                                        </Badge>
                                      </td>
                                      <td className="px-2 py-2 text-gradely-muted">
                                        {result.action ?? '—'}
                                      </td>
                                      <td className="px-2 py-2 text-gradely-muted">
                                        {result.error ||
                                          result.warnings.join(' ') ||
                                          '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {failedCount > 0 ? (
                              <div className="flex justify-end">
                                <Button
                                  variant="secondary"
                                  onClick={() => void retryFailed()}
                                  loading={applyBusy}
                                >
                                  <RefreshCw
                                    aria-hidden="true"
                                    className="size-4"
                                  />
                                  Retry {failedCount} failed school(s)
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}
                  </Panel>

                  <Panel>
                    <h2 className="flex items-center gap-2 text-base font-bold text-gradely-text">
                      <ShieldAlert
                        aria-hidden="true"
                        className="size-5 text-gradely-blue"
                      />
                      Transition history
                    </h2>
                    {transitions.length === 0 ? (
                      <p className="mt-2 text-sm text-gradely-muted">
                        No transitions recorded.
                      </p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-xs">
                          <thead>
                            <tr className="text-left uppercase tracking-wide text-gradely-muted">
                              <th className="px-2 py-1.5 font-semibold">When</th>
                              <th className="px-2 py-1.5 font-semibold">
                                Action
                              </th>
                              <th className="px-2 py-1.5 font-semibold">
                                Status
                              </th>
                              <th className="px-2 py-1.5 font-semibold">
                                Trigger
                              </th>
                              <th className="px-2 py-1.5 font-semibold">
                                Message
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {transitions.map((transition) => (
                              <tr key={transition.id}>
                                <td className="px-2 py-1.5 text-gradely-muted">
                                  {formatDateTime(transition.createdAt)}
                                </td>
                                <td className="px-2 py-1.5 font-semibold text-gradely-text">
                                  {statusLabel(transition.action)}
                                </td>
                                <td className="px-2 py-1.5 text-gradely-muted">
                                  {transition.status}
                                </td>
                                <td className="px-2 py-1.5 text-gradely-muted">
                                  {transition.trigger}
                                </td>
                                <td className="px-2 py-1.5 text-gradely-muted">
                                  {transition.message ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                </>
              ) : (
                <Panel>
                  <p className="text-sm text-gradely-muted">
                    This school has no academic year yet. Create one to begin
                    centrally managing its calendar.
                  </p>
                </Panel>
              )}
            </>
          ) : null}
        </>
      ) : null}

      <Modal
        open={yearForm !== null}
        title={
          yearForm?.mode === 'create'
            ? 'Create academic year'
            : 'Edit academic year'
        }
        description="Academic year dates are the outer bounds for every term. Changes are audited."
        onClose={() => {
          if (!formBusy) setYearForm(null)
        }}
      >
        {yearForm ? (
          <div className="space-y-3">
            <FormField
              label="Academic year name"
              value={yearForm.name}
              placeholder="2026/2027"
              onChange={(event) =>
                setYearForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
            <FormField
              label="Opening date"
              type="date"
              value={yearForm.startsOn}
              onChange={(event) =>
                setYearForm((current) =>
                  current ? { ...current, startsOn: event.target.value } : current,
                )
              }
            />
            <FormField
              label="Closing date"
              type="date"
              value={yearForm.endsOn}
              onChange={(event) =>
                setYearForm((current) =>
                  current ? { ...current, endsOn: event.target.value } : current,
                )
              }
            />
            {yearForm.mode === 'create' ? (
              <label className="flex items-start gap-2 text-sm text-gradely-text">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={yearForm.activate}
                  onChange={(event) =>
                    setYearForm((current) =>
                      current
                        ? { ...current, activate: event.target.checked }
                        : current,
                    )
                  }
                />
                Make this the current academic year. Any other current year is
                deactivated in the same transaction.
              </label>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => setYearForm(null)}
                disabled={formBusy}
              >
                Cancel
              </Button>
              <Button onClick={() => void saveYear()} loading={formBusy}>
                Save academic year
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={termForm !== null}
        title={`Configure ${termForm?.name ?? 'term'}`}
        description="Deadlines and examination periods are stored independently. Confirmed terms are the only ones the scheduler can open or close."
        onClose={() => {
          if (!formBusy) setTermForm(null)
        }}
        wide
      >
        {termForm ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label="Term name"
                value={termForm.name}
                onChange={(event) =>
                  setTermForm((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
              <FormField
                label="Sequence"
                value={String(termForm.sequence)}
                disabled
                onChange={() => undefined}
              />
              <FormField
                label="Opening date"
                type="date"
                value={termForm.startsOn}
                onChange={(event) =>
                  setTermForm((current) =>
                    current
                      ? { ...current, startsOn: event.target.value }
                      : current,
                  )
                }
              />
              <FormField
                label="Closing date"
                type="date"
                value={termForm.endsOn}
                onChange={(event) =>
                  setTermForm((current) =>
                    current ? { ...current, endsOn: event.target.value } : current,
                  )
                }
              />
              <FormField
                label="Assessment deadline"
                type="date"
                value={termForm.assessmentDeadline}
                onChange={(event) =>
                  setTermForm((current) =>
                    current
                      ? { ...current, assessmentDeadline: event.target.value }
                      : current,
                  )
                }
              />
              <FormField
                label="Examination starts"
                type="date"
                value={termForm.examinationStartsOn}
                onChange={(event) =>
                  setTermForm((current) =>
                    current
                      ? { ...current, examinationStartsOn: event.target.value }
                      : current,
                  )
                }
              />
              <FormField
                label="Examination ends"
                type="date"
                value={termForm.examinationEndsOn}
                onChange={(event) =>
                  setTermForm((current) =>
                    current
                      ? { ...current, examinationEndsOn: event.target.value }
                      : current,
                  )
                }
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-gradely-text">
              <input
                type="checkbox"
                className="mt-1"
                checked={termForm.datesConfirmed}
                onChange={(event) =>
                  setTermForm((current) =>
                    current
                      ? { ...current, datesConfirmed: event.target.checked }
                      : current,
                  )
                }
              />
              <span>
                <span className="font-semibold">
                  Confirm these dates for the academic calendar
                </span>
                <span className="mt-0.5 block text-xs text-gradely-muted">
                  Leave unchecked when the dates are provisional. Unconfirmed
                  terms display “Dates Awaiting Confirmation” and are never
                  opened, closed or used for report preparation.
                </span>
              </span>
            </label>

            {termForm.existing && termForm.status !== 'PLANNED' ? (
              <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={termForm.acknowledgeImpacts}
                  onChange={(event) =>
                    setTermForm((current) =>
                      current
                        ? {
                            ...current,
                            acknowledgeImpacts: event.target.checked,
                          }
                        : current,
                    )
                  }
                />
                <span>
                  <span className="font-semibold">
                    This term is already {termForm.status.toLowerCase()}.
                  </span>{' '}
                  Correcting its dates may trigger an immediate scheduler
                  transition. I understand the impact and want to continue.
                </span>
              </label>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-gradely-muted">
              <p className="font-semibold text-gradely-text">
                What is not changed
              </p>
              <p className="mt-1">
                Saving term configuration never changes report release status,
                approvals, payment verification, submitted assessments, accepted
                results or existing report snapshots.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => setTermForm(null)}
                disabled={formBusy}
              >
                Cancel
              </Button>
              <Button onClick={() => void saveTerm()} loading={formBusy}>
                Save term
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={resetForm !== null}
        title={`Reset ${resetForm?.name ?? 'calendar'} configuration`}
        description="Reset corrects the centrally controlled dates in place. It never deletes an academic year, term, enrollment, score, report, invoice or audit record."
        onClose={() => {
          if (!formBusy) setResetForm(null)
        }}
        wide
      >
        {resetForm ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert aria-hidden="true" className="size-4" />
                This operation is audited and requires reauthentication.
              </p>
              <p className="mt-1 text-xs">
                Report preparation, approvals, payments, submitted results,
                accepted results and report snapshots are not reset.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                label="Year name"
                value={resetForm.name}
                onChange={(event) =>
                  setResetForm((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
              <FormField
                label="Opening date"
                type="date"
                value={resetForm.startsOn}
                onChange={(event) =>
                  setResetForm((current) =>
                    current
                      ? { ...current, startsOn: event.target.value }
                      : current,
                  )
                }
              />
              <FormField
                label="Closing date"
                type="date"
                value={resetForm.endsOn}
                onChange={(event) =>
                  setResetForm((current) =>
                    current ? { ...current, endsOn: event.target.value } : current,
                  )
                }
              />
            </div>

            <div className="space-y-3">
              {resetForm.terms.map((term, index) => (
                <div
                  key={term.sequence}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gradely-text">
                      {term.name}
                    </p>
                    <Badge tone={term.datesConfirmed ? 'success' : 'warning'}>
                      {term.datesConfirmed
                        ? 'Confirmed'
                        : 'Dates awaiting confirmation'}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    {(
                      [
                        ['startsOn', 'Opening'],
                        ['endsOn', 'Closing'],
                        ['assessmentDeadline', 'Deadline'],
                        ['examinationStartsOn', 'Exam start'],
                        ['examinationEndsOn', 'Exam end'],
                      ] as const
                    ).map(([field, label]) => (
                      <FormField
                        key={field}
                        label={label}
                        type="date"
                        value={term[field]}
                        onChange={(event) =>
                          setResetForm((current) => {
                            if (!current) return current
                            const terms = current.terms.slice()
                            terms[index] = { ...terms[index]!, [field]: event.target.value }
                            return { ...current, terms }
                          })
                        }
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gradely-muted">
                    {describeTerm(term)}
                  </p>
                </div>
              ))}
            </div>

            <label className="flex items-start gap-2 text-sm text-gradely-text">
              <input
                type="checkbox"
                className="mt-1"
                checked={resetForm.acknowledgeImpacts}
                onChange={(event) =>
                  setResetForm((current) =>
                    current
                      ? {
                          ...current,
                          acknowledgeImpacts: event.target.checked,
                        }
                      : current,
                  )
                }
              />
              I understand that this reset corrects calendar configuration in
              place and does not restore historical academic records.
            </label>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setResetForm(null)}
                disabled={formBusy}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void submitReset()}
                loading={formBusy}
                disabled={!resetForm.acknowledgeImpacts}
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                Reset configuration
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={archiveYear !== null}
        title={`Archive ${archiveYear?.name ?? 'academic year'}`}
        description="Archiving keeps every academic year, term, enrollment, score, report, invoice and audit record available for viewing. The year is removed from current operations. A current year must be deactivated first, and this action requires reauthentication."
        confirmLabel="Archive year"
        danger
        busy={formBusy}
        onConfirm={() => void submitArchive()}
        onCancel={() => {
          if (!formBusy) setArchiveYear(null)
        }}
      />

      <ConfirmDialog
        open={closeTerm !== null}
        title="Close term now"
        description={
          closeTerm
            ? `Closing ${closeTerm.name} runs the completion check. If any required result submission is not accepted, the term will not close.`
            : ''
        }
        confirmLabel="Close term"
        danger
        busy={formBusy}
        onConfirm={() => void confirmClose()}
        onCancel={() => {
          if (!formBusy) setCloseTerm(null)
        }}
      />
    </div>
  )
}
