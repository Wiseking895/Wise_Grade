import {
  request as playwrightRequest,
  expect,
  test,
  type APIRequestContext,
} from '@playwright/test'
import { ACCOUNTS, PASSWORD, SCHOOL_A } from './support'

const API = 'http://localhost:4100'
const APP_ORIGIN = 'http://localhost:5174'

interface SessionMembership {
  schoolId: string
  schoolName: string
  role: string
}

interface SessionPayload {
  user: {
    id: string
    email: string
    isPlatformAdmin: boolean
    [key: string]: unknown
  }
  memberships: SessionMembership[]
}

async function apiLogin(
  context: APIRequestContext,
  email: string,
  password = PASSWORD,
): Promise<{ status: number; body: SessionPayload | { error?: unknown } }> {
  const response = await context.post(`${API}/api/auth/login`, {
    data: { email, password },
  })
  const payload = (await response.json()) as
    | { data: SessionPayload }
    | { error?: unknown }

  return {
    status: response.status(),
    body: 'data' in payload ? payload.data : payload,
  }
}

async function loginAs(
  context: APIRequestContext,
  email: string,
): Promise<SessionPayload> {
  const result = await apiLogin(context, email)
  expect(result.status).toBe(200)
  return result.body as SessionPayload
}

test.describe('Phase 6C · API security and tenant isolation', () => {
  test('anonymous requests are rejected on every protected surface', async ({
    request,
  }) => {
    const probes = [
      '/api/auth/me',
      '/api/schools/6f1e2d3c-0000-4000-8000-000000000000/pupils',
      '/api/schools/6f1e2d3c-0000-4000-8000-000000000000/billing/invoices',
      '/api/platform/billing/pricing-rules',
      '/api/platform/billing/invoices',
      '/api/platform/billing/payments/pending',
      '/api/platform/reports/batches',
      '/api/platform/reports/overview',
      '/api/schools/6f1e2d3c-0000-4000-8000-000000000000/reports/release/batches',
    ]

    for (const path of probes) {
      const response = await request.get(`${API}${path}`)
      expect(response.status(), `expected 401 for ${path}`).toBe(401)
    }
  })

  test('login response omits secrets and sets hardened cookies', async ({
    request,
  }) => {
    const response = await request.post(`${API}/api/auth/login`, {
      data: { email: ACCOUNTS.admin, password: PASSWORD },
    })

    expect(response.status()).toBe(200)
    const raw = await response.text()
    expect(raw).not.toMatch(/passwordHash|password_hash|salt/i)
    expect(raw).not.toMatch(/"token"\s*:/i)

    const cookies = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => header.value)

    expect(cookies.length).toBeGreaterThan(0)
    expect(cookies.join('\n')).toMatch(/HttpOnly/i)
    expect(cookies.join('\n')).toMatch(/SameSite/i)
  })

  test('cookie-authenticated writes require a trusted origin', async ({
    request,
  }) => {
    await loginAs(request, ACCOUNTS.admin)

    const crossSite = await request.post(`${API}/api/auth/logout`, {
      headers: { Origin: 'https://evil.example' },
    })
    expect(crossSite.status()).toBe(403)

    // The untrusted attempt must not have destroyed the session.
    const stillSignedIn = await request.get(`${API}/api/auth/me`)
    expect(stillSignedIn.status()).toBe(200)

    const trusted = await request.post(`${API}/api/auth/logout`, {
      headers: { Origin: APP_ORIGIN },
    })
    expect(trusted.status()).toBe(200)

    const afterLogout = await request.get(`${API}/api/auth/me`)
    expect(afterLogout.status()).toBe(401)
  })

  test('CORS only reflects the configured frontend origin', async ({
    request,
  }) => {
    const trusted = await request.get(`${API}/api/health`, {
      headers: { Origin: APP_ORIGIN },
    })
    expect(trusted.headers()['access-control-allow-origin']).toBe(APP_ORIGIN)

    const untrusted = await request.get(`${API}/api/health`, {
      headers: { Origin: 'https://evil.example' },
    })
    expect(untrusted.headers()['access-control-allow-origin']).toBeUndefined()
  })

  test('a school administrator cannot read another tenant through the API', async ({
    request,
  }) => {
    const sessionA = await loginAs(request, ACCOUNTS.admin)
    const schoolA = sessionA.memberships.find(
      (membership) => membership.schoolName === SCHOOL_A,
    )
    expect(schoolA).toBeTruthy()

    const other = await playwrightRequest.newContext()
    try {
      const sessionB = await loginAs(other, ACCOUNTS.otherAdmin)
      const schoolB = sessionB.memberships[0]
      expect(schoolB.schoolName).toBe('Phase 6C Other College')
      expect(schoolB.schoolId).not.toBe(schoolA?.schoolId)

      const probes = [
        `/api/schools/${schoolB.schoolId}/billing/invoices`,
        `/api/schools/${schoolB.schoolId}/billing/payments`,
        `/api/schools/${schoolB.schoolId}/reports/release/batches`,
        `/api/schools/${schoolB.schoolId}/reports/batches`,
        `/api/schools/${schoolB.schoolId}/pupils`,
      ]

      for (const path of probes) {
        const response = await request.get(`${API}${path}`, {
          headers: { Origin: APP_ORIGIN },
        })
        expect(
          [403, 404],
          `expected tenant isolation for ${path}, received ${response.status()}`,
        ).toContain(response.status())
      }

      // Own tenant remains accessible.
      const own = await request.get(
        `${API}/api/schools/${schoolA?.schoolId}/billing/invoices`,
      )
      expect(own.status()).toBe(200)
    } finally {
      await other.dispose()
    }
  })

  test('school roles cannot reach platform administration endpoints', async ({
    request,
  }) => {
    await loginAs(request, ACCOUNTS.admin)

    for (const path of [
      '/api/platform/billing/pricing-rules',
      '/api/platform/billing/invoices',
      '/api/platform/billing/payments/pending',
      '/api/platform/reports/batches',
      '/api/platform/reports/overview',
      '/api/platform/reports/schools',
    ]) {
      const response = await request.get(`${API}${path}`)
      expect(response.status(), `expected 403 for ${path}`).toBe(403)
    }
  })

  test('teachers cannot reach administrator-only school endpoints', async ({
    request,
  }) => {
    const session = await loginAs(request, ACCOUNTS.teacher)
    const schoolId = session.memberships[0].schoolId

    const probes = [
      `/api/schools/${schoolId}/billing/invoices`,
      `/api/schools/${schoolId}/billing/payments`,
      `/api/schools/${schoolId}/reports/release/batches`,
    ]

    for (const path of probes) {
      const response = await request.get(`${API}${path}`)
      expect(response.status(), `expected 403 for ${path}`).toBe(403)
    }
  })

  test('public registration cannot smuggle platform privileges', async ({
    request,
  }) => {
    const response = await request.post(`${API}/api/auth/register-school`, {
      data: {
        schoolName: 'Phase 6C Escalation Academy',
        firstName: 'Eve',
        lastName: 'Escalator',
        email: 'eve@phase6c.test',
        password: 'SuperSecret!2026',
        isPlatformAdmin: true,
        role: 'PLATFORM_SUPER_ADMIN',
      },
    })

    expect(response.status()).toBe(400)
    const raw = await response.text()
    expect(raw).not.toMatch(/isPlatformAdmin":true/)
  })

  test('malformed tenant identifiers fail as client errors, never 500', async ({
    request,
  }) => {
    await loginAs(request, ACCOUNTS.admin)

    for (const path of [
      '/api/schools/not-a-uuid/billing/invoices',
      '/api/schools/%00/billing/invoices',
      '/api/schools/not-a-uuid/reports/release/batches',
    ]) {
      const response = await request.get(`${API}${path}`)
      expect(
        [400, 404],
        `expected 4xx for ${path}, received ${response.status()}`,
      ).toContain(response.status())
    }
  })

  test('security headers are present on API responses', async ({ request }) => {
    const response = await request.get(`${API}/api/health`)
    expect(response.status()).toBe(200)

    const headers = response.headers()
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(
      headers['x-frame-options'] ?? headers['content-security-policy'],
    ).toBeTruthy()
    expect(headers['content-security-policy']).toMatch(/frame-ancestors/i)
  })
})
