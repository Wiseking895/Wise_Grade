import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  RefreshCw,
  Users,
  Wand2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import { Link } from 'react-router-dom'
import {
  AccessDenied,
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import {
  generateReports,
  getReportEligibility,
  listReportClasses,
} from '../../reports/api'
import { DraftNotice } from '../../reports/components'
import {
  BATCH_STATUS_LABELS,
  GENERATION_SCOPE_LABELS,
  batchTone,
} from '../../reports/labels'
import type {
  GenerateReportsResult,
  ReportClass,
  ReportEligibilityResult,
  ReportGenerationScope,
} from '../../reports/types'
import { useAcademicTerms } from '../../reports/use-academic-terms'
import { useSchool } from '../../schools/use-school'

export default function ReportGeneratePage() {
  const { schoolId, isAdmin } = useSchool()
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
  const [scope, setScope] = useState<ReportGenerationScope>('CLASS')
  const [eligibility, setEligibility] =
    useState<ReportEligibilityResult | null>(null)
  const [pupilId, setPupilId] = useState('')
  const [loadingClasses, setLoadingClasses] = useState(false)
  const [loadingEligibility, setLoadingEligibility] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateReportsResult | null>(null)

  const loadClasses = useCallback(async () => {
    if (!schoolId || !selected || !isAdmin) {
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
          : 'Could not load classes available for report generation.',
      )
    } finally {
      setLoadingClasses(false)
    }
  }, [isAdmin, schoolId, selected])

  const loadEligibility = useCallback(async () => {
    if (!schoolId || !selected || !classId || scope === 'TERM') {
      setEligibility(null)
      setPupilId('')
      return
    }

    try {
      setLoadingEligibility(true)
      const response = await getReportEligibility(schoolId, {
        academicYearId: selected.yearId,
        academicTermId: selected.termId,
        classId,
      })
      setEligibility(response.eligibility)
      setPupilId((current) => {
        if (response.eligibility.pupils.some((item) => item.pupilId === current)) {
          return current
        }
        return (
          response.eligibility.pupils.find((item) => item.eligible)?.pupilId ??
          ''
        )
      })
    } catch (cause) {
      setEligibility(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not check report eligibility.',
      )
    } finally {
      setLoadingEligibility(false)
    }
  }, [classId, schoolId, scope, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClasses()
  }, [loadClasses])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEligibility()
  }, [loadEligibility])

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can generate report cards." />
    )
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!schoolId || !selected) return

    if (scope !== 'TERM' && !classId) {
      setError('Select a class before generating report cards.')
      return
    }

    if (scope === 'INDIVIDUAL' && !pupilId) {
      setError('Select an eligible pupil before generating a report card.')
      return
    }

    try {
      setGenerating(true)
      setError(null)
      setResult(null)
      const response = await generateReports(schoolId, {
        academicYearId: selected.yearId,
        academicTermId: selected.termId,
        scope,
        classId: scope === 'TERM' ? null : classId,
        pupilIds: scope === 'INDIVIDUAL' ? [pupilId] : undefined,
      })
      setResult(response)
      await loadEligibility()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not generate report cards.',
      )
    } finally {
      setGenerating(false)
    }
  }

  const eligibleCount =
    eligibility?.pupils.filter((item) => item.eligible).length ?? 0
  const ineligible = eligibility?.pupils.filter((item) => !item.eligible) ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate report cards"
        description="Generate internal, versioned PDFs from accepted results and stored grading snapshots. Generation is not release: every preview remains an internal draft."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadClasses()
              void loadEligibility()
              void reloadTerms()
            }}
            loading={loadingClasses || loadingEligibility || termsLoading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <DraftNotice description="Generation creates a new immutable version for each eligible pupil. Ineligible pupils are skipped with a reason; they are never printed as apparently complete reports." />

      {termsError ? (
        <ErrorNotice message={termsError} onRetry={() => void reloadTerms()} />
      ) : null}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void loadEligibility()} />
      ) : null}

      <form onSubmit={(event) => void handleGenerate(event)} className="space-y-6">
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
              label="Generation scope"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as ReportGenerationScope)
              }
              hint="Term-wide generation includes every class you can access."
            >
              {Object.entries(GENERATION_SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>

            {scope !== 'TERM' ? (
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
            ) : null}

            {scope === 'INDIVIDUAL' ? (
              <SelectField
                label="Pupil"
                value={pupilId}
                onChange={(event) => setPupilId(event.target.value)}
                disabled={loadingEligibility || !eligibility}
                hint="Only pupils with complete accepted results are selectable."
              >
                {eligibility?.pupils.length ? null : (
                  <option value="">No pupils available</option>
                )}
                {eligibility?.pupils.map((item) => (
                  <option
                    key={item.pupilId}
                    value={item.pupilId}
                    disabled={!item.eligible}
                  >
                    {item.pupilName}
                    {item.eligible ? '' : ' — not eligible'}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
            <p className="text-xs text-gradely-muted">
              {scope === 'TERM'
                ? 'Every accessible class will be evaluated. Ineligible pupils are reported as skipped.'
                : eligibility
                  ? `${eligibleCount} of ${eligibility.onRoll} pupils on roll are eligible in ${eligibility.className}.`
                  : 'Select a class to check eligibility.'}
            </p>
            <Button
              type="submit"
              loading={generating}
              disabled={
                !selected ||
                (scope !== 'TERM' && !classId) ||
                (scope === 'INDIVIDUAL' && !pupilId)
              }
            >
              <Wand2 aria-hidden="true" className="size-4" />
              Generate internal report cards
            </Button>
          </div>
        </Panel>
      </form>

      {loadingClasses || loadingEligibility ? (
        <LoadingPanel label="Checking accepted results and eligibility…" />
      ) : null}

      {scope !== 'TERM' && eligibility ? (
        <Panel className="overflow-hidden p-0 sm:p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-gradely-text">
                Eligibility · {eligibility.className}
              </h2>
              <p className="mt-0.5 text-xs text-gradely-muted">
                {eligibility.onRoll} on roll · {eligibleCount} eligible
              </p>
            </div>
            <Badge tone={ineligible.length === 0 ? 'success' : 'warning'}>
              {ineligible.length === 0
                ? 'All pupils eligible'
                : `${ineligible.length} skipped`}
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Pupil
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Eligibility
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {eligibility.pupils.map((item) => (
                  <tr
                    key={item.pupilId}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-5 py-3 font-semibold text-gradely-text">
                      {item.pupilName}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={item.eligible ? 'success' : 'warning'}>
                        {item.eligible ? 'Eligible' : 'Skipped'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-gradely-muted">
                      {item.failure?.message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {scope === 'TERM' ? (
        <div className="flex items-start gap-3 rounded-2xl border border-gradely-gold/40 bg-gradely-gold/10 p-4 text-sm text-[#7a5400]">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>
            Term-wide generation evaluates each accessible class separately.
            Review the batch result for skipped pupils and failure reasons.
          </p>
        </div>
      ) : null}

      {result ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gradely-text">
                Generation result
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                {result.batch.generatedCount} generated ·{' '}
                {result.batch.skippedCount} skipped · {result.batch.failedCount}{' '}
                failed
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={batchTone(result.batch.status)}>
                {BATCH_STATUS_LABELS[result.batch.status]}
              </Badge>
              <Link
                to={`/dashboard/reports/batches?batchId=${result.batch.id}`}
                className="text-xs font-semibold text-gradely-navy hover:underline"
              >
                Open batch detail
              </Link>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Pupil
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Outcome
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Version
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((item) => (
                  <tr
                    key={`${item.classId}-${item.pupilId}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 font-semibold text-gradely-text">
                      {item.pupilName}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          item.status === 'GENERATED'
                            ? 'success'
                            : item.status === 'FAILED'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {item.status === 'GENERATED' ? (
                          <CheckCircle2
                            aria-hidden="true"
                            className="mr-1 size-3.5"
                          />
                        ) : item.status === 'FAILED' ? (
                          <FileWarning
                            aria-hidden="true"
                            className="mr-1 size-3.5"
                          />
                        ) : (
                          <Users aria-hidden="true" className="mr-1 size-3.5" />
                        )}
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gradely-text">
                      {item.version === null ? '—' : `v${item.version}`}
                    </td>
                    <td className="px-4 py-3 text-xs text-gradely-muted">
                      {item.failureMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Link
              to="/dashboard/reports"
              className="text-sm font-semibold text-gradely-navy hover:underline"
            >
              View generated report cards
            </Link>
          </div>
        </Panel>
      ) : null}

      {!loadingEligibility && scope !== 'TERM' && eligibility?.pupils.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No pupils on roll"
          description="Add pupils and accepted results to this class before generating report cards."
        />
      ) : null}
    </div>
  )
}
