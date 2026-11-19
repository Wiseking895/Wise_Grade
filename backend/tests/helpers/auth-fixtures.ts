import { randomInt } from 'node:crypto'
import { tinyPng } from './png.js'

export const TEST_ORIGIN = 'http://localhost:5173'

export const TEST_PASSWORD = 'correct-horse-battery'

const TEST_LOGO_BASE64 = tinyPng(8).toString('base64')

/**
 * Phone numbers are now unique platform-wide. Integration suites register
 * several schools in one database, so the shared fixture must produce a fresh
 * canonical Ghanaian mobile number for each registration. Tests that assert a
 * specific number can still pass one explicitly through `overrides`.
 */
function uniqueTestPhone(): string {
  const national = `2${String(randomInt(0, 100_000_000)).padStart(8, '0')}`
  return `0${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`
}

export function registrationBody(
  overrides: Partial<{
    schoolName: string
    firstName: string
    lastName: string
    email: string
    password: string
    landmark: string
    address: string
    phone: string
    logo: {
      mimeType: string
      base64: string
      originalName?: string
    }
  }> = {},
) {
  return {
    schoolName: 'Green Valley Academy',
    firstName: 'Ada',
    lastName: 'Obi',
    email: 'ada@example.com',
    password: TEST_PASSWORD,
    landmark: 'Opposite the central market',
    address: 'P.O. Box 123, Accra',
    phone: uniqueTestPhone(),
    logo: {
      mimeType: 'image/png',
      base64: TEST_LOGO_BASE64,
      originalName: 'school-logo.png',
    },
    ...overrides,
  }
}
