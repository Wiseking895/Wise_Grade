import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'Phase6C!Testing2026'

export const ACCOUNTS = {
  platform: 'platform@phase6c.test',
  admin: 'admin.a@phase6c.test',
  teacher: 'teacher.a@phase6c.test',
  otherAdmin: 'admin.b@phase6c.test',
} as const

export const SCHOOL_A = 'Phase 6C Demo Academy'
export const SCHOOL_B = 'Phase 6C Other College'

/** 1x1 transparent PNG used as synthetic manual-payment evidence. */
export const EVIDENCE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

export type Role = keyof typeof ACCOUNTS

/**
 * Signs in through the real login form. The caller starts from any page;
 * login always lands on the role-appropriate dashboard.
 */
export async function login(page: Page, role: Role): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(ACCOUNTS[role])
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login$/)

  if (role === 'platform') {
    await expect(page).toHaveURL(/\/platform/)
  } else {
    await expect(page).toHaveURL(/\/dashboard/)
  }
}

/**
 * Signs out through the sidebar control and waits for the login screen.
 * Below the `lg` breakpoint the sidebar is off-canvas, so open it first.
 */
export async function signOut(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1280

  if (width < 1024) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
  }

  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await expect(page).toHaveURL(/\/login$/)
}

/**
 * Switches the active academic term on a report page. Option labels are often
 * formatted ("2026/2027 · Term 1"), so resolve the matching option's value
 * instead of requiring an exact label.
 */
export async function chooseTerm(
  page: Page,
  label = 'Term 1',
): Promise<void> {
  const select = page.getByLabel('Academic term').first()
  const option = select.locator('option', { hasText: label }).first()
  await expect(option).toBeAttached()
  const value = await option.getAttribute('value')

  if (!value) {
    throw new Error(`No academic term option matched "${label}"`)
  }

  await select.selectOption(value)
}

/** Waits for a visible status/notice message. */
export async function expectNotice(
  page: Page,
  pattern: RegExp,
): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: pattern }).first()).toBeVisible()
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Collects uncaught page exceptions. Callers assert the array is empty after
 * exercising a page; expected 4xx API responses are not page errors.
 */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}
