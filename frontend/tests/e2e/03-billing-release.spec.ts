import { Buffer } from 'node:buffer'
import { expect, test, type Page } from '@playwright/test'
import {
  EVIDENCE_PNG_BASE64,
  SCHOOL_A,
  chooseTerm,
  login,
  signOut,
  trackPageErrors,
} from './support'

const PAYMENT_REFERENCE = 'P6C-BANK-0001'

async function openPlatformTab(page: Page, tab: string): Promise<void> {
  await page.goto('/platform/billing')
  await page.getByRole('button', { name: tab, exact: true }).click()
}

async function openPlatformBatch(page: Page): Promise<void> {
  await page.goto('/platform/reports')
  const inspect = page.getByRole('button', { name: 'Inspect' }).first()
  await expect(inspect).toBeVisible()
  await inspect.click()
  await expect(
    page.getByText('Controlled release is deliberate and audited'),
  ).toBeVisible()
}

test.describe.serial('Phase 6C · billing, payment and controlled release', () => {
  test('platform issues a per-pupil invoice for the generated batch', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'platform')
    await openPlatformTab(page, 'Invoices')

    await page.getByLabel('School').selectOption({ label: SCHOOL_A })
    await page.getByLabel('Academic year').selectOption({ label: '2026/2027' })
    await page.getByLabel('Term').selectOption({ label: 'Term 1' })

    await page.getByRole('button', { name: 'Create draft' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'created for 2 unique pupils' }),
    ).toBeVisible()

    const row = page.getByRole('row').filter({ hasText: SCHOOL_A }).first()
    await expect(row).toContainText('Draft')
    await expect(row).toContainText('2')

    await row.getByRole('button', { name: 'Issue', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Issue this invoice?')
    await dialog.getByRole('button', { name: 'Issue invoice' }).click()

    await expect(row).toContainText('Issued')
    await expect(row).toContainText(/GH₵10\.00/)

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/platform-invoice-issued.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('platform cannot approve an unpaid batch', async ({ page }) => {
    await login(page, 'platform')
    await openPlatformBatch(page)

    await expect(
      page.getByText('Eligibility problems block approval and release'),
    ).toBeVisible()
    await expect(
      page.getByText(
        'The corresponding invoice is not fully paid. Payment verification alone does not authorise release.',
      ),
    ).toBeVisible()

    await signOut(page)
  })

  test('school submits full manual payment evidence', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'admin')
    await page.goto('/dashboard/billing')

    await expect(
      page.getByRole('heading', { name: 'Billing & payments' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'View invoice' }).first().click()
    await page.getByRole('button', { name: 'Add payment evidence' }).click()

    const amount = page.getByLabel(/Amount \(GHS\)/)
    await expect(amount).toHaveValue('10.00')

    await page.getByLabel('Payment reference').fill(PAYMENT_REFERENCE)
    await page
      .getByLabel('Payer name (optional)')
      .fill('Phase 6C Demo Academy Bursar')

    await page.locator('input[type="file"]').setInputFiles({
      name: 'phase6c-evidence.png',
      mimeType: 'image/png',
      buffer: Buffer.from(EVIDENCE_PNG_BASE64, 'base64'),
    })

    await page.getByRole('button', { name: 'Submit for verification' }).click()

    const paymentRow = page
      .getByRole('row')
      .filter({ hasText: PAYMENT_REFERENCE })
      .first()
    await expect(paymentRow).toBeVisible()
    await expect(paymentRow).toContainText('Pending')
    await expect(paymentRow).toContainText(/GH₵10\.00/)

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/payment-submitted-pending.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('platform verifies the payment and updates the invoice balance', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'platform')
    await openPlatformTab(page, 'Payments')

    const pendingCard = page
      .locator('article')
      .filter({ hasText: PAYMENT_REFERENCE })
      .first()
    await expect(pendingCard).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Awaiting verification' }),
    ).toBeVisible()

    await pendingCard.getByRole('button', { name: 'Verify' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Verify this payment?')
    await dialog.getByRole('button', { name: 'Verify payment' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: /Payment verified: .* applied to/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Nothing awaiting verification' }),
    ).toBeVisible()

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/payment-verified.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('paid batch is approved and stays private until release', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'platform')
    await openPlatformBatch(page)

    // Platform generation already places the batch in the review queue, so the
    // next deliberate step is approval. Approval keeps the reports private.
    const approve = page.getByRole('button', { name: 'Approve for release' })
    await expect(approve).toBeEnabled()
    await approve.click()

    const approveDialog = page.getByRole('dialog')
    await expect(approveDialog).toContainText('Approve this batch?')
    await approveDialog.getByRole('button', { name: 'Approve', exact: true }).click()

    await expect(
      page.getByRole('button', { name: 'Release to school' }),
    ).toBeEnabled()
    await expect(
      page.getByText(/Approved.*not released/).first(),
    ).toBeVisible()

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/platform-approved-not-released.png',
      fullPage: true,
    })

    // The school still cannot see the reports before explicit release.
    await signOut(page)
    await login(page, 'admin')
    await page.goto('/dashboard/reports')
    await chooseTerm(page)
    await expect(
      page.getByRole('heading', { name: 'No released reports yet' }),
    ).toBeVisible()
    await signOut(page)

    expect(pageErrors).toEqual([])
  })

  test('platform releases the batch through a second explicit action', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'platform')
    await openPlatformBatch(page)

    const release = page.getByRole('button', { name: 'Release to school' })
    await expect(release).toBeEnabled()
    await release.click()

    const confirm = page.getByRole('dialog')
    await expect(confirm).toContainText('Release this batch to the school?')
    await confirm.getByRole('button', { name: 'Release to school' }).click()

    await expect(
      page.getByText('Released. No further platform action is available.'),
    ).toBeVisible()

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/platform-released.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('school previews and downloads the released private PDF', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'admin')
    await page.goto('/dashboard/reports')
    await chooseTerm(page)

    const row = page.getByRole('row').filter({ hasText: 'Mensah' })
    await expect(row).toBeVisible()
    await row.getByRole('link', { name: 'Preview' }).click()

    await expect(
      page.getByText('RELEASED — PRIVATE SCHOOL ACCESS'),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Report card preview' }),
    ).toBeVisible()
    await expect(
      page.getByTitle('Report card preview for Ama Mensah Akua'),
    ).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download released PDF' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
    const path = './.artifacts/phase6c/downloads/ama-mensah-report-card.pdf'
    await download.saveAs(path)

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/report-card-released.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })
})
