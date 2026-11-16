import type { ReportSnapshot } from './snapshot.js'

/** The exact section order required by the reference report card. */
export const REPORT_SECTIONS = [
  'SCHOOL_HEADER',
  'PUPIL_INFORMATION',
  'ACADEMIC_PERFORMANCE',
  'PERFORMANCE_SUMMARY',
  'REMARKS_ATTITUDE',
  'HEADTEACHER_SIGNATURE',
  'GRADING_SCALE',
] as const

export type ReportSection = (typeof REPORT_SECTIONS)[number]

export const ACADEMIC_COLUMNS = [
  { key: 'subject', label: 'SUBJECT', widthRatio: 0.22 },
  { key: 'classScore', label: 'CLASS SCORE', widthRatio: 0.145 },
  { key: 'examScore', label: 'EXAMS SCORE', widthRatio: 0.17 },
  { key: 'totalScore', label: 'TOTAL SCORE', widthRatio: 0.135 },
  { key: 'subjectPosition', label: 'POSITION', widthRatio: 0.105 },
  { key: 'grade', label: 'GRADE', widthRatio: 0.085 },
  { key: 'remark', label: 'REMARK', widthRatio: 0.14 },
] as const

export type AcademicColumnKey = (typeof ACADEMIC_COLUMNS)[number]['key']

export const PUPIL_INFO_BLOCKS = [
  ['PUPIL NAME', 'INDEX / ADMISSION NUMBER', 'CLASS'],
  ['ACADEMIC YEAR', 'TERM', 'CLASS POSITION', 'NUMBER ON ROLL'],
  ['CLOSING DATE', 'REOPENING DATE'],
] as const

export const SUMMARY_CELLS = [
  'AGGREGATE',
  'AVERAGE',
  'ATTENDANCE',
  'TOTAL',
] as const

export interface ReportLayoutModel {
  paper: { width: number; height: number; orientation: 'portrait' }
  sections: ReportSection[]
  images: Array<'schoolLogo' | 'emblem' | 'crest' | 'pupilPhoto' | 'signature'>
  pupilInfoBlocks: readonly (readonly string[])[]
  academicColumns: Array<{ key: AcademicColumnKey; label: string }>
  summaryCells: readonly string[]
  remarksBoxes: ['TEACHER\'S REMARKS', 'ATTITUDE']
  signature: { label: string; line: 'long-horizontal' }
  gradingHeading: 'GRADING SCALE:'
  draftLabel: string
}

export const A4_PORTRAIT = { width: 595.28, height: 841.89 } as const

export function buildReportLayout(snapshot: ReportSnapshot): ReportLayoutModel {
  return {
    paper: { ...A4_PORTRAIT, orientation: 'portrait' },
    sections: [...REPORT_SECTIONS],
    images: ['schoolLogo', 'pupilPhoto'],
    pupilInfoBlocks: PUPIL_INFO_BLOCKS,
    academicColumns: ACADEMIC_COLUMNS.map((column) => ({
      key: column.key,
      label: column.label,
    })),
    summaryCells: SUMMARY_CELLS,
    remarksBoxes: ["TEACHER'S REMARKS", 'ATTITUDE'],
    signature: {
      label:
        snapshot.document.headteacherLabel || 'SCHOOL ADMIN SIGNATURE',
      line: 'long-horizontal',
    },
    gradingHeading: 'GRADING SCALE:',
    draftLabel: snapshot.draftLabel,
  }
}

export function subjectWeightLabel(
  snapshot: ReportSnapshot,
  subjectIndex: number,
  kind: 'sba' | 'exam',
): string {
  const subject = snapshot.academic.subjects[subjectIndex]

  if (!subject) {
    return ''
  }

  return kind === 'sba' ? subject.weights.sba : subject.weights.exam
}
