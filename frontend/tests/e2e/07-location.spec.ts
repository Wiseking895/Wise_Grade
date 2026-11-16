import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { login } from './support'

const BASE_URL = 'http://localhost:5174'

const KUMASI = {
  city: 'Kumasi',
  region: 'Ashanti Region',
  country: 'Ghana',
  countryCode: 'GH',
  displayName: 'Kumasi, Ashanti Region, Ghana',
}

async function contextWith(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0],
): Promise<BrowserContext> {
  return browser.newContext({ baseURL: BASE_URL, ...options })
}

function locationChip(page: Page) {
  return page.getByRole('button', { name: /Location and timezone:/ })
}

function deniedGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(
        _success: PositionCallback,
        error?: PositionErrorCallback | null,
      ) {
        error?.({
          code: 1,
          message: 'User denied Geolocation',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError)
      },
    },
  })
}

test.describe('dashboard location indicator', () => {
  test('shows the device timezone, updates live and never prompts on load', async ({
    browser,
  }) => {
    const context = await contextWith(browser, {
      viewport: { width: 1440, height: 900 },
      timezoneId: 'America/New_York',
    })
    const page = await context.newPage()

    // Simulate a device timezone change while the app stays open. The real
    // value comes from Intl.DateTimeFormat().resolvedOptions().timeZone.
    await page.addInitScript(() => {
      const holder = window as unknown as { __deviceTimeZone: string }
      const originalResolved = Intl.DateTimeFormat.prototype.resolvedOptions
      holder.__deviceTimeZone = originalResolved
        .call(new Intl.DateTimeFormat())
        .timeZone

      Intl.DateTimeFormat.prototype.resolvedOptions = function (
        this: Intl.DateTimeFormat,
      ) {
        return {
          ...originalResolved.call(this),
          timeZone: holder.__deviceTimeZone,
        }
      }
    })

    await login(page, 'admin')

    const chip = locationChip(page)
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('America/New_York')
    await expect(chip).not.toContainText('Africa/Accra')

    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Your location' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Device timezone detected automatically')
    await expect(dialog).toContainText('America/New_York')
    await expect(
      dialog.getByRole('button', { name: 'Detect my location' }),
    ).toBeVisible()
    await expect(dialog).toContainText('not stored')

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/location/timezone-only-1440.png',
      fullPage: true,
    })

    await page.evaluate(() => {
      ;(window as unknown as { __deviceTimeZone: string }).__deviceTimeZone =
        'Europe/Berlin'
      window.dispatchEvent(new Event('focus'))
    })
    await expect(chip).toContainText('Europe/Berlin')

    await context.close()
  })

  test('resolves a place after permission is granted and shows it as automatic', async ({
    browser,
  }) => {
    const context = await contextWith(browser, {
      viewport: { width: 1440, height: 900 },
      timezoneId: 'Africa/Accra',
      permissions: ['geolocation'],
      geolocation: { latitude: 6.6885, longitude: -1.6244 },
    })
    const page = await context.newPage()
    let lookupUrl = ''

    await page.route('**/api/location/reverse*', (route) => {
      lookupUrl = route.request().url()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { location: KUMASI } }),
      })
    })

    await login(page, 'admin')

    const chip = locationChip(page)
    await expect(chip).toContainText('Kumasi')
    await expect(chip).toContainText('Africa/Accra')
    expect(lookupUrl).toContain('latitude=6.688500')
    expect(lookupUrl).toContain('longitude=-1.624400')

    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Your location' })
    await expect(dialog).toContainText('Kumasi, Ashanti Region, Ghana')
    await expect(dialog).toContainText('Location detected automatically')
    await expect(
      dialog.getByRole('button', { name: 'Refresh location' }),
    ).toBeVisible()

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/location/granted-1440.png',
      fullPage: true,
    })

    await context.close()
  })

  test('keeps the timezone when permission is denied and allows a retry', async ({
    browser,
  }) => {
    const context = await contextWith(browser, {
      viewport: { width: 1280, height: 800 },
      timezoneId: 'Europe/London',
    })
    const page = await context.newPage()
    await page.addInitScript(deniedGeolocation)

    await login(page, 'admin')

    const chip = locationChip(page)
    await expect(chip).toContainText('Europe/London')

    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Your location' })
    await dialog.getByRole('button', { name: 'Detect my location' }).click()

    await expect(dialog).toContainText('Location permission was denied')
    await expect(dialog).toContainText('Your device timezone is still shown')
    await expect(chip).toContainText('Europe/London')
    await expect(
      dialog.getByRole('button', { name: 'Detect my location' }),
    ).toBeVisible()

    await context.close()
  })

  test('explains unsupported browsers without offering a broken retry', async ({
    browser,
  }) => {
    const context = await contextWith(browser, {
      viewport: { width: 1280, height: 800 },
      timezoneId: 'Asia/Tokyo',
    })
    const page = await context.newPage()

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: undefined,
      })
    })

    await login(page, 'admin')

    const chip = locationChip(page)
    await expect(chip).toContainText('Asia/Tokyo')
    await chip.click()

    const dialog = page.getByRole('dialog', { name: 'Your location' })
    await expect(dialog).toContainText('does not support location detection')
    await expect(dialog).toContainText('Asia/Tokyo')
    await expect(
      dialog.getByRole('button', { name: 'Detect my location' }),
    ).toHaveCount(0)

    await context.close()
  })

  test('falls back to the timezone when reverse geocoding fails, then retries', async ({
    browser,
  }) => {
    const context = await contextWith(browser, {
      viewport: { width: 1280, height: 800 },
      timezoneId: 'Australia/Sydney',
      permissions: ['geolocation'],
      geolocation: { latitude: 6.6885, longitude: -1.6244 },
    })
    const page = await context.newPage()
    let attempts = 0

    await page.route('**/api/location/reverse*', (route) => {
      attempts += 1

      if (attempts === 1) {
        return route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { message: 'Reverse geocoding service is unavailable' },
          }),
        })
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { location: KUMASI } }),
      })
    })

    await login(page, 'admin')

    const chip = locationChip(page)
    await expect(chip).toContainText('Australia/Sydney')

    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Your location' })
    await expect(dialog).toContainText('could not find a place name')
    await expect(dialog).toContainText('Australia/Sydney')

    await dialog.getByRole('button', { name: 'Detect my location' }).click()
    await expect(dialog).toContainText('Kumasi, Ashanti Region, Ghana')
    await expect(dialog).toContainText('Location detected automatically')
    expect(attempts).toBeGreaterThanOrEqual(2)

    await context.close()
  })

  test('stays compact and usable on a 360px mobile viewport', async ({
    browser,
  }) => {
    const context = await contextWith(browser, {
      viewport: { width: 360, height: 800 },
      timezoneId: 'Africa/Accra',
      permissions: ['geolocation'],
      geolocation: { latitude: 6.6885, longitude: -1.6244 },
    })
    const page = await context.newPage()

    await page.route('**/api/location/reverse*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { location: KUMASI } }),
      }),
    )

    await login(page, 'admin')

    const chip = locationChip(page)
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('Africa/Accra')

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Your location' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Kumasi, Ashanti Region, Ghana')

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/location/granted-360.png',
      fullPage: true,
    })

    await context.close()
  })
})
