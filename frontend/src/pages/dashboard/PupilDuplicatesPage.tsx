import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  GitMerge,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import {
  AccessDenied,
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
import { apiErrorMessage } from '../../lib/api-error-message'
import { formatDateTime, statusLabel } from '../../lib/format'
import {
  listPupilDuplicates,
  mergePupils,
  previewPupilMerge,
  recordPupilDuplicateDecision,
} from '../../schools/api'
import type {
  PupilDuplicateAudit,
  PupilDuplicateCategory,
  PupilDuplicateGroup,
  PupilDuplicateGroupPupil,
  PupilDuplicatePair,
  PupilMergePreview,
} from '../../schools/types'
import { useSchool } from '../../schools/use-school'

const CATEGORY_META: Record<
  PupilDuplicateCategory,
  {
    label: string
    tone: 'neutral' | 'success' | 'warning' | 'info'
    description: string
  }
> = {
  DEFINITE: {
    label: 'Definite duplicate',
    tone: 'warning',
    description:
      'The complete name and admission number are identical. Keep one record and archive the other after its safe history is transferred.',
  },
  NAME_CONFLICT: {
    label: 'Possible duplicate',
    tone: 'info',
    description:
      'The complete name is identical but the admission number differs. Confirm whether these records belong to the same pupil.',
  },
  ADMISSION_CONFLICT: {
    label: 'Admission conflict',
    tone: 'warning',
    description:
      'One admission number is assigned to different names. Correct the admission number on one record before doing anything else.',
  },
}

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  ACTIVE: 'success',
  INACTIVE: 'warning',
  ARCHIVED: 'neutral',
}

function pupilDisplayName(pupil: PupilDuplicateGroupPupil): string {
  return [pupil.firstName, pupil.lastName, pupil.otherNames]
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

function pairKey(pair: PupilDuplicatePair): string {
  return `${pair.pupilIds[0]}:${pair.pupilIds[1]}`
}

function decisionLabel(pair: PupilDuplicatePair): string {
  if (pair.decision === 'DIFFERENT') return 'Marked as different pupils'
  if (pair.decision === 'SAME') return 'Marked as the same pupil — merge pending'
  if (pair.decision === 'MERGED') return 'Merged'
  return 'Not yet reviewed'
}

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  hint: string
  icon: LucideIcon
  tone: 'neutral' | 'success' | 'warning' | 'info'
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    success: 'bg-gradely-green/10 text-[#137026]',
    warning: 'bg-gradely-gold/15 text-[#7a5400]',
    info: 'bg-gradely-blue/10 text-gradely-navy',
  }

  return (
    <Panel className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
          {label}
        </p>
        <p className="mt-2 text-3xl font-extrabold text-gradely-navy">{value}</p>
        <p className="mt-1 text-xs leading-relaxed text-gradely-muted">{hint}</p>
      </div>
      <span className={`rounded-2xl p-2.5 ${tones[tone]}`}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
    </Panel>
  )
}

