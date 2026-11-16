import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  EVIDENCE_PNG_BASE64,
  SCHOOL_A,
  login,
  signOut,
} from './support'

const API = 'http://localhost:4100'
const LOGO_ALT = `${SCHOOL_A} logo`

async function activeSchoolId(page: Page, schoolName: string): Promise<string> {
  const response = await page.request.get(`${API}/api/auth/me`)
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as {
    data: {
      memberships: Array<{ schoolId: string; schoolName: string }>
    }
  }
  const membership = payload.data.memberships.find(
    (item) => item.schoolName === schoolName,
  )

  expect(membership, `missing membership for ${schoolName}`).toBeTruthy()
  return membership!.schoolId
}

async function uploadLogo(page: Page): Promise<void> {
  await page.goto('/dashboard/school')
  await expect(
    page.getByRole('heading', { name: 'School profile' }),
  ).toBeVisible()

  await page.locator('#profileLogo').setInputFiles({
    name: 'school-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(EVIDENCE_PNG_BASE64, 'base64'),
  })
  await page.getByRole('button', { name: 'Upload logo' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'School logo updated' }),
  ).toBeVisible()
}

async function expectLoadedImage(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect
    .poll(
      () =>
        locator.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth > 0,
        ),
      { message: 'logo image did not finish loading' },
    )
    .toBe(true)
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
}

test.describe.serial('school dashboard logo', () => {
  test('an uploaded logo replaces initials and a replacement refreshes the dashboard', async ({
    page,
  }) => {
    await login(page, 'admin')
    const schoolId = await activeSchoolId(page, SCHOOL_A)

    await uploadLogo(page)
    await page.goto('/dashboard')

    const firstLogo = page.locator(`header img[alt="${LOGO_ALT}"]`)
    await expectLoadedImage(firstLogo)

    const firstSrc = await firstLogo.getAttribute('src')
    expect(firstSrc).toContain(`/api/schools/${schoolId}/profile/logo`)
    // The initials fallback must not remain behind the loaded image.
    await expect(firstLogo.locator('..')).not.toContainText('P6')

    // Uploading again keeps the same school but creates a new cache-busted URL.
    await uploadLogo(page)
    await page.goto('/dashboard')

    const replacementLogo = page.locator(`header img[alt="${LOGO_ALT}"]`)
    await expectLoadedImage(replacementLogo)

    const replacementSrc = await replacementLogo.getAttribute('src')
    expect(replacementSrc).toContain(`/api/schools/${schoolId}/profile/logo`)
    expect(replacementSrc).not.toBe(firstSrc)
    await expect(replacementLogo.locator('..')).not.toContainText('P6')
  })

  test('a school without a logo shows initials and never another school logo', async ({
    page,
  }) => {
    await login(page, 'admin')
    await page.goto('/dashboard')

    const schoolALogo = page.locator(`header img[alt="${LOGO_ALT}"]`)
    await expectLoadedImage(schoolALogo)
    const schoolASrc = await schoolALogo.getAttribute('src')

    await signOut(page)
    await login(page, 'otherAdmin')
    await page.goto('/dashboard')

    // School B has no uploaded logo, so the dashboard must show its own
    // initials and must not fall back to school A's private image.
    await expect(page.locator('header img[alt$=" logo"]')).toHaveCount(0)
    await expect(
      page.locator('header').getByText('P6', { exact: true }),
    ).toBeVisible()
    expect(await page.locator('header').innerHTML()).not.toContain(
      schoolASrc as string,
    )
  })

  test('the logo renders correctly on desktop and mobile', async ({ page }) => {
    await login(page, 'admin')
    const schoolId = await activeSchoolId(page, SCHOOL_A)
    await uploadLogo(page)

    const viewports = [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 },
    ] as const

    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      await page.goto('/dashboard')

      const headerLogo = page.locator(`header img[alt="${LOGO_ALT}"]`)
      await expectLoadedImage(headerLogo)
      await expect(
        headerLogo,
        `${viewport.name} logo must preserve its aspect ratio`,
      ).toHaveCSS('object-fit', 'contain')
      await assertNoHorizontalOverflow(page)

      if (viewport.width < 1024) {
        await page.getByRole('button', { name: 'Open navigation' }).click()
      }

      const sidebarLogo = page
        .locator('aside:visible')
        .getByRole('img', { name: LOGO_ALT })
        .first()
      await expectLoadedImage(sidebarLogo)
      await expect(sidebarLogo).toHaveCSS('object-fit', 'contain')

      if (viewport.width < 1024) {
        await page
          .getByRole('button', { name: 'Close navigation overlay' })
          .click({ position: { x: 350, y: 12 } })
      }
    }

    // The authenticated logo route is never anonymously readable.
    await signOut(page)
    const anonymous = await page.request.get(
      `${API}/api/schools/${schoolId}/profile/logo`,
    )
    expect([401, 403]).toContain(anonymous.status())
  })
})
