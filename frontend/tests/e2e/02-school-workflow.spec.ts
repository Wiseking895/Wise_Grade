import { expect, test } from '@playwright/test'
import { chooseTerm, login, signOut, trackPageErrors } from './support'

/**
 * Phase 6C end-to-end school workflow, aligned with the corrected role model.
 *
 * School administrators register classes and class teachers and keep read-only
 * visibility. Class teachers own subject setup, pupils and score entry. The
 * platform console performs academic review, report generation, approval and
 * release.
 */
test.describe.serial('Phase 6C · school workflow', () => {
  test('administrator sees teachers and assignments without a class listing', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'admin')

    // The overview must not repeat the removed standalone class-listing section.
    await expect(
      page.getByRole('heading', { name: 'Classes', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText('Read-only school class structure.'),
    ).toHaveCount(0)

    // The removed subject catalogue is replaced by an aggregate count per
    // class. No subject names or abbreviations are shown to the administrator.
    await expect(
      page.getByRole('heading', { name: 'Subjects by class', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Subject catalogue', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByText('Read-only list of subjects')).toHaveCount(0)

    const subjectCountTable = page.getByRole('table').filter({
      has: page.getByRole('columnheader', { name: 'Number of subjects' }),
    })
    await expect(subjectCountTable).toBeVisible()
    await expect(
      subjectCountTable.getByRole('row').filter({ hasText: 'Basic 5A' }),
    ).toContainText('3')
    await expect(subjectCountTable.getByText('Mathematics')).toHaveCount(0)
    await expect(subjectCountTable.getByText('MATH')).toHaveCount(0)

    await page.goto('/dashboard/teachers')
    await expect(
      page.getByRole('heading', { name: 'Classes and teachers', exact: true }),
    ).toBeVisible()

    // The removed class table and its explanatory copy are gone.
    await expect(
      page.getByRole('heading', { name: 'Classes', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByText(
        'Classes are created when a class teacher is registered. This view is read-only.',
      ),
    ).toHaveCount(0)

    // Teachers and their assignments remain visible read-only.
    await expect(page.getByText('Kwame Teacher').first()).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Class teachers' }),
    ).toBeVisible()
    await expect(page.getByText('teacher.a@phase6c.test').first()).toBeVisible()
    await expect(page.getByText('Basic 5A').first()).toBeVisible()

    // The administrator can manage the school profile but not academic work.
    await page.goto('/dashboard/school')
    await expect(
      page.getByRole('heading', { name: 'School profile', exact: true }),
    ).toBeVisible()

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('class teacher enters and submits complete scores for all three subjects', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'teacher')

    // The Class Dashboard resolves the assigned class automatically and the
    // standalone class listing is no longer part of class-teacher navigation.
    await expect(
      page.getByRole('heading', { name: 'Class Dashboard', exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/You are responsible for Basic 5A/)).toBeVisible()
    await expect(page.getByText('Pupils on Roll').first()).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Classes', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByLabel('Class', { exact: true })).toHaveCount(0)

    await page.goto('/dashboard/assessments/scores')

    await page.getByLabel('Academic year').selectOption({ label: '2026/2027' })
    await page.getByLabel('Academic term').selectOption({ label: 'Term 1' })

    // The assigned class is displayed read-only; there is no class selector.
    await expect(
      page.getByText('Automatically loaded from your active class assignment.'),
    ).toBeVisible()
    await expect(page.getByLabel('Class', { exact: true })).toHaveCount(0)

    const subjects: Array<{
      name: string
      scores: [string, string, string, string]
    }> = [
      { name: 'Mathematics', scores: ['36', '54', '32', '48'] },
      { name: 'English Language', scores: ['34', '50', '30', '46'] },
      { name: 'Integrated Science', scores: ['30', '44', '28', '42'] },
    ]

    for (const subject of subjects) {
      await page.getByLabel('Subject').selectOption({ label: subject.name })
      // Wait for the newly selected sheet to replace the previous register
      // before typing; otherwise fills can land on the outgoing view.
      await expect(page.getByText('0/2 complete').first()).toBeVisible()
      const firstCell = page.locator('#score-0-0')
      await expect(firstCell).toBeEnabled()
      await expect(firstCell).toHaveValue('')
      await expect(
        page.getByRole('columnheader', { name: 'Position' }),
      ).toBeVisible()
      await expect(page.getByText('Not saved yet')).toHaveCount(0)
      await expect(page.getByText(/Grading scheme:/)).toHaveCount(0)

      const cells = [
        '#score-0-0',
        '#score-0-1',
        '#score-1-0',
        '#score-1-1',
      ]

      for (let index = 0; index < cells.length; index += 1) {
        const cell = page.locator(cells[index])
        await cell.fill(subject.scores[index])
      }

      await expect(page.getByText('2/2 complete').first()).toBeVisible()

      // Provisional positions are available immediately, before submission.
      const registerTable = page
        .getByRole('table')
        .filter({
          has: page.getByRole('columnheader', { name: 'Position' }),
        })
        .first()
      await expect(
        page.getByText('Provisional positions update as scores change'),
      ).toBeVisible()
      await expect(registerTable.getByText('1st', { exact: true })).toBeVisible()
      await expect(registerTable.getByText('2nd', { exact: true })).toBeVisible()
      await expect(registerTable.getByText('—', { exact: true })).toHaveCount(0)

      const submit = page.getByRole('button', { name: 'Submit results' })
      await expect(submit).toBeEnabled()
      await submit.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('Submit results for review?')
      await dialog.getByRole('button', { name: 'Submit and lock' }).click()

      await expect(
        page
          .getByRole('status')
          .filter({ hasText: `Results submitted for Basic 5A ${subject.name}.` }),
      ).toBeVisible()
      await expect(page.getByText('Locked').first()).toBeVisible()
      await expect(page.getByText('All changes saved').first()).toBeVisible()

      // Provisional positions remain visible after submission, and workflow
      // wording never appears in the Position column.
      await expect(registerTable.getByText('1st', { exact: true })).toBeVisible()
      await expect(registerTable.getByText('2nd', { exact: true })).toBeVisible()
      await expect(registerTable.getByText('Pending review')).toHaveCount(0)
      await expect(
        registerTable.getByText('Pending submission'),
      ).toHaveCount(0)
    }

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/teacher-score-entry-locked.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('platform accepts every submitted subject sheet', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'platform')
    await page.goto('/platform/assessments')

    await page
      .getByLabel('School')
      .selectOption({ label: 'Phase 6C Demo Academy' })
    await page
      .getByLabel('Academic term')
      .selectOption({ label: '2026/2027 · Term 1' })

    for (const subject of [
      'Mathematics',
      'English Language',
      'Integrated Science',
    ]) {
      const row = page.getByRole('row').filter({ hasText: subject })
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: 'Review' }).click()

      await expect(
        page.getByRole('heading', { name: 'Result submission review' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Accept results' }).click()

      const dialog = page.getByRole('dialog', {
        name: 'Accept these results?',
      })
      await expect(dialog).toContainText('Accept these results?')
      await dialog.getByRole('button', { name: 'Accept results' }).click()

      await expect(
        page
          .getByRole('status')
          .filter({ hasText: /Results accepted/ }),
      ).toBeVisible()
      await expect(dialog).toBeHidden()

      const reviewDialog = page.getByRole('dialog', {
        name: 'Result submission review',
      })
      await expect(
        reviewDialog.getByText(
          'These results are accepted and immutable. They are eligible for platform report generation.',
        ),
      ).toBeVisible()
      await reviewDialog
        .getByRole('button', { name: 'Close dialog' })
        .click()
      await expect(reviewDialog).toBeHidden()
    }

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('class teacher sees finalized subject positions after acceptance', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'teacher')
    await page.goto('/dashboard/assessments/scores')

    await page.getByLabel('Academic year').selectOption({ label: '2026/2027' })
    await page.getByLabel('Academic term').selectOption({ label: 'Term 1' })
    await page.getByLabel('Subject').selectOption({ label: 'Mathematics' })

    await expect(page.getByText('2/2 complete').first()).toBeVisible()

    const registerTable = page
      .getByRole('table')
      .filter({
        has: page.getByRole('columnheader', { name: 'Position' }),
      })
      .first()

    // The same backend ranking used by the report snapshot is now official.
    await expect(registerTable.getByText('1st', { exact: true })).toBeVisible()
    await expect(registerTable.getByText('2nd', { exact: true })).toBeVisible()
    await expect(registerTable.getByText('Pending review')).toHaveCount(0)
    await expect(registerTable.getByText('—', { exact: true })).toHaveCount(0)
    await expect(
      page.getByText('Provisional positions update as scores change'),
    ).toHaveCount(0)

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('platform generates immutable report cards for the class', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'platform')
    await page.goto('/platform/reports/generate')

    await page
      .getByLabel('School')
      .selectOption({ label: 'Phase 6C Demo Academy' })
    await page.getByLabel('Academic year').selectOption({ label: '2026/2027' })
    await page.getByLabel('Academic term').selectOption({ label: 'Term 1' })
    await page
      .getByLabel('Generation scope')
      .selectOption({ label: 'One class' })
    await page.getByLabel('Class').selectOption({ label: 'Basic 5A' })

    await expect(
      page.getByText('2 of 2 pupils are eligible for report generation.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Generate reports' }).click()

    await expect(
      page.getByText('Generation batch queued for platform review'),
    ).toBeVisible()
    await expect(
      page.getByText('2 generated · 0 skipped · 0 failed.'),
    ).toBeVisible()

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/report-generation-result.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })

  test('generated report cards stay hidden from the school before release', async ({
    page,
  }) => {
    const pageErrors = trackPageErrors(page)
    await login(page, 'admin')
    await page.goto('/dashboard/reports')
    await chooseTerm(page)

    await expect(
      page.getByRole('heading', { name: 'Released reports', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'No released reports yet' }),
    ).toBeVisible()
    await expect(page.getByText('Mensah')).toHaveCount(0)

    await page.screenshot({
      path: '.artifacts/phase6c/screenshots/report-card-hidden-before-release.png',
      fullPage: true,
    })

    expect(pageErrors).toEqual([])
    await signOut(page)
  })
})
