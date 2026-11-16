import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_SCHOOL_LOGO_BYTES,
  normalizeGhanaMobile,
  validateRegistration,
  validateSchoolLogoFile,
} from '../src/lib/validation.ts'
import { schoolLogoSrc } from '../src/schools/logo.ts'

function logoFile(
  type = 'image/png',
  size = 8,
  name = 'school-logo.png',
): File {
  return new File([new Uint8Array(size)], name, { type })
}

function validValues() {
  return {
    schoolName: 'Green Valley Academy',
    firstName: 'Ada',
    lastName: 'Obi',
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    confirmPassword: 'correct-horse-battery',
    landmark: 'Opposite the central market',
    address: 'P.O. Box 123, Accra',
    phone: '024 000 0000',
    logo: logoFile(),
  }
}

describe('Ghana mobile validation', () => {
  it('normalizes local and international Ghana mobile numbers', () => {
    assert.equal(normalizeGhanaMobile('024 000 0000'), '+233240000000')
    assert.equal(normalizeGhanaMobile('+233240000000'), '+233240000000')
    assert.equal(normalizeGhanaMobile('233240000000'), '+233240000000')
    assert.equal(normalizeGhanaMobile('00233240000000'), '+233240000000')
    assert.equal(normalizeGhanaMobile('(020) 123-4567'), '+233201234567')
  })

  it('rejects numbers that are not Ghana mobile numbers', () => {
    for (const value of ['', '12345', '024000000', '0440000000', 'nope']) {
      assert.equal(normalizeGhanaMobile(value), null)
    }
  })
})

describe('school logo file validation', () => {
  it('requires a logo file', () => {
    assert.equal(validateSchoolLogoFile(null), 'School logo is required')
  })

  it('accepts PNG, JPEG and WebP files', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      assert.equal(validateSchoolLogoFile(logoFile(type)), null)
    }
  })

  it('rejects unsupported file types', () => {
    assert.equal(
      validateSchoolLogoFile(logoFile('image/gif', 8, 'logo.gif')),
      'Logo must be a PNG, JPEG or WebP image',
    )
  })

  it('rejects files larger than 2 MB', () => {
    assert.equal(
      validateSchoolLogoFile(logoFile('image/png', MAX_SCHOOL_LOGO_BYTES + 1)),
      'Logo must be 2 MB or smaller',
    )
    assert.equal(
      validateSchoolLogoFile(logoFile('image/png', MAX_SCHOOL_LOGO_BYTES)),
      null,
    )
  })
})

describe('school dashboard logo source', () => {
  const logoUrl = '/api/schools/school-1/profile/logo?v=1'

  it('uses the uploaded logo instead of initials when a logo exists', () => {
    assert.equal(schoolLogoSrc(logoUrl, null), logoUrl)
  })

  it('falls back to initials when the school has no logo', () => {
    assert.equal(schoolLogoSrc(null, null), null)
  })

  it('falls back only for the URL that failed to load', () => {
    assert.equal(schoolLogoSrc(logoUrl, logoUrl), null)
  })

  it('retries immediately when a replacement logo gets a new URL', () => {
    const replacementUrl = '/api/schools/school-1/profile/logo?v=2'

    assert.equal(schoolLogoSrc(replacementUrl, logoUrl), replacementUrl)
  })
})

describe('school registration branding validation', () => {
  it('accepts a complete registration', () => {
    assert.deepEqual(validateRegistration(validValues()), {})
  })

  it('requires the school logo before submitting', () => {
    const errors = validateRegistration({ ...validValues(), logo: null })

    assert.equal(errors.logo, 'School logo is required')
  })

  it('requires the landmark, postal address and mobile number', () => {
    const errors = validateRegistration({
      ...validValues(),
      landmark: '',
      address: '',
      phone: '',
    })

    assert.equal(errors.landmark, 'Landmark is required')
    assert.equal(errors.address, 'Postal address is required')
    assert.equal(errors.phone, 'Mobile number is required')
  })

  it('rejects an invalid Ghana mobile number', () => {
    const errors = validateRegistration({ ...validValues(), phone: '12345' })

    assert.match(errors.phone ?? '', /Ghana mobile number/)
  })

  it('rejects a logo with an unsupported type or excessive size', () => {
    const wrongType = validateRegistration({
      ...validValues(),
      logo: logoFile('image/gif', 8, 'logo.gif'),
    })
    assert.equal(wrongType.logo, 'Logo must be a PNG, JPEG or WebP image')

    const oversized = validateRegistration({
      ...validValues(),
      logo: logoFile('image/png', MAX_SCHOOL_LOGO_BYTES + 1),
    })
    assert.equal(oversized.logo, 'Logo must be 2 MB or smaller')
  })
})
