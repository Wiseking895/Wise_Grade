import { describe, expect, it } from 'vitest'
import {
  ACADEMIC_COLUMNS,
  A4_PORTRAIT,
  PUPIL_INFO_BLOCKS,
  REPORT_SECTIONS,
  SUMMARY_CELLS,
  buildReportLayout,
} from '../src/reports/layout.js'
import { buildReportSet } from '../src/reports/snapshot.js'
import { makeReportData } from './helpers/report-fixtures.js'

describe('report layout contract', () => {
  it('keeps the seven reference sections in exact order', () => {
    expect(REPORT_SECTIONS).toEqual([
      'SCHOOL_HEADER',
      'PUPIL_INFORMATION',
      'ACADEMIC_PERFORMANCE',
      'PERFORMANCE_SUMMARY',
      'REMARKS_ATTITUDE',
      'HEADTEACHER_SIGNATURE',
      'GRADING_SCALE',
    ])
  })

  it('defines the seven academic performance columns in the reference order', () => {
    expect(ACADEMIC_COLUMNS.map((column) => column.label)).toEqual([
      'SUBJECT',
      'CLASS SCORE',
      'EXAMS SCORE',
      'TOTAL SCORE',
      'POSITION',
      'GRADE',
      'REMARK',
    ])
    expect(
      ACADEMIC_COLUMNS.reduce((sum, column) => sum + column.widthRatio, 0),
    ).toBeCloseTo(1, 5)
  })

  it('defines three pupil information blocks with the required fields', () => {
    expect(PUPIL_INFO_BLOCKS).toHaveLength(3)
    expect(PUPIL_INFO_BLOCKS[0]).toEqual([
      'PUPIL NAME',
      'INDEX / ADMISSION NUMBER',
      'CLASS',
    ])
    expect(PUPIL_INFO_BLOCKS[1]).toEqual([
      'ACADEMIC YEAR',
      'TERM',
      'CLASS POSITION',
      'NUMBER ON ROLL',
    ])
    expect(PUPIL_INFO_BLOCKS[2]).toEqual([
      'CLOSING DATE',
      'REOPENING DATE',
    ])
    // The redundant examination total is no longer repeated in the pupil
    // information block; the examination score remains in the academic table.
    expect(PUPIL_INFO_BLOCKS.flat()).not.toContain('EXAMINATION TOTAL')
    expect(ACADEMIC_COLUMNS.map((column) => column.label)).toContain(
      'EXAMS SCORE',
    )
  })

  it('defines four horizontal performance summary cells', () => {
    expect(SUMMARY_CELLS).toEqual([
      'AGGREGATE',
      'AVERAGE',
      'ATTENDANCE',
      'TOTAL',
    ])
  })

  it('uses A4 portrait dimensions', () => {
    expect(A4_PORTRAIT.width).toBeCloseTo(595.28, 2)
    expect(A4_PORTRAIT.height).toBeCloseTo(841.89, 2)
  })

  it('builds the image positions, remarks boxes and signature layout', () => {
    const built = buildReportSet(makeReportData())
    const snapshot = built.builds[0]!.snapshot!
    const layout = buildReportLayout(snapshot)

    expect(layout.paper.orientation).toBe('portrait')
    expect(layout.images).toEqual(['schoolLogo', 'pupilPhoto'])
    expect(layout.remarksBoxes).toEqual(["TEACHER'S REMARKS", 'ATTITUDE'])
    expect(layout.signature).toEqual({
      label: 'SCHOOL ADMIN SIGNATURE',
      line: 'long-horizontal',
    })
    expect(layout.gradingHeading).toBe('GRADING SCALE:')
    expect(layout.draftLabel).toBe('INTERNAL DRAFT — NOT RELEASED')
  })
})
