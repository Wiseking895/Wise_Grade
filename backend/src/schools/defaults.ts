export interface DefaultClass {
  name: string
  level: string
  sortOrder: number
}

/**
 * Ghanaian basic-school class structure. Schools may add custom classes on top
 * of these defaults.
 */
export const DEFAULT_CLASSES: DefaultClass[] = [
  { name: 'Creche', level: 'CRECHE', sortOrder: 10 },
  { name: 'Nursery 1', level: 'NURSERY', sortOrder: 20 },
  { name: 'Nursery 2', level: 'NURSERY', sortOrder: 30 },
  { name: 'KG 1', level: 'KINDERGARTEN', sortOrder: 40 },
  { name: 'KG 2', level: 'KINDERGARTEN', sortOrder: 50 },
  { name: 'Basic 1', level: 'BASIC', sortOrder: 60 },
  { name: 'Basic 2', level: 'BASIC', sortOrder: 70 },
  { name: 'Basic 3', level: 'BASIC', sortOrder: 80 },
  { name: 'Basic 4', level: 'BASIC', sortOrder: 90 },
  { name: 'Basic 5', level: 'BASIC', sortOrder: 100 },
  { name: 'Basic 6', level: 'BASIC', sortOrder: 110 },
]

/** Ghanaian schools operate on Ghana Mean Time. */
export const DEFAULT_SCHOOL_TIMEZONE = 'Africa/Accra'

