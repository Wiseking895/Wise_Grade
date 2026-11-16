import type {
  AssessmentComponentInput,
  GradeBandInput,
} from './repository.js'

/**
 * Editable example only. Ghanaian schools are not required to use these labels
 * or boundaries; the school's own approved grading policy is authoritative.
 */
export const EXAMPLE_GRADE_BANDS: GradeBandInput[] = [
  { minScore: '80.00', maxScore: '100.00', gradeLabel: 'A1', remark: 'Excellent', sortOrder: 0 },
  { minScore: '75.00', maxScore: '79.99', gradeLabel: 'B2', remark: 'Very good', sortOrder: 1 },
  { minScore: '70.00', maxScore: '74.99', gradeLabel: 'B3', remark: 'Good', sortOrder: 2 },
  { minScore: '65.00', maxScore: '69.99', gradeLabel: 'C4', remark: 'Credit', sortOrder: 3 },
  { minScore: '60.00', maxScore: '64.99', gradeLabel: 'C5', remark: 'Credit', sortOrder: 4 },
  { minScore: '55.00', maxScore: '59.99', gradeLabel: 'C6', remark: 'Credit', sortOrder: 5 },
  { minScore: '50.00', maxScore: '54.99', gradeLabel: 'D7', remark: 'Pass', sortOrder: 6 },
  { minScore: '45.00', maxScore: '49.99', gradeLabel: 'E8', remark: 'Pass', sortOrder: 7 },
  { minScore: '0.00', maxScore: '44.99', gradeLabel: 'F9', remark: 'Needs support', sortOrder: 8 },
]

/** Editable example: 40% continuous assessment and 60% examination. */
export const EXAMPLE_POLICY_COMPONENTS: AssessmentComponentInput[] = [
  {
    key: 'class-test',
    name: 'Class test',
    category: 'SBA',
    maximumScore: '20.00',
    weightPercent: '20.00',
    sortOrder: 0,
  },
  {
    key: 'project',
    name: 'Project',
    category: 'SBA',
    maximumScore: '10.00',
    weightPercent: '10.00',
    sortOrder: 1,
  },
  {
    key: 'homework',
    name: 'Homework',
    category: 'SBA',
    maximumScore: '10.00',
    weightPercent: '10.00',
    sortOrder: 2,
  },
  {
    key: 'examination',
    name: 'Examination',
    category: 'EXAM',
    maximumScore: '100.00',
    weightPercent: '60.00',
    sortOrder: 3,
  },
]

/**
 * Wise Grade's automatic NaCCA-aligned standard policy. The four SBA components
 * are summed into one Class Score out of 60 before being scaled to 30 marks;
 * they are never scaled independently. The examination is scaled from 100 to
 * 70 marks.
 *
 * The per-component weights total 100 and describe the group contributions
 * (four equal shares of the 30-mark SBA group plus the 70-mark examination
 * group). GROUPED_SBA calculation uses only the category sums.
 */
export const STANDARD_POLICY_NAME = 'Wise Grade Standard Assessment Policy'

export const STANDARD_POLICY_DESCRIPTION =
  'Automatically provided NaCCA standard: Individual Test /15, Group Work /15, Class Test /15 and Project /15 form a Class Score /60 scaled to 30%; the Examination /100 is scaled to 70%.'

export const STANDARD_GRADING_SCHEME_NAME = 'Wise Grade Standard Grading Scheme'

export const STANDARD_GRADING_SCHEME_DESCRIPTION =
  'Automatically created standard grading scale. Schools may replace it with their own approved grading scheme.'

export const STANDARD_ASSESSMENT_COMPONENTS: AssessmentComponentInput[] = [
  {
    key: 'individual-test',
    name: 'Individual Test',
    category: 'SBA',
    maximumScore: '15.00',
    weightPercent: '7.50',
    sortOrder: 0,
  },
  {
    key: 'group-work',
    name: 'Group Work',
    category: 'SBA',
    maximumScore: '15.00',
    weightPercent: '7.50',
    sortOrder: 1,
  },
  {
    key: 'class-test',
    name: 'Class Test',
    category: 'SBA',
    maximumScore: '15.00',
    weightPercent: '7.50',
    sortOrder: 2,
  },
  {
    key: 'project',
    name: 'Project',
    category: 'SBA',
    maximumScore: '15.00',
    weightPercent: '7.50',
    sortOrder: 3,
  },
  {
    key: 'examination',
    name: 'Examination',
    category: 'EXAM',
    maximumScore: '100.00',
    weightPercent: '70.00',
    sortOrder: 4,
  },
]

