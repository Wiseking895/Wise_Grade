import { expect, test, type Page } from '@playwright/test'
import { chooseTerm, login, signOut } from './support'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 },
] as const

const ADMIN_PAGES = [
  { path: '/dashboard', label: 'overview' },
  { path: '/dashboard/teachers', label: 'teachers' },
  { path: '/dashboard/billing', label: 'billing' },
] as const

const TEACHER_PAGES = [
  { path: '/dashboard/classes', label: 'classes' },
  { path: '/dashboard/pupils', label: 'pupils' },
  { path: '/dashboard/assessments/scores', label: 'score-entry' },
] as const

const PLATFORM_PAGES = [
  { path: '/platform/assessments', label: 'platform-assessments' },
  { path: '/platform/reports/generate', label: 'platform-generate' },
  { path: '/platform/billing', label: 'platform-billing' },
  { path: '/platform/reports', label: 'platform-reports' },
] as const

async function assertNoHorizontalOverflow(
  page: Page,
  label: string,
): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(
    metrics.scrollWidth,
    `${label} overflows horizontally (${metrics.scrollWidth} > ${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1)
}

async function waitForPage(page: Page): Promise<void> {
  await expect(page.locator('main h1').first()).toBeVisible()
}

for (const viewport of VIEWPORTS) {
  test(`responsive layout at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    })

    // Administrator surfaces.
    await login(page, 'admin')

    for (const target of ADMIN_PAGES) {
      await page.goto(target.path)
      await waitForPage(page)
      await assertNoHorizontalOverflow(page, `${target.label} @ ${viewport.name}`)
      await page.screenshot({
        path: `.artifacts/phase6c/screenshots/responsive/${viewport.name}-${target.label}.png`,
        fullPage: true,
      })
    }

    const mobile = viewport.width < 1024
    const sidebar = page.getByRole('navigation', { name: 'School dashboard' })

    if (mobile) {
      await expect(sidebar).toBeHidden()
      const openMenu = page.getByRole('button', { name: 'Open navigation' })
      await expect(openMenu).toBeVisible()
      await openMenu.click()
      await expect(sidebar).toBeVisible()
      await page.screenshot({
        path: `.artifacts/phase6c/screenshots/responsive/${viewport.name}-mobile-nav.png`,
        fullPage: false,
      })
      // The backdrop sits behind the panel; click the exposed area on the right
      // rather than the panel-covered centre.
      await page
        .getByRole('button', { name: 'Close navigation overlay' })
        .click({ position: { x: 350, y: 12 } })
      await expect(sidebar).toBeHidden()
    } else {
      await expect(sidebar).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Open navigation' }),
      ).toBeHidden()
    }

    // Released report card at the same viewport (03 releases it before this
    // spec runs).
    await page.goto('/dashboard/reports')
    await chooseTerm(page)
    await page
      .getByRole('row')
      .filter({ hasText: 'Mensah' })
      .getByRole('link', { name: 'Preview' })
      .click()
    await waitForPage(page)
    await expect(
      page.getByText('RELEASED — PRIVATE SCHOOL ACCESS'),
    ).toBeVisible()
    await assertNoHorizontalOverflow(
      page,
      `report-card @ ${viewport.name}`,
    )
    await page.screenshot({
      path: `.artifacts/phase6c/screenshots/responsive/${viewport.name}-report-card.png`,
      fullPage: true,
    })

    await signOut(page)

    // Class-teacher surfaces.
    await login(page, 'teacher')
    for (const target of TEACHER_PAGES) {
      await page.goto(target.path)
      await waitForPage(page)
      await assertNoHorizontalOverflow(page, `${target.label} @ ${viewport.name}`)
      await page.screenshot({
        path: `.artifacts/phase6c/screenshots/responsive/${viewport.name}-${target.label}.png`,
        fullPage: true,
      })
    }
    await signOut(page)

    // Platform surfaces.
    await login(page, 'platform')
    for (const target of PLATFORM_PAGES) {
      await page.goto(target.path)
      await waitForPage(page)
      await assertNoHorizontalOverflow(
        page,
        `${target.label} @ ${viewport.name}`,
      )
      await page.screenshot({
        path: `.artifacts/phase6c/screenshots/responsive/${viewport.name}-${target.label}.png`,
        fullPage: true,
      })
    }

    await signOut(page)
  })
}
