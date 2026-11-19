import {
  ImageUp,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import AutoSaveIndicator from '../../components/AutoSaveIndicator'
import FormField from '../../components/FormField'
import {
  AccessDenied,
  Badge,
  Button,
  ErrorNotice,
  LoadingPanel,
  PageHeader,
  Panel,
  SelectField,
} from '../../components/ui'
import {
  getReportSettings,
  listReportAssets,
  updateReportSettings,
  uploadReportAsset,
} from '../../reports/api'
import { DraftNotice } from '../../reports/components'
import { formatBytes, readFileAsBase64 } from '../../reports/files'
import {
  AGGREGATE_POLICY_LABELS,
  TIE_POLICY_LABELS,
} from '../../reports/labels'
import type {
  ReportAsset,
  ReportAssetKind,
  ReportSettings,
  ReportSettingsInput,
} from '../../reports/types'
import { useAcademicTerms } from '../../reports/use-academic-terms'
import { useAutoSave } from '../../lib/use-auto-save'
import { useSchool } from '../../schools/use-school'

interface SettingsFormState {
  headteacherLabel: string
  rankingEnabled: boolean
  tiePolicy: ReportSettingsInput['tiePolicy']
  aggregatePolicy: ReportSettingsInput['aggregatePolicy']
  attendanceRequired: boolean
  closingDate: string
  reopeningDate: string
  emblemAssetId: string
  crestAssetId: string
  signatureAssetId: string
}

const EMPTY_FORM: SettingsFormState = {
  headteacherLabel: "HEADMASTER'S SIGNATURE",
  rankingEnabled: true,
  tiePolicy: 'COMPETITION',
  aggregatePolicy: 'SUM_ALL_SUBJECTS',
  attendanceRequired: false,
  closingDate: '',
  reopeningDate: '',
  emblemAssetId: '',
  crestAssetId: '',
  signatureAssetId: '',
}

function formFromSettings(settings: ReportSettings | null): SettingsFormState {
  if (!settings) return { ...EMPTY_FORM }

  return {
    headteacherLabel: settings.headteacherLabel,
    rankingEnabled: settings.rankingEnabled,
    tiePolicy: settings.tiePolicy,
    aggregatePolicy: settings.aggregatePolicy,
    attendanceRequired: settings.attendanceRequired,
    closingDate: settings.closingDate?.slice(0, 10) ?? '',
    reopeningDate: settings.reopeningDate?.slice(0, 10) ?? '',
    emblemAssetId: settings.emblemAssetId ?? '',
    crestAssetId: settings.crestAssetId ?? '',
    signatureAssetId: settings.signatureAssetId ?? '',
  }
}

const ASSET_LABELS: Record<ReportAssetKind, string> = {
  EMBLEM: 'Left emblem',
  CREST: 'Centre crest',
  SIGNATURE: 'Headteacher signature',
}

export default function ReportSettingsPage() {
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

  const [settings, setSettings] = useState<ReportSettings | null>(null)
  const [form, setForm] = useState<SettingsFormState>({ ...EMPTY_FORM })
  const [assets, setAssets] = useState<ReportAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState<ReportAssetKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const loadAssets = useCallback(async () => {
    if (!schoolId || !isAdmin) return

    try {
      const response = await listReportAssets(schoolId)
      setAssets(response.assets)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load report branding assets.',
      )
    }
  }, [isAdmin, schoolId])

  const loadSettings = useCallback(async () => {
    if (!schoolId || !selected || !isAdmin) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const response = await getReportSettings(schoolId, selected.termId)
      setSettings(response.settings)
      setForm(formFromSettings(response.settings))
      setError(null)
      setSuccess(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load report settings.',
      )
    } finally {
      setLoading(false)
    }
  }, [isAdmin, schoolId, selected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAssets()
  }, [loadAssets])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings()
  }, [loadSettings])

  const settingsInput = useMemo<ReportSettingsInput | null>(() => {
    if (!selected) return null

    return {
      academicYearId: selected.yearId,
      academicTermId: selected.termId,
      headteacherLabel: form.headteacherLabel.trim(),
      rankingEnabled: form.rankingEnabled,
      tiePolicy: form.tiePolicy,
      aggregatePolicy: form.aggregatePolicy,
      attendanceRequired: form.attendanceRequired,
      closingDate: form.closingDate || null,
      reopeningDate: form.reopeningDate || null,
      emblemAssetId: form.emblemAssetId || null,
      crestAssetId: form.crestAssetId || null,
      signatureAssetId: form.signatureAssetId || null,
    }
  }, [form, selected])

  const autoSave = useAutoSave<ReportSettingsInput | null>({
    value: settingsInput,
    enabled:
      Boolean(schoolId && selected && isAdmin) && !loading && !termsLoading,
    canSave: settingsInput !== null,
    save: async (input) => {
      if (!schoolId || !input) return

      const response = await updateReportSettings(schoolId, input)
      setSettings(response.settings)
    },
  })

  if (!isAdmin) {
    return (
      <AccessDenied message="Only a school administrator can configure report cards, branding and signature settings." />
    )
  }

  function patchForm(patch: Partial<SettingsFormState>) {
    setForm((current) => ({ ...current, ...patch }))
    setSuccess(null)
  }

  async function handleUpload(
    kind: ReportAssetKind,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !schoolId) return

    if (file.size > 512 * 1024) {
      setError('Branding images must be 512 KB or smaller.')
      return
    }

    try {
      setUploading(kind)
      setError(null)
      const base64 = await readFileAsBase64(file)
      const response = await uploadReportAsset(schoolId, {
        kind,
        mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        originalName: file.name,
        base64,
      })
      const key =
        kind === 'EMBLEM'
          ? 'emblemAssetId'
          : kind === 'CREST'
            ? 'crestAssetId'
            : 'signatureAssetId'
      patchForm({ [key]: response.asset.id })
      await loadAssets()
      setSuccess(
        `${ASSET_LABELS[kind]} uploaded. It is attached and saved automatically.`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not upload the selected image.',
      )
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report settings"
        description="Configure the school header images, signature label, ranking policy, aggregate rule, attendance requirement and term dates used by generated report cards."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadAssets()
              void loadSettings()
              void reloadTerms()
            }}
            loading={loading || termsLoading}
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <DraftNotice description="These settings affect future generated report cards. Existing saved versions keep the settings and snapshots they were generated with." />

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Academic term"
            value={selectedTermId}
            onChange={(event) => setSelectedTermId(event.target.value)}
            disabled={termsLoading || options.length === 0}
            hint="Settings are stored per academic term."
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
          <div className="flex items-end">
            <div className="rounded-xl border border-slate-200 bg-gradely-light px-4 py-3 text-xs text-gradely-muted">
              {settings ? (
                <span>
                  Last saved{' '}
                  {new Date(settings.updatedAt).toLocaleString('en-GB')}
                </span>
              ) : (
                <span>No saved settings for this term yet.</span>
              )}
            </div>
          </div>
        </div>
      </Panel>

      {termsError ? (
        <ErrorNotice message={termsError} onRetry={() => void reloadTerms()} />
      ) : null}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void loadSettings()} />
      ) : null}
      {success ? (
        <div
          role="status"
          className="rounded-2xl border border-gradely-green/30 bg-gradely-green/10 p-4 text-sm font-semibold text-[#137026]"
        >
          {success}
        </div>
      ) : null}

      {loading || termsLoading ? (
        <LoadingPanel label="Loading report settings…" />
      ) : !selected ? (
        <Panel>
          <p className="text-sm text-gradely-muted">
            Create an academic year and term before configuring report cards.
          </p>
        </Panel>
      ) : (
        <>
          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-gradely-text">
                  School branding
                </h2>
                <p className="mt-1 text-sm text-gradely-muted">
                  PNG or JPEG images up to 512 KB. Missing images leave a
                  reserved neutral space on the report; Wise Grade never
                  substitutes its own logo.
                </p>
              </div>
              <Badge tone="info">
                <ShieldCheck aria-hidden="true" className="mr-1 size-3.5" />
                Private storage
              </Badge>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-3">
              {(
                [
                  ['EMBLEM', 'emblemAssetId'],
                  ['CREST', 'crestAssetId'],
                  ['SIGNATURE', 'signatureAssetId'],
                ] as const
              ).map(([kind, key]) => {
                const kindAssets = assets.filter((asset) => asset.kind === kind)
                const selectedAsset = kindAssets.find(
                  (asset) => asset.id === form[key],
                )

                return (
                  <div
                    key={kind}
                    className="rounded-2xl border border-slate-200 bg-gradely-light/60 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-gradely-text">
                        {ASSET_LABELS[kind]}
                      </p>
                      <ImageUp
                        aria-hidden="true"
                        className="size-4 text-gradely-muted"
                      />
                    </div>
                    <SelectField
                      label="Attached image"
                      value={form[key]}
                      onChange={(event) => patchForm({ [key]: event.target.value })}
                      className="mt-3"
                    >
                      <option value="">No image (reserve blank space)</option>
                      {kindAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.originalName} ({formatBytes(asset.byteSize)})
                        </option>
                      ))}
                    </SelectField>
                    <p className="mt-2 min-h-8 text-xs text-gradely-muted">
                      {selectedAsset
                        ? `${selectedAsset.mimeType} • ${formatBytes(selectedAsset.byteSize)}`
                        : 'No image selected for this position.'}
                    </p>
                    <input
                      ref={(element) => {
                        fileInputs.current[kind] = element
                      }}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      onChange={(event) => void handleUpload(kind, event)}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2 w-full"
                      loading={uploading === kind}
                      onClick={() => fileInputs.current[kind]?.click()}
                    >
                      <Upload aria-hidden="true" className="size-4" />
                      Upload {kind.toLowerCase()}
                    </Button>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel>
            <h2 className="text-base font-bold text-gradely-text">
              Report rules and signature
            </h2>
            <p className="mt-1 text-sm text-gradely-muted">
              Ranking and aggregate rules are evaluated from accepted results
              and stored in each report version. Changing a rule never rewrites
              an existing version.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <FormField
                label="Signature label"
                value={form.headteacherLabel}
                onChange={(event) =>
                  patchForm({ headteacherLabel: event.target.value })
                }
                onBlur={() => void autoSave.flush()}
                maxLength={80}
                hint="Defaults to HEADMASTER'S SIGNATURE."
              />
              <SelectField
                label="Tie policy"
                value={form.tiePolicy}
                onChange={(event) =>
                  patchForm({
                    tiePolicy: event.target
                      .value as SettingsFormState['tiePolicy'],
                  })
                }
                hint="Applied deterministically when scores are equal."
              >
                {Object.entries(TIE_POLICY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Aggregate policy"
                value={form.aggregatePolicy}
                onChange={(event) =>
                  patchForm({
                    aggregatePolicy: event.target
                      .value as SettingsFormState['aggregatePolicy'],
                  })
                }
                hint="The AGGREGATE summary cell shows N/A when disabled."
              >
                {Object.entries(AGGREGATE_POLICY_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </SelectField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Closing date"
                  type="date"
                  value={form.closingDate}
                  onChange={(event) =>
                    patchForm({ closingDate: event.target.value })
                  }
                  onBlur={() => void autoSave.flush()}
                />
                <FormField
                  label="Reopening date"
                  type="date"
                  value={form.reopeningDate}
                  onChange={(event) =>
                    patchForm({ reopeningDate: event.target.value })
                  }
                  onBlur={() => void autoSave.flush()}
                />
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-gradely-light/60 p-4">
                <input
                  type="checkbox"
                  checked={form.rankingEnabled}
                  onChange={(event) =>
                    patchForm({ rankingEnabled: event.target.checked })
                  }
                  className="mt-0.5 size-4 rounded border-slate-300 text-gradely-navy"
                />
                <span>
                  <span className="block text-sm font-semibold text-gradely-text">
                    Enable class and subject ranking
                  </span>
                  <span className="mt-0.5 block text-xs text-gradely-muted">
                    When disabled, positions print as N/A.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-gradely-light/60 p-4">
                <input
                  type="checkbox"
                  checked={form.attendanceRequired}
                  onChange={(event) =>
                    patchForm({ attendanceRequired: event.target.checked })
                  }
                  className="mt-0.5 size-4 rounded border-slate-300 text-gradely-navy"
                />
                <span>
                  <span className="block text-sm font-semibold text-gradely-text">
                    Require attendance before generation
                  </span>
                  <span className="mt-0.5 block text-xs text-gradely-muted">
                    Reports without verified attendance will be skipped.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
              <p className="text-xs text-gradely-muted">
                Changes save automatically as you edit. Saving settings does not
                generate or release any report card.
              </p>
              <AutoSaveIndicator
                {...autoSave}
                onRetry={() => void autoSave.retry()}
              />
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