function PupilIdentityCard({
  pupil,
  emphasis = false,
}: {
  pupil: PupilDuplicateGroupPupil
  emphasis?: boolean
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphasis
          ? 'border-gradely-blue bg-gradely-blue/5'
          : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-base font-bold text-gradely-text">
        {pupilDisplayName(pupil)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
            Admission
          </dt>
          <dd className="font-medium text-gradely-text">
            {pupil.admissionNumber}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
            Class
          </dt>
          <dd className="font-medium text-gradely-text">
            {pupil.currentClassName ?? 'Not enrolled'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
            Status
          </dt>
          <dd>
            <Badge tone={STATUS_TONE[pupil.status] ?? 'neutral'}>
              {statusLabel(pupil.status)}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gradely-muted">
            Record
          </dt>
          <dd className="break-all font-mono text-xs text-gradely-muted">
            {pupil.id}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function PupilDuplicatesPage() {
  const { schoolId, isAdmin } = useSchool()

  const [audit, setAudit] = useState<PupilDuplicateAudit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [category, setCategory] = useState<'' | PupilDuplicateCategory>('')
  const [searchInput, setSearchInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')

  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null)
  const [activePairKey, setActivePairKey] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [confirmDifferentOpen, setConfirmDifferentOpen] = useState(false)

  const [mergeOpen, setMergeOpen] = useState(false)
  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PupilMergePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRefresh, setPreviewRefresh] = useState(0)
  const [mergeNote, setMergeNote] = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [confirmMergeOpen, setConfirmMergeOpen] = useState(false)

  const load = useCallback(async () => {
    if (!schoolId) return

    setLoading(true)
    setError(null)

    try {
      const result = await listPupilDuplicates(schoolId, {
        category: category || undefined,
        q: appliedQuery || undefined,
      })
      setAudit(result)
    } catch (cause) {
      setError(apiErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [schoolId, category, appliedQuery])

  useEffect(() => {
    // Data fetching is the intended external-system synchronisation here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const activeGroup = useMemo(
    () =>
      audit?.groups.find((group) => group.key === activeGroupKey) ?? null,
    [audit, activeGroupKey],
  )

  const activePair = useMemo(
    () =>
      activeGroup?.pairs.find((pair) => pairKey(pair) === activePairKey) ??
      null,
    [activeGroup, activePairKey],
  )

  const pairPupils = useMemo(() => {
    if (!activeGroup || !activePair) return null

    const left =
      activeGroup.pupils.find(
        (pupil) => pupil.id === activePair.pupilIds[0],
      ) ?? null
    const right =
      activeGroup.pupils.find(
        (pupil) => pupil.id === activePair.pupilIds[1],
      ) ?? null

    return left && right ? { left, right } : null
  }, [activeGroup, activePair])

  const duplicateId = useMemo(() => {
    if (!activePair || !primaryId) return null
    return activePair.pupilIds.find((id) => id !== primaryId) ?? null
  }, [activePair, primaryId])

  useEffect(() => {
    if (!mergeOpen || !schoolId || !primaryId || !duplicateId) return

    let cancelled = false
    // The preview is a read from an external system; the loading flags are
    // reset here before the request starts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)

    previewPupilMerge(schoolId, {
      primaryPupilId: primaryId,
      duplicatePupilId: duplicateId,
    })
      .then((response) => {
        if (!cancelled) setPreview(response.preview)
      })
      .catch((cause) => {
        if (!cancelled) setPreviewError(apiErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mergeOpen, schoolId, primaryId, duplicateId, previewRefresh])

  function openCompare(group: PupilDuplicateGroup) {
    setActiveGroupKey(group.key)
    setActivePairKey(group.pairs[0] ? pairKey(group.pairs[0]) : null)
    setDecisionError(null)
    setNotice(null)
    setCompareOpen(true)
  }

  function closeCompare() {
    if (decisionBusy) return
    setCompareOpen(false)
    setDecisionError(null)
    setConfirmDifferentOpen(false)
  }

  function openMerge() {
    if (!activePair) return
    setPrimaryId(activePair.pupilIds[0])
    setMergeNote('')
    setMergeError(null)
    setPreview(null)
    setCompareOpen(false)
    setMergeOpen(true)
  }

  function closeMerge() {
    if (mergeBusy) return
    setMergeOpen(false)
    setConfirmMergeOpen(false)
    setPreview(null)
    setPreviewError(null)
    setMergeError(null)
  }

  async function markDifferent() {
    if (!schoolId || !activePair) return

    setDecisionBusy(true)
    setDecisionError(null)

    try {
      await recordPupilDuplicateDecision(schoolId, {
        primaryPupilId: activePair.pupilIds[0],
        duplicatePupilId: activePair.pupilIds[1],
        decision: 'DIFFERENT',
        note: 'Confirmed as different pupils from the duplicate management screen.',
      })
      setConfirmDifferentOpen(false)
      setCompareOpen(false)
      setNotice(
        'Marked as different pupils. This pair will not be treated as a duplicate again.',
      )
      await load()
    } catch (cause) {
      setDecisionError(apiErrorMessage(cause))
    } finally {
      setDecisionBusy(false)
    }
  }

  async function startMerge() {
    if (!schoolId || !activePair) return

    setDecisionBusy(true)
    setDecisionError(null)

    try {
      const sameAdmission =
        activePair.admissionNumbers[0] === activePair.admissionNumbers[1]

      // A definite duplicate already shares the admission number, so there is
      // no pair decision to record before merging. Same-name records with
      // different admissions record the SAME decision first.
      if (!sameAdmission && activePair.decision !== 'SAME') {
        await recordPupilDuplicateDecision(schoolId, {
          primaryPupilId: activePair.pupilIds[0],
          duplicatePupilId: activePair.pupilIds[1],
          decision: 'SAME',
          note: 'Confirmed as the same pupil from the duplicate management screen.',
        })
      }

      openMerge()
      await load()
    } catch (cause) {
      setDecisionError(apiErrorMessage(cause))
    } finally {
      setDecisionBusy(false)
    }
  }

  async function performMerge() {
    if (!schoolId || !primaryId || !duplicateId) return

    setMergeBusy(true)
    setMergeError(null)

    try {
      const result = await mergePupils(schoolId, {
        primaryPupilId: primaryId,
        duplicatePupilId: duplicateId,
        confirm: true,
        note: mergeNote.trim() || null,
      })

      setConfirmMergeOpen(false)
      setMergeOpen(false)
      setCompareOpen(false)
      setActiveGroupKey(null)
      setActivePairKey(null)
      setPreview(null)
      setNotice(
        `Merged the records. Kept ${result.primaryPupil.firstName} ${result.primaryPupil.lastName} (${result.primaryPupil.admissionNumber}); the other record was archived and its history retained.`,
      )
      await load()
    } catch (cause) {
      setMergeError(apiErrorMessage(cause))
    } finally {
      setMergeBusy(false)
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAppliedQuery(searchInput.trim())
  }

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can review and resolve pupil duplicates." />
    )
  }

  const summary = audit?.summary

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pupil duplicates"
        description="Audit every pupil record in this school, including inactive and archived pupils. Only a school administrator can mark records as different or merge them."
        actions={
          <Button
            variant="secondary"
            onClick={() => void load()}
            loading={loading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh audit
          </Button>
        }
      />

      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-[#137026]"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{notice}</p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Definite duplicates"
          value={summary?.definiteRecords ?? 0}
          hint="Records sharing the exact name and admission number."
          icon={ShieldAlert}
          tone="warning"
        />
        <SummaryCard
          label="Possible duplicates"
          value={summary?.possibleGroups ?? 0}
          hint="Same-name groups with a different admission number."
          icon={Users}
          tone="info"
        />
        <SummaryCard
          label="Admission conflicts"
          value={summary?.admissionConflictGroups ?? 0}
          hint="One admission number used by different names."
          icon={AlertTriangle}
          tone="warning"
        />
        <SummaryCard
          label="Awaiting review"
          value={summary?.awaitingGroups ?? 0}
          hint={`${summary?.resolvedGroups ?? 0} group(s) already resolved.`}
          icon={GitMerge}
          tone="neutral"
        />
      </div>

      <Panel>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <form
            onSubmit={applySearch}
            className="flex w-full flex-col gap-2 sm:flex-row sm:items-end"
          >
            <label className="flex-1">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                Search
              </span>
              <span className="relative block">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gradely-muted"
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Name or admission number"
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-gradely-text shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/20"
                />
              </span>
            </label>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          <div className="w-full lg:w-64">
            <SelectField
              label="Category"
              value={category}
              onChange={(event) =>
                setCategory(
                  event.target.value as '' | PupilDuplicateCategory,
                )
              }
            >
              <option value="">All categories</option>
              <option value="DEFINITE">Definite duplicates</option>
              <option value="NAME_CONFLICT">Possible duplicates</option>
              <option value="ADMISSION_CONFLICT">Admission conflicts</option>
            </SelectField>
          </div>
        </div>
      </Panel>

      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}

      {loading && !audit ? (
        <LoadingPanel label="Auditing pupil records…" />
      ) : null}

      {audit && audit.groups.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No pupil duplicates found"
          description="Every pupil record in this school has a unique complete name and admission number for the selected filter."
        />
      ) : null}

      <div className="space-y-4">
        {audit?.groups.map((group) => {
          const meta = CATEGORY_META[group.category]
          const name = group.pupils[0]
            ? pupilDisplayName(group.pupils[0])
            : group.nameKey

          return (
            <Panel key={group.key}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-gradely-text">
                      {name}
                    </h2>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {group.category === 'NAME_CONFLICT' ? (
                      <Badge tone={group.resolved ? 'success' : 'neutral'}>
                        {group.resolved ? 'Resolved' : 'Awaiting review'}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-gradely-muted">
                    Admission{' '}
                    <span className="font-medium text-gradely-text">
                      {group.admissionNumbers.join(', ')}
                    </span>{' '}
                    · {group.pupils.length} record(s)
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => openCompare(group)}
                >
                  <ArrowLeftRight aria-hidden="true" className="size-4" />
                  Review records
                </Button>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-gradely-muted">
                {meta.description}
              </p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {group.pupils.map((pupil) => (
                  <PupilIdentityCard key={pupil.id} pupil={pupil} />
                ))}
              </div>

              <p className="mt-3 text-xs leading-relaxed text-gradely-muted">
                <span className="font-semibold">Suggested resolution:</span>{' '}
                {group.suggestedResolution}
              </p>
            </Panel>
          )
        })}
      </div>

      <Modal
        open={compareOpen}
        title="Compare pupil records"
        description="Review the complete name, admission number, class and status before deciding."
        onClose={closeCompare}
        wide
      >
        {activeGroup ? (
          <div className="space-y-4">
            {activeGroup.pairs.length > 1 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                  Choose a pair to review
                </p>
                <div className="flex flex-wrap gap-2">
                  {activeGroup.pairs.map((pair) => {
                    const key = pairKey(pair)
                    const selected = key === activePairKey

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActivePairKey(key)}
                        className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
                          selected
                            ? 'border-gradely-blue bg-gradely-blue/10 text-gradely-navy'
                            : 'border-slate-200 bg-white text-gradely-text hover:bg-gradely-light'
                        }`}
                      >
                        {pair.admissionNumbers.join(' ↔ ')}
                        <span className="mt-1 block text-[11px] font-normal text-gradely-muted">
                          {decisionLabel(pair)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {pairPupils ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <PupilIdentityCard pupil={pairPupils.left} />
                <PupilIdentityCard pupil={pairPupils.right} />
              </div>
            ) : (
              <div className="rounded-xl border border-gradely-gold/30 bg-gradely-gold/10 p-4 text-sm text-[#7a5400]">
                These records share the same admission number. Correct the
                admission number on one record in the pupil register before
                reviewing them as a possible duplicate.
              </div>
            )}

            {activePair ? (
              <div className="rounded-xl border border-slate-200 bg-gradely-light/60 p-4 text-sm">
                <p className="font-semibold text-gradely-text">
                  {decisionLabel(activePair)}
                </p>
                {activePair.decidedAt ? (
                  <p className="mt-1 text-xs text-gradely-muted">
                    Recorded {formatDateTime(activePair.decidedAt)}
                  </p>
                ) : null}
                {activePair.note ? (
                  <p className="mt-1 text-xs text-gradely-muted">
                    Note: {activePair.note}
                  </p>
                ) : null}
              </div>
            ) : null}

            {decisionError ? <ErrorNotice message={decisionError} /> : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <Button
                variant="secondary"
                onClick={closeCompare}
                disabled={decisionBusy}
              >
                Close
              </Button>
              {activePair ? (
                <>
                  {activePair.admissionNumbers[0] !==
                  activePair.admissionNumbers[1] ? (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmDifferentOpen(true)}
                      disabled={
                        decisionBusy || activePair.decision === 'DIFFERENT'
                      }
                    >
                      These are different pupils
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void startMerge()}
                    loading={decisionBusy}
                    disabled={activePair.decision === 'MERGED'}
                  >
                    <GitMerge aria-hidden="true" className="size-4" />
                    These are the same pupil — merge
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={mergeOpen}
        title="Merge duplicate pupils"
        description="Choose the record to keep. Safe history is transferred to it, then the other record is archived. Nothing is permanently deleted."
        onClose={closeMerge}
        wide
      >
        {pairPupils ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[pairPupils.left, pairPupils.right].map((pupil) => {
                const selected = pupil.id === primaryId

                return (
                  <label
                    key={pupil.id}
                    className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                      selected
                        ? 'border-gradely-blue bg-gradely-blue/5 ring-2 ring-gradely-blue/20'
                        : 'border-slate-200 bg-white hover:bg-gradely-light'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                      <input
                        type="radio"
                        name="primary-pupil"
                        checked={selected}
                        onChange={() => setPrimaryId(pupil.id)}
                      />
                      {selected ? 'Keep this record' : 'Archive this record'}
                    </span>
                    <span className="mt-3 block">
                      <PupilIdentityCard pupil={pupil} emphasis={selected} />
                    </span>
                  </label>
                )
              })}
            </div>

            {previewLoading ? (
              <LoadingPanel label="Checking dependent records…" />
            ) : null}

            {previewError ? (
              <ErrorNotice
                message={previewError}
                onRetry={() => setPreviewRefresh((value) => value + 1)}
              />
            ) : null}

            {preview ? (
              <div className="space-y-3">
                <Panel>
                  <h3 className="text-sm font-bold text-gradely-text">
                    Records that will move to the retained pupil
                  </h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    {(
                      [
                        ['Enrollments', preview.transferable.enrollments],
                        ['Subject scores', preview.transferable.subjectScores],
                        [
                          'Assessment scores',
                          preview.transferable.assessmentScores,
                        ],
                        ['Report inputs', preview.transferable.reportInputs],
                        ['Report cards', preview.transferable.reportCards],
                        ['Invoice pupils', preview.transferable.invoicePupils],
                      ] as Array<[string, number]>
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg bg-gradely-light/70 px-3 py-2"
                      >
                        <dt className="text-xs text-gradely-muted">{label}</dt>
                        <dd className="text-lg font-bold text-gradely-navy">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Panel>

                {preview.conflicts.length > 0 ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <h3 className="flex items-center gap-2 font-bold">
                      <AlertTriangle aria-hidden="true" className="size-4" />
                      Manual review required
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {preview.conflicts.map((conflict) => (
                        <li key={`${conflict.area}:${conflict.key}`}>
                          {conflict.message}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2">
                      Resolve these conflicts in the relevant term, report or
                      invoice before merging. The merge is blocked until then.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-[#137026]">
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    No dependent-record conflicts were found. The merge can
                    continue safely.
                  </div>
                )}

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gradely-muted">
                    Merge note (optional)
                  </span>
                  <textarea
                    value={mergeNote}
                    onChange={(event) => setMergeNote(event.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-gradely-text shadow-sm focus:border-gradely-blue focus:outline-none focus:ring-2 focus:ring-gradely-blue/20"
                    placeholder="Why are these records the same pupil?"
                  />
                </label>
              </div>
            ) : null}

            {mergeError ? <ErrorNotice message={mergeError} /> : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              <Button
                variant="secondary"
                onClick={closeMerge}
                disabled={mergeBusy}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => setConfirmMergeOpen(true)}
                disabled={!preview?.canMerge || mergeBusy}
              >
                <GitMerge aria-hidden="true" className="size-4" />
                Merge and archive duplicate
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmDifferentOpen}
        title="Mark as different pupils"
        description="These records will be treated as two different pupils. The confirmation is saved so this pair is not treated as a duplicate again."
        confirmLabel="Mark as different"
        busy={decisionBusy}
        onConfirm={() => void markDifferent()}
        onCancel={() => setConfirmDifferentOpen(false)}
      />

      <ConfirmDialog
        open={confirmMergeOpen}
        title="Confirm merge"
        description={
          preview
            ? `Keep ${preview.primaryPupil.firstName} ${preview.primaryPupil.lastName} (${preview.primaryPupil.admissionNumber}) and archive ${preview.duplicatePupil.firstName} ${preview.duplicatePupil.lastName} (${preview.duplicatePupil.admissionNumber}). Safe history moves to the retained pupil; conflicting rows stay on the archived record for manual review. This action is recorded in the audit trail.`
            : 'Confirm this merge.'
        }
        confirmLabel="Merge records"
        danger
        busy={mergeBusy}
        onConfirm={() => void performMerge()}
        onCancel={() => setConfirmMergeOpen(false)}
      />
    </div>
  )
}
