import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  RefreshCw,
  ShieldCheck,
  Wand2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
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
  generatePlatformReports,
  getPlatformReportEligibility,
  listPlatformReportClasses,
  listPlatformReportSchools,
} from '../../reports/api'
import type {
  GenerateReportsResult,
  PlatformReportSchoolScope,
  ReportClass,
  ReportEligibilityResult,
} from '../../reports/types'

type GenerationScope = 'CLASS' | 'TERM'

export default function PlatformReportGeneratePage() {
  const [schools, setSchools] = useState<PlatformReportSchoolScope[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [yearId, setYearId] = useState('')
  const [termId, setTermId] = useState('')
  const [classId, setClassId] = useState('')
  const [scope, setScope] = useState<GenerationScope>('CLASS')

  const [classes, setClasses] = useState<ReportClass[]>([])
  const [eligibility, setEligibility] =
    useState<ReportEligibilityResult | null>(null)
  const [result, setResult] = useState<GenerateReportsResult | null>(null)

  const [referenceLoading, setReferenceLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [eligibilityLoading, setEligibilityLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSchool = schools.find((school) => school.id === schoolId) ?? null
  const yearOptions = selectedSchool?.academicYears ?? []
  const selectedYear = yearOptions.find((year) => year.id === yearId) ?? null
  const termOptions = selectedYear?.terms ?? []

  const loadReference = useCallback(async () => {
    try {
      setReferenceLoading(true)
      const response = await listPlatformReportSchools()
      setSchools(response.schools)
      setSchoolId((current) =>
        response.schools.some((school) => school.id === current)
          ? current
          : (response.schools[0]?.id ?? ''),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load platform report scopes.',
      )
    } finally {
      setReferenceLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReference()
  }, [loadReference])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClasses([])
    setClassId('')
    setEligibility(null)
    setResult(null)
  }, [schoolId, yearId, termId])

  const loadClasses = useCallback(async () => {
    if (!schoolId || !yearId || !termId) {
      setClasses([])
      return
    }

    try {
      setLoading(true)
      const response = await listPlatformReportClasses(schoolId, {
        academicYearId: yearId,
        academicTermId: termId,
      })
      setClasses(response.classes)
      setClassId((current) =>
        response.classes.some((item) => item.id === current) ? current : '',
      )
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load report classes.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId, yearId, termId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClasses()
  }, [loadClasses])

  const loadEligibility = useCallback(async () => {
    if (!schoolId || !yearId || !termId || !classId) {
      setEligibility(null)
      return
    }

    try {
      setEligibilityLoading(true)
      const response = await getPlatformReportEligibility(schoolId, {
        academicYearId: yearId,
        academicTermId: termId,
        classId,
      })
      setEligibility(response.eligibility)
      setError(null)
    } catch (cause) {
      setEligibility(null)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not check report eligibility.',
      )
    } finally {
      setEligibilityLoading(false)
    }
  }, [schoolId, yearId, termId, classId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEligibility()
  }, [loadEligibility])

  async function generate() {
    if (!schoolId || !yearId || !termId) return
    if (scope === 'CLASS' && !classId) return

    setGenerating(true)
    setError(null)
    setResult(null)

    try {
      const response = await generatePlatformReports(schoolId, {
        academicYearId: yearId,
        academicTermId: termId,
        classId: scope === 'TERM' ? null : classId,
        scope,
      })
      setResult(response)
      setEligibility(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not generate reports.',
      )
    } finally {
      setGenerating(false)
    }
  }

  const canGenerate =
    Boolean(schoolId && yearId && termId) &&
    (scope === 'TERM' || Boolean(classId)) &&
    !generating

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate reports"
        description="Prepare report cards only from accepted, eligible results. Generation creates a platform-reviewed batch; it never releases reports to the school."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadReference()
              void loadClasses()
              void loadEligibility()
            }}
            loading={referenceLoading || loading || eligibilityLoading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-gradely-blue/20 bg-gradely-blue/5 p-4">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-gradely-navy"
        />
        <p className="text-sm leading-relaxed text-gradely-muted">
          Generation requires accepted results, a complete report input and a
          verified billing position where applicable. The new batch enters the
          platform review queue and remains private until approval and explicit
          release.
        </p>
      </div>

      {error ? (
        <ErrorNotice
          message={error}
          onRetry={() => {
            void loadReference()
            void loadClasses()
            void loadEligibility()
          }}
        />
      ) : null}

      <Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          <SelectField
            label="School"
            value={schoolId}
            onChange={(event) => {
              setSchoolId(event.target.value)
              setYearId('')
              setTermId('')
            }}
            disabled={referenceLoading || schools.length === 0}
          >
            {schools.length === 0 ? (
              <option value="">No schools available</option>
            ) : null}
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
                {school.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Academic year"
            value={yearId}
            onChange={(event) => {
              setYearId(event.target.value)
              setTermId('')
            }}
            disabled={!selectedSchool}
          >
            <option value="">Select a year</option>
            {yearOptions.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Academic term"
            value={termId}
            onChange={(event) => setTermId(event.target.value)}
            disabled={!selectedYear}
          >
            <option value="">Select a term</option>
            {termOptions.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Generation scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as GenerationScope)
              setResult(null)
            }}
            disabled={!termId}
          >
            <option value="CLASS">One class</option>
            <option value="TERM">Whole term</option>
          </SelectField>

          {scope === 'CLASS' ? (
            <SelectField
              label="Class"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value)
                setResult(null)
              }}
              disabled={loading || classes.length === 0}
            >
              <option value="">Select a class</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            onClick={() => void generate()}
            disabled={!canGenerate}
            loading={generating}
          >
            <Wand2 aria-hidden="true" className="size-4" />
            Generate reports
          </Button>
        </div>
      </Panel>

      {eligibilityLoading ? (
        <LoadingPanel label="Checking report eligibility…" />
      ) : eligibility ? (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gradely-text">
                {eligibility.className} eligibility
              </h2>
              <p className="mt-0.5 text-xs text-gradely-muted">
                {eligibility.eligibleCount} of {eligibility.onRoll} pupils are
                eligible for report generation.
              </p>
            </div>
            <Badge
              tone={
                eligibility.eligibleCount === eligibility.onRoll
                  ? 'success'
                  : 'warning'
              }
            >
              {eligibility.eligibleCount === eligibility.onRoll
                ? 'All eligible'
                : `${eligibility.onRoll - eligibility.eligibleCount} blocked`}
            </Badge>
          </div>

          {eligibility.pupils.some((pupil) => !pupil.eligible) ? (
            <div className="mt-4 rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-[#6b4a00]">
                <AlertTriangle
                  aria-hidden="true"
                  className="size-4 shrink-0"
                />
                Ineligible pupils
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[#7a5400]">
                {eligibility.pupils
                  .filter((pupil) => !pupil.eligible)
                  .map((pupil) => (
                    <li key={pupil.pupilId}>
                      • {pupil.pupilName}:{' '}
                      {pupil.failure?.message ?? 'Not eligible'}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {result ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-gradely-text">
                <CheckCircle2
                  aria-hidden="true"
                  className="size-5 text-[#137026]"
                />
                Generation batch queued for platform review
              </h2>
              <p className="mt-1 text-sm text-gradely-muted">
                Batch {result.batch.id.slice(0, 8)} ·{' '}
                {result.batch.generatedCount} generated ·{' '}
                {result.batch.skippedCount} skipped ·{' '}
                {result.batch.failedCount} failed.
              </p>
            </div>
            <Link
              to="/platform/reports"
              className="inline-flex items-center gap-2 rounded-xl bg-gradely-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#123c80]"
            >
              <FilePlus2 aria-hidden="true" className="size-4" />
              Open review queue
            </Link>
          </div>

          <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gradely-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Pupil</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Outcome</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Version</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((item) => (
                  <tr
                    key={`${item.pupilId}-${item.status}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-4 py-2 font-semibold text-gradely-text">
                      {item.pupilName}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          item.status === 'GENERATED'
                            ? 'success'
                            : item.status === 'FAILED'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-gradely-muted">
                      {item.version === null ? '—' : `v${item.version}`}
                    </td>
                    <td className="px-4 py-2 text-xs text-gradely-muted">
                      {item.failureMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {!referenceLoading && schools.length === 0 ? (
        <EmptyState
          icon={FilePlus2}
          title="No schools available"
          description="Schools appear here once they have registered on the Wise Grade platform."
        />
      ) : null}
    </div>
  )
}
