import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  EARLY_YEARS_SCALE,
  earlyYearsPerformance,
  earlyYearsRemark,
  isEarlyYearsClass,
} from '../src/assessment/early-years.ts'

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('early-years performance descriptors', () => {
  it('matches Creche, Nursery, KG and kindergarten classes only', () => {
    for (const name of ['Creche', 'Nursery 1', 'Nursery 2', 'KG 1', 'KG 2']) {
      assert.equal(isEarlyYearsClass({ name }), true, name)
    }

    for (const name of [
      'Basic 1',
      'Basic 6',
      'Primary 3',
      'JHS 1',
      'Senior High 2',
    ]) {
      assert.equal(isEarlyYearsClass({ name }), false, name)
    }

    assert.equal(isEarlyYearsClass({ name: null, level: 'NURSERY' }), true)
    assert.equal(isEarlyYearsClass({ name: 'Basic 1', level: 'NURSERY' }), false)
  })

  it('classifies exact boundaries as Gold, Silver and Bronze', () => {
    assert.equal(earlyYearsPerformance(80)?.display, 'Gold (G)')
    assert.equal(earlyYearsPerformance(100)?.display, 'Gold (G)')
    assert.equal(earlyYearsPerformance(79.99)?.display, 'Silver (S)')
    assert.equal(earlyYearsPerformance(55)?.display, 'Silver (S)')
    assert.equal(earlyYearsPerformance(54.99)?.display, 'Bronze (B)')
    assert.equal(earlyYearsPerformance(0)?.display, 'Bronze (B)')
  })

  it('uses the unrounded score, not a rounded percentage', () => {
    // 79.999 is Silver because it has not reached the 80 boundary.
    assert.equal(earlyYearsPerformance(79.999)?.remark, 'Silver')
    // 54.999 is Bronze because it has not reached the 55 boundary.
    assert.equal(earlyYearsPerformance(54.999)?.remark, 'Bronze')
  })

  it('never classifies missing or invalid scores', () => {
    assert.equal(earlyYearsPerformance(null), null)
    assert.equal(earlyYearsPerformance(undefined), null)
    assert.equal(earlyYearsRemark(null), null)
    assert.equal(earlyYearsPerformance(-1), null)
    assert.equal(earlyYearsPerformance(100.01), null)
  })

  it('exposes the fixed read-only Gold/Silver/Bronze scale', () => {
    assert.deepEqual(
      EARLY_YEARS_SCALE.map((band) => band.gradeLabel),
      ['G', 'S', 'B'],
    )
    assert.deepEqual(
      EARLY_YEARS_SCALE.map((band) => band.remark),
      ['Gold', 'Silver', 'Bronze'],
    )
  })
})

describe('school assessment configuration is not exposed', () => {
  it('has no assessment setup or grading scheme navigation entries', async () => {
    const layout = await source('../src/components/DashboardLayout.tsx')
    const lower = layout.toLowerCase()

    assert.equal(lower.includes('assessment setup'), false)
    assert.equal(lower.includes('grading scheme'), false)
    assert.equal(lower.includes('assessments/setup'), false)
    assert.equal(lower.includes('grading-schemes'), false)
  })

  it('has no assessment setup or grading scheme routes or pages', async () => {
    const app = await source('../src/App.tsx')
    const lower = app.toLowerCase()

    assert.equal(lower.includes('assessments/setup'), false)
    assert.equal(lower.includes('grading-schemes'), false)
    assert.equal(lower.includes('assessmentconfigpage'), false)
    assert.equal(lower.includes('gradingschemespage'), false)
  })

  it('still exposes score entry and report routes', async () => {
    const app = await source('../src/App.tsx')

    assert.match(app, /assessments\/scores/)
    assert.match(app, /assessments\/submissions/)
    assert.match(app, /reports/)
  })
})
