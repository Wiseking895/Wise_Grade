import { expect, test } from '@playwright/test'
import { ACCOUNTS, SCHOOL_A, login, signOut } from './support'

test.describe('Phase 6C · authentication and route authorization', () => {
  test('anonymous visitors are redirected to the login screen', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

    await page.goto('/platform/billing')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('school administrator lands on the dashboard with admin navigation', async ({
    page,
  }) => {
    await login(page, 'admin')

    await expect(
      page.getByRole('heading', { name: `Welcome, ${SCHOOL_A}` }),
    ).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'School dashboard' })
    for (const label of [
      'Overview',
      'School profile',
      'Calendar',
      'Teachers',
      'Billing & payments',
      'Released reports',
    ]) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }

    // Academic operations belong to teaching staff, and report generation,
    // review and release belong to the platform console.
    for (const label of [
      'Classes',
      'Pupils',
      'Subjects',
      'Score entry',
      'Submissions',
      'Report release',
    ]) {
      await expect(nav.getByRole('link', { name: label })).toHaveCount(0)
    }

    // Session survives a full reload (cookie + /auth/me).
    await page.reload()
    await expect(
      page.getByRole('heading', { name: `Welcome, ${SCHOOL_A}` }),
    ).toBeVisible()
  })

  test('class teacher never receives administrator navigation or billing routes', async ({
    page,
  }) => {
    await login(page, 'teacher')

    const nav = page.getByRole('navigation', { name: 'School dashboard' })
    await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible()
    // Class teachers manage their class from the Class Dashboard; the
    // standalone class listing belongs to subject teachers only.
    await expect(nav.getByRole('link', { name: 'Classes' })).toHaveCount(0)
    await expect(
      nav.getByRole('link', { name: 'Class Dashboard' }),
    ).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Score entry' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Pupils' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Billing & payments' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Report release' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Teachers' })).toHaveCount(0)

    // Direct navigation to an admin-only route bounces back to the dashboard.
    await page.goto('/dashboard/teachers')
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.goto('/dashboard/billing')
    await expect(page).toHaveURL(/\/dashboard$/)
    // The class listing is no longer a class-teacher route either.
    await page.goto('/dashboard/classes')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('platform administrator is isolated to the platform console', async ({
    page,
  }) => {
    await login(page, 'platform')

    await expect(page).toHaveURL(/\/platform/)
    await expect(
      page.getByRole('heading', { name: 'Platform billing' }),
    ).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'Platform dashboard' })
    await expect(
      nav.getByRole('link', { name: 'Report review & release' }),
    ).toBeVisible()
    await expect(
      nav.getByRole('link', { name: 'Billing & payments' }),
    ).toBeVisible()

    // Platform admins have no school membership. The dashboard shell renders a
    // deliberate no-membership screen instead of exposing any school data.
    await page.goto('/dashboard')
    await expect(
      page.getByRole('heading', { name: 'No active school membership' }),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'School dashboard' }),
    ).toHaveCount(0)

    await signOut(page)
  })

  test('school administrator cannot enter the platform console', async ({
    page,
  }) => {
    await login(page, 'admin')
    await page.goto('/platform/billing')
    await expect(page).toHaveURL(/\/dashboard$/)

    await signOut(page)
  })

  test('wrong credentials are rejected without revealing which field failed', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(ACCOUNTS.admin)
    await page.getByLabel('Password').fill('Definitely-Wrong-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('alert')).toContainText(
      /invalid email or password/i,
    )
    await expect(page).toHaveURL(/\/login$/)
  })
})
