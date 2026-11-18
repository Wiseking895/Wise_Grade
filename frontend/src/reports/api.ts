import {
  API_BASE_URL,
  API_CONFIGURATION_ERROR,
  ApiError,
  apiRequest,
} from '../lib/api'
import type {
  GenerateReportsInput,
  GenerateReportsResult,
  PlatformReportBatchFilter,
  PlatformReportSchoolScope,
  ReportAsset,
  ReportAssetKind,
  ReportBatch,
  ReportBatchDetail,
  ReportCard,
  ReportCardDetail,
  ReportClass,
  ReportEligibilityResult,
  ReportInput,
  ReportInputUpsert,
  ReportReleaseBatchDetail,
  ReportReleaseBatchSummary,
  ReportReleaseOverview,
  ReportReleaseStatus,
  ReportRequestActionResult,
  ReportRequestClassSummary,
  ReportRequestDetail,
  ReportRequestResult,
  ReportSettings,
  ReportSettingsInput,
} from './types'

function reportPath(schoolId: string, suffix = ''): string {
  return `/api/schools/${schoolId}/reports${suffix}`
}

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
  }

  return params.size > 0 ? `?${params.toString()}` : ''
}

async function fetchPrivateBlob(
  path: string,
  accept: string,
): Promise<Blob> {
  if (API_CONFIGURATION_ERROR) {
    throw new ApiError(0, API_CONFIGURATION_ERROR)
  }

  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      headers: { Accept: accept },
    })
  } catch {
    throw new ApiError(
      0,
      'Could not reach the Wise Grade API. Check that the backend is running.',
    )
  }

  if (!response.ok) {
    const isJson = response.headers
      .get('content-type')
      ?.includes('application/json')
    const payload = isJson
      ? ((await response.json()) as {
          error?: { message?: string; details?: [] }
        })
      : null

    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed (${response.status})`,
      payload?.error?.details ?? [],
    )
  }

  return response.blob()
}

export function getReportSettings(
  schoolId: string,
  academicTermId: string,
) {
  return apiRequest<{ settings: ReportSettings | null }>(
    reportPath(schoolId, `/settings${queryString({ academicTermId })}`),
  )
}

export function updateReportSettings(
  schoolId: string,
  input: ReportSettingsInput,
) {
  return apiRequest<{ settings: ReportSettings }>(
    reportPath(schoolId, '/settings'),
    { method: 'PUT', body: input },
  )
}

export function listReportAssets(schoolId: string) {
  return apiRequest<{ assets: ReportAsset[] }>(
    reportPath(schoolId, '/assets'),
  )
}

export function uploadReportAsset(
  schoolId: string,
  input: {
    kind: ReportAssetKind
    mimeType: string
    originalName: string
    base64: string
  },
) {
  return apiRequest<{ asset: ReportAsset }>(reportPath(schoolId, '/assets'), {
    method: 'POST',
    body: input,
  })
}

export function fetchReportAsset(schoolId: string, assetId: string) {
  return fetchPrivateBlob(
    reportPath(schoolId, `/assets/${assetId}/file`),
    'image/*',
  )
}

export function listReportClasses(
  schoolId: string,
  academicYearId: string,
  academicTermId: string,
) {
  return apiRequest<{ classes: ReportClass[] }>(
    reportPath(
      schoolId,
      `/classes${queryString({ academicYearId, academicTermId })}`,
    ),
  )
}

export function listReportInputs(
  schoolId: string,
  query: { academicTermId: string; classId: string },
) {
  return apiRequest<{ inputs: ReportInput[] }>(
    reportPath(schoolId, `/inputs${queryString(query)}`),
  )
}

export function upsertReportInput(
  schoolId: string,
  input: ReportInputUpsert,
) {
  return apiRequest<{ input: ReportInput }>(reportPath(schoolId, '/inputs'), {
    method: 'PUT',
    body: input,
  })
}

export function getReportEligibility(
  schoolId: string,
  query: {
    academicYearId: string
    academicTermId: string
    classId: string
  },
) {
  return apiRequest<{ eligibility: ReportEligibilityResult }>(
    reportPath(schoolId, `/eligibility${queryString(query)}`),
  )
}

export function generateReports(
  schoolId: string,
  input: GenerateReportsInput,
) {
  return apiRequest<GenerateReportsResult>(
    reportPath(schoolId, '/generate'),
    { method: 'POST', body: input },
  )
}

export function listReportBatches(
  schoolId: string,
  academicTermId?: string,
) {
  return apiRequest<{ batches: ReportBatch[] }>(
    reportPath(schoolId, `/batches${queryString({ academicTermId })}`),
  )
}

export function getReportBatch(schoolId: string, batchId: string) {
  return apiRequest<{ batch: ReportBatchDetail }>(
    reportPath(schoolId, `/batches/${batchId}`),
  )
}

export function retryReportBatch(schoolId: string, batchId: string) {
  return apiRequest<{ batches: GenerateReportsResult[] }>(
    reportPath(schoolId, `/batches/${batchId}/retry`),
    { method: 'POST', body: {} },
  )
}

export function listReportCards(
  schoolId: string,
  query: { academicTermId: string; classId?: string; releasedOnly?: boolean },
) {
  return apiRequest<{ cards: ReportCard[] }>(
    reportPath(
      schoolId,
      `/cards${queryString({
        academicTermId: query.academicTermId,
        classId: query.classId,
        releasedOnly: query.releasedOnly ? 'true' : undefined,
      })}`,
    ),
  )
}

export function getReportCard(schoolId: string, reportCardId: string) {
  return apiRequest<ReportCardDetail>(
    reportPath(schoolId, `/cards/${reportCardId}`),
  )
}

export function fetchReportPreview(
  schoolId: string,
  reportCardId: string,
  version?: number,
) {
  return fetchPrivateBlob(
    reportPath(
      schoolId,
      `/cards/${reportCardId}/preview${queryString({
        version: version === undefined ? undefined : String(version),
      })}`,
    ),
    'application/pdf',
  )
}

export function fetchStoredReportPdf(
  schoolId: string,
  reportCardId: string,
  version: number,
) {
  return fetchPrivateBlob(
    reportPath(schoolId, `/cards/${reportCardId}/versions/${version}/pdf`),
    'application/pdf',
  )
}

export function fetchClassCollection(
  schoolId: string,
  classId: string,
  academicTermId: string,
) {
  return fetchPrivateBlob(
    reportPath(
      schoolId,
      `/classes/${classId}/collection${queryString({ academicTermId })}`,
    ),
    'application/pdf',
  )
}

// ---------------------------------------------------------------------------
// School report-generation requests
// ---------------------------------------------------------------------------

export function submitReportRequest(
  schoolId: string,
  input: { academicYearId: string; academicTermId: string },
) {
  return apiRequest<ReportRequestResult>(
    reportPath(schoolId, '/requests'),
    { method: 'POST', body: input },
  )
}

export function listReportRequests(
  schoolId: string,
  academicTermId?: string,
) {
  return apiRequest<{ requests: ReportReleaseBatchSummary[] }>(
    reportPath(schoolId, `/requests${queryString({ academicTermId })}`),
  )
}

export function getReportRequest(schoolId: string, batchId: string) {
  return apiRequest<{
    batch: ReportBatchDetail
    classes: ReportRequestClassSummary[]
  }>(reportPath(schoolId, `/requests/${batchId}`))
}

// ---------------------------------------------------------------------------
// School release submission
// ---------------------------------------------------------------------------

export function listReleaseBatches(
  schoolId: string,
  academicTermId?: string,
) {
  return apiRequest<{ batches: ReportReleaseBatchSummary[] }>(
    reportPath(
      schoolId,
      `/release/batches${queryString({ academicTermId })}`,
    ),
  )
}

export function getReleaseBatch(schoolId: string, batchId: string) {
  return apiRequest<{ batch: ReportReleaseBatchDetail }>(
    reportPath(schoolId, `/release/batches/${batchId}`),
  )
}

export function submitReleaseBatch(schoolId: string, batchId: string) {
  return apiRequest<{ batch: ReportReleaseBatchDetail }>(
    reportPath(schoolId, `/release/batches/${batchId}/submit`),
    { method: 'POST', body: {} },
  )
}

// ---------------------------------------------------------------------------
// Platform report review and controlled release
// ---------------------------------------------------------------------------

export function getPlatformReportOverview() {
  return apiRequest<{ overview: ReportReleaseOverview }>(
    '/api/platform/reports/overview',
  )
}

export function listPlatformReportSchools() {
  return apiRequest<{ schools: PlatformReportSchoolScope[] }>(
    '/api/platform/reports/schools',
  )
}

export function listPlatformReportClasses(
  schoolId: string,
  query: { academicYearId: string; academicTermId: string },
) {
  return apiRequest<{ classes: ReportClass[] }>(
    `/api/platform/reports/schools/${schoolId}/report-classes${queryString({
      academicYearId: query.academicYearId,
      academicTermId: query.academicTermId,
    })}`,
  )
}

export function getPlatformReportEligibility(
  schoolId: string,
  query: { academicYearId: string; academicTermId: string; classId: string },
) {
  return apiRequest<{ eligibility: ReportEligibilityResult }>(
    `/api/platform/reports/schools/${schoolId}/report-eligibility${queryString({
      academicYearId: query.academicYearId,
      academicTermId: query.academicTermId,
      classId: query.classId,
    })}`,
  )
}

export function generatePlatformReports(
  schoolId: string,
  input: GenerateReportsInput,
) {
  return apiRequest<GenerateReportsResult>(
    `/api/platform/reports/schools/${schoolId}/reports/generate`,
    { method: 'POST', body: input },
  )
}

export function queuePlatformReportBatch(batchId: string) {
  return apiRequest<{ batch: ReportReleaseBatchDetail }>(
    `/api/platform/reports/batches/${batchId}/queue`,
    { method: 'POST', body: {} },
  )
}

export function listPlatformReportBatches(filter: PlatformReportBatchFilter) {
  return apiRequest<{ batches: ReportReleaseBatchSummary[] }>(
    `/api/platform/reports/batches${queryString({
      schoolId: filter.schoolId,
      academicYearId: filter.academicYearId,
      academicTermId: filter.academicTermId,
      status: filter.status,
      submittedFrom: filter.submittedFrom,
      submittedTo: filter.submittedTo,
    })}`,
  )
}

export function getPlatformReportBatch(batchId: string) {
  return apiRequest<{ batch: ReportRequestDetail }>(
    `/api/platform/reports/batches/${batchId}`,
  )
}

export function fetchPlatformReportPreview(
  batchId: string,
  versionId: string,
) {
  return fetchPrivateBlob(
    `/api/platform/reports/batches/${batchId}/versions/${versionId}/preview`,
    'application/pdf',
  )
}

/**
 * The developer's single operational action for an admin-accepted request.
 * Academic acceptance has already happened in the school workspace, so this
 * action only generates reports. Payment is never part of this call.
 */
export function generatePlatformReportBatch(
  batchId: string,
  reauthToken?: string,
) {
  return apiRequest<ReportRequestActionResult>(
    `/api/platform/reports/batches/${batchId}/generate`,
    {
      method: 'POST',
      body: {},
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

/**
 * Retries only pupils whose first generation attempt failed. Successful report
 * versions are never regenerated or duplicated.
 */
export function retryPlatformReportBatch(
  batchId: string,
  reauthToken?: string,
) {
  return apiRequest<ReportRequestActionResult>(
    `/api/platform/reports/batches/${batchId}/retry`,
    {
      method: 'POST',
      body: {},
      headers: reauthToken ? { 'X-Platform-Reauth': reauthToken } : undefined,
    },
  )
}

export const PLATFORM_REPORT_STATUS_FILTERS: ReportReleaseStatus[] = [
  'GENERATED',
  'PENDING_PLATFORM_REVIEW',
  'RETURNED',
  'APPROVED',
  'RELEASED',
  'ON_HOLD',
]
