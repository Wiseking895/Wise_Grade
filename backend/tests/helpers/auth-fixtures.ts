import { tinyPng } from './png.js'

export const TEST_ORIGIN = 'http://localhost:5173'

export const TEST_PASSWORD = 'correct-horse-battery'

const TEST_LOGO_BASE64 = tinyPng(8).toString('base64')

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
    phone: '024 000 0000',
    logo: {
      mimeType: 'image/png',
      base64: TEST_LOGO_BASE64,
      originalName: 'school-logo.png',
    },
    ...overrides,
  }
}
