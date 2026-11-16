import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  academicStartYearFor,
  buildAcademicYearPlan,
  todayInCalendar,
} from '../src/calendar/logic.js'
import {
  decodePupilPhotoUpload,
  decodeSchoolLogo,
  decodeSignatureUpload,
  isSchoolIdentityComplete,
  MAX_PUPIL_PHOTO_BYTES,
  MAX_SCHOOL_LOGO_BYTES,
  MAX_SIGNATURE_BYTES,
  missingSchoolIdentityFields,
  normalizeGhanaMobile,
  pupilPhotoStorageKey,
  schoolLogoStorageKey,
  schoolLogoUrl,
  signatureStorageKey,
} from '../src/lib/school-branding.js'
import {
  MemoryStorageAdapter,
  type StoredObjectMetadata,
} from '../src/storage/storage.js'
import { SESSION_COOKIE_NAME } from '../src/lib/cookies.js'
import {
  registrationBody,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'
import { tinyPng } from './helpers/png.js'

const VALID_PNG = tinyPng(8)

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
])

const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
])

/** Records every write so tests can assert private storage side effects. */
class RecordingStorage extends MemoryStorageAdapter {
  readonly writtenKeys = new Set<string>()

  override async putObject(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<StoredObjectMetadata> {
    this.writtenKeys.add(key)
    return super.putObject(key, data, contentType)
  }

  override async deleteObject(key: string): Promise<void> {
    this.writtenKeys.delete(key)
    return super.deleteObject(key)
  }
}

describe('school branding helpers', () => {
  it('normalizes Ghana mobile numbers to the canonical +233 form', () => {
    expect(normalizeGhanaMobile('024 000 0000')).toBe('+233240000000')
    expect(normalizeGhanaMobile('0240000000')).toBe('+233240000000')
    expect(normalizeGhanaMobile('+233 24 000 0000')).toBe('+233240000000')
    expect(normalizeGhanaMobile('233240000000')).toBe('+233240000000')
    expect(normalizeGhanaMobile('00233240000000')).toBe('+233240000000')
    expect(normalizeGhanaMobile('(020) 123-4567')).toBe('+233201234567')
  })

  it('rejects numbers that are not Ghana mobile numbers', () => {
    for (const value of [
      '',
      '12345',
      '024000000',
      '02400000000',
      '0440000000',
      '+1 555 010 0000',
      'not-a-number',
    ]) {
      expect(() => normalizeGhanaMobile(value)).toThrow(
        'Enter a valid Ghana mobile number',
      )
    }
  })

  it('accepts PNG, JPEG and WebP logos and strips data URL prefixes', () => {
    const png = decodeSchoolLogo({
      mimeType: 'image/png',
      base64: `data:image/png;base64,${VALID_PNG.toString('base64')}`,
    })
    expect(png.mimeType).toBe('image/png')
    expect(png.extension).toBe('png')
    expect(png.data.equals(VALID_PNG)).toBe(true)

    const jpeg = decodeSchoolLogo({
      mimeType: 'image/jpeg',
      base64: JPEG_BYTES.toString('base64'),
    })
    expect(jpeg.extension).toBe('jpg')

    const webp = decodeSchoolLogo({
      mimeType: 'image/webp',
      base64: WEBP_BYTES.toString('base64'),
    })
    expect(webp.extension).toBe('webp')
  })

  it('rejects unsupported types, invalid base64 and mismatched magic bytes', () => {
    expect(() =>
      decodeSchoolLogo({ mimeType: 'image/gif', base64: 'AAAA' }),
    ).toThrow('School logo must be a PNG, JPEG or WebP image')

    expect(() =>
      decodeSchoolLogo({ mimeType: 'image/png', base64: 'not base64!' }),
    ).toThrow('The school logo upload is not valid base64 data')

    expect(() =>
      decodeSchoolLogo({ mimeType: 'image/png', base64: '' }),
    ).toThrow('The school logo upload is not valid base64 data')

    // A client-declared type alone is never trusted: the bytes must match.
    expect(() =>
      decodeSchoolLogo({
        mimeType: 'image/jpeg',
        base64: VALID_PNG.toString('base64'),
      }),
    ).toThrow('The uploaded file does not match the declared image type')
  })

  it('enforces the 2 MB logo limit before decoding image content', () => {
    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_SCHOOL_LOGO_BYTES),
    ])

    expect(() =>
      decodeSchoolLogo({
        mimeType: 'image/png',
        base64: oversized.toString('base64'),
      }),
    ).toThrow('School logos must be 2 MB or smaller')
  })

  it('validates administrator signatures and pupil photographs with their own limits', () => {
    const signature = decodeSignatureUpload({
      mimeType: 'image/png',
      base64: `data:image/png;base64,${VALID_PNG.toString('base64')}`,
    })
    expect(signature.mimeType).toBe('image/png')
    expect(signature.extension).toBe('png')
    expect(signature.data.equals(VALID_PNG)).toBe(true)

    expect(() =>
      decodeSignatureUpload({ mimeType: 'image/gif', base64: 'AAAA' }),
    ).toThrow('Signature must be a PNG, JPEG or WebP image')

    expect(() =>
      decodeSignatureUpload({ mimeType: 'image/png', base64: 'not base64!' }),
    ).toThrow('The signature upload is not valid base64 data')

    expect(() =>
      decodeSignatureUpload({
        mimeType: 'image/jpeg',
        base64: VALID_PNG.toString('base64'),
      }),
    ).toThrow('The uploaded file does not match the declared image type')

    const oversizedSignature = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_SIGNATURE_BYTES),
    ])
    expect(() =>
      decodeSignatureUpload({
        mimeType: 'image/png',
        base64: oversizedSignature.toString('base64'),
      }),
    ).toThrow('Signatures must be 1 MB or smaller')

    const photo = decodePupilPhotoUpload({
      mimeType: 'image/jpeg',
      base64: JPEG_BYTES.toString('base64'),
    })
    expect(photo.mimeType).toBe('image/jpeg')
    expect(photo.extension).toBe('jpg')
    expect(photo.data.equals(JPEG_BYTES)).toBe(true)

    const webpPhoto = decodePupilPhotoUpload({
      mimeType: 'image/webp',
      base64: WEBP_BYTES.toString('base64'),
    })
    expect(webpPhoto.extension).toBe('webp')

    expect(() =>
      decodePupilPhotoUpload({ mimeType: 'image/gif', base64: 'AAAA' }),
    ).toThrow('Pupil photograph must be a PNG, JPEG or WebP image')

    const oversizedPhoto = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_PUPIL_PHOTO_BYTES),
    ])
    expect(() =>
      decodePupilPhotoUpload({
        mimeType: 'image/png',
        base64: oversizedPhoto.toString('base64'),
      }),
    ).toThrow('Pupil photographs must be 5 MB or smaller')
  })

  it('keeps signature and pupil-photo keys scoped to their owners', () => {
    const signatureKey = signatureStorageKey('school-a', 'png')
    expect(signatureKey).toMatch(
      /^schools\/school-a\/signature\/[0-9a-f-]+\.png$/,
    )
    expect(signatureStorageKey('school-a', 'png')).not.toBe(signatureKey)

    const photoKey = pupilPhotoStorageKey('school-a', 'pupil-1', 'webp')
    expect(photoKey).toMatch(
      /^schools\/school-a\/pupils\/pupil-1\/photo\/[0-9a-f-]+\.webp$/,
    )
    expect(pupilPhotoStorageKey('school-a', 'pupil-2', 'webp')).not.toBe(
      photoKey,
    )
    expect(pupilPhotoStorageKey('school-b', 'pupil-1', 'webp')).toContain(
      'schools/school-b/pupils/pupil-1/photo/',
    )
  })

  it('generates unique school-scoped private storage keys', () => {
    const first = schoolLogoStorageKey('school-a', 'png')
    const second = schoolLogoStorageKey('school-a', 'png')

    expect(first).toMatch(/^schools\/school-a\/school-logo\/[0-9a-f-]+\.png$/)
    expect(second).not.toBe(first)
    expect(schoolLogoStorageKey('school-b', 'webp')).toContain(
      'schools/school-b/school-logo/',
    )
  })

  it('reports exactly which school identity fields are missing', () => {
    const complete = {
      logoObjectKey: 'schools/school-1/school-logo/logo.png',
      landmark: 'Opposite the market',
      address: 'P.O. Box 1, Accra',
      phone: '+233240000000',
    }

    expect(isSchoolIdentityComplete(complete)).toBe(true)
    expect(missingSchoolIdentityFields(complete)).toEqual([])
    expect(
      missingSchoolIdentityFields({
        logoObjectKey: null,
        landmark: '   ',
        address: null,
        phone: '',
      }),
    ).toEqual(['school logo', 'landmark', 'postal address', 'mobile number'])
  })

  it('builds a private, cache-busted logo URL only when a logo exists', () => {
    expect(schoolLogoUrl('school-1', null)).toBeNull()

    const updatedAt = new Date('2026-11-09T12:00:00.000Z')
    expect(schoolLogoUrl('school-1', updatedAt)).toBe(
      `/api/schools/school-1/profile/logo?v=${updatedAt.getTime()}`,
    )
  })
})

describe('school registration branding', () => {
  let auth: FakeAuthRepository
  let storage: RecordingStorage
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    auth = new FakeAuthRepository()
    storage = new RecordingStorage()
    app = createApp({ authRepository: auth, reportStorage: storage })
  })

  function register(body: object = registrationBody()) {
    return request(app)
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(body)
  }

  it('persists required identity and stores the logo privately', async () => {
    const response = await register()

    expect(response.status).toBe(201)
    const schoolId = response.body.data.school.id as string
    const stored = auth.schools.get(schoolId)

    expect(stored).toMatchObject({
      landmark: 'Opposite the central market',
      address: 'P.O. Box 123, Accra',
      phone: '+233240000000',
      logoMimeType: 'image/png',
    })
    expect(stored?.logoObjectKey).toMatch(
      new RegExp(`^schools/${schoolId}/school-logo/[0-9a-f-]+\\.png$`),
    )
    expect(storage.writtenKeys.has(stored!.logoObjectKey!)).toBe(true)
    expect((await storage.getObject(stored!.logoObjectKey!))?.equals(VALID_PNG)).toBe(
      true,
    )

    // The API returns a private streaming URL, never the storage key.
    expect(response.body.data.school).toMatchObject({
      landmark: 'Opposite the central market',
      address: 'P.O. Box 123, Accra',
      phone: '+233240000000',
      profileComplete: true,
    })
    expect(response.body.data.school.logoUrl).toContain(
      `/api/schools/${schoolId}/profile/logo`,
    )
    expect(response.body.data.school).not.toHaveProperty('logoObjectKey')
    expect(JSON.stringify(response.body)).not.toContain('school-logo')
  })

  it.each([
    ['landmark', { landmark: '' }, 'landmark'],
    ['postal address', { address: '' }, 'address'],
    ['mobile number', { phone: '' }, 'phone'],
  ])('requires a %s during registration', async (_label, override, field) => {
    const response = await register(registrationBody(override))

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    )
    expect(auth.schools.size).toBe(0)
    expect(storage.writtenKeys.size).toBe(0)
  })

  it('requires a school logo during registration', async () => {
    const body = registrationBody()
    delete (body as { logo?: unknown }).logo

    const response = await register(body)

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'logo' })]),
    )
    expect(auth.schools.size).toBe(0)
  })

  it('rejects invalid Ghana mobile numbers', async () => {
    const response = await register(registrationBody({ phone: '12345' }))

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'phone',
          message: expect.stringContaining('Ghana mobile number'),
        }),
      ]),
    )
    expect(auth.schools.size).toBe(0)
  })

  it('rejects an unsupported logo type before creating a school', async () => {
    const response = await register(
      registrationBody({
        logo: { mimeType: 'image/gif', base64: VALID_PNG.toString('base64') },
      }),
    )

    expect(response.status).toBe(400)
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'logo.mimeType' })]),
    )
    expect(auth.schools.size).toBe(0)
  })

  it('rejects logo bytes that do not match the declared image type', async () => {
    const response = await register(
      registrationBody({
        logo: {
          mimeType: 'image/jpeg',
          base64: VALID_PNG.toString('base64'),
        },
      }),
    )

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe(
      'The uploaded file does not match the declared image type',
    )
    expect(auth.schools.size).toBe(0)
    expect(storage.writtenKeys.size).toBe(0)
  })

  it('rejects oversized logos and leaves no orphaned upload', async () => {
    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_SCHOOL_LOGO_BYTES),
    ])
    const response = await register(
      registrationBody({
        logo: {
          mimeType: 'image/png',
          base64: oversized.toString('base64'),
        },
      }),
    )

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('School logos must be 2 MB or smaller')
    expect(auth.schools.size).toBe(0)
    expect(storage.writtenKeys.size).toBe(0)
  })

  it('removes the uploaded logo when school creation fails', async () => {
    auth.failNextSchoolCreation = true

    const response = await register()

    expect(response.status).toBe(500)
    expect(auth.schools.size).toBe(0)
    expect(storage.writtenKeys.size).toBe(0)
  })
})

describe('school profile branding routes', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let storage: RecordingStorage
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    storage = new RecordingStorage()
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      reportStorage: storage,
    })
  })

  interface ProfileContext {
    agent: ReturnType<typeof request.agent>
    schoolId: string
  }

  async function registerProfile(
    overrides: Parameters<typeof registrationBody>[0] = {},
  ): Promise<ProfileContext> {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody(overrides))

    expect(response.status).toBe(201)

    const schoolId = response.body.data.school.id as string
    const stored = auth.schools.get(schoolId)!

    schools.seedSchool({
      id: schoolId,
      name: stored.name,
      slug: stored.slug,
      email: stored.email,
      phone: stored.phone,
      address: stored.address,
      landmark: stored.landmark,
      logoObjectKey: stored.logoObjectKey,
      logoMimeType: stored.logoMimeType,
      logoUpdatedAt: stored.logoUpdatedAt,
    })

    return { agent, schoolId }
  }

  async function loginAs(
    email: string,
    role: 'CLASS_TEACHER' | 'SUBJECT_TEACHER',
    schoolId: string,
  ) {
    const user = await auth.createUser({ email, password: TEST_PASSWORD })
    await auth.addMembership(user.id, schoolId, role)
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })

    expect(response.status).toBe(200)
    return agent
  }

  function uploadLogo(agent: ReturnType<typeof request.agent>, schoolId: string) {
    return agent
      .post(`/api/schools/${schoolId}/profile/logo`)
      .set('Origin', TEST_ORIGIN)
      .send({
        logo: {
          mimeType: 'image/png',
          base64: VALID_PNG.toString('base64'),
          originalName: 'replacement-logo.png',
        },
      })
  }

  it('exposes the school logo, landmark and completeness without leaking storage keys', async () => {
    const { agent, schoolId } = await registerProfile()

    const response = await agent.get(`/api/schools/${schoolId}/profile`)

    expect(response.status).toBe(200)
    expect(response.body.data.school).toMatchObject({
      id: schoolId,
      landmark: 'Opposite the central market',
      address: 'P.O. Box 123, Accra',
      phone: '+233240000000',
      profileComplete: true,
    })
    expect(response.body.data.school.logoUrl).toContain(
      `/api/schools/${schoolId}/profile/logo`,
    )
    expect(response.body.data.school.logoUpdatedAt).toBeTruthy()
    expect(response.body.data.school).not.toHaveProperty('logoObjectKey')
    expect(response.body.data.school).not.toHaveProperty('logoMimeType')
    expect(JSON.stringify(response.body)).not.toContain('school-logo')
  })

  it('streams the authenticated school logo with private caching headers', async () => {
    const { agent, schoolId } = await registerProfile()

    const response = await agent.get(`/api/schools/${schoolId}/profile/logo`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['cache-control']).toBe('private, max-age=300')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(response.body).equals(VALID_PNG)).toBe(true)
  })

  it('serves the logo as a credentialed CORS resource for the web app', async () => {
    const { agent, schoolId } = await registerProfile()

    const response = await agent
      .get(`/api/schools/${schoolId}/profile/logo`)
      .set('Origin', TEST_ORIGIN)

    expect(response.status).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(TEST_ORIGIN)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
    // Helmet keeps a strict CORP default; the dashboard therefore uses a
    // credentialed CORS image request instead of a plain no-cors <img>.
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
  })

  it('requires an authenticated session to read the logo', async () => {
    const { schoolId } = await registerProfile()

    expect(
      (await request(app).get(`/api/schools/${schoolId}/profile`)).status,
    ).toBe(401)
    expect(
      (await request(app).get(`/api/schools/${schoolId}/profile/logo`)).status,
    ).toBe(401)
  })

  it('rejects an expired session instead of serving a cached logo', async () => {
    const { schoolId } = await registerProfile()
    const user = auth.getUserSnapshot('ada@example.com')
    expect(user).toBeTruthy()

    const token = await auth.issueSessionFor(user!.id, {
      expiresAt: new Date(Date.now() - 60_000),
    })
    const response = await request(app)
      .get(`/api/schools/${schoolId}/profile/logo`)
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)

    expect(response.status).toBe(401)
  })

  it('returns no logo URL and a 404 when the school has no uploaded logo', async () => {
    const { agent, schoolId } = await registerProfile()
    const profile = schools.profiles.get(schoolId)!

    // Simulate a school that has never uploaded a logo.
    schools.logos.delete(schoolId)
    profile.logoUrl = null
    profile.logoUpdatedAt = null
    profile.profileComplete = false

    const response = await agent.get(`/api/schools/${schoolId}/profile`)
    expect(response.status).toBe(200)
    expect(response.body.data.school.logoUrl).toBeNull()
    expect(response.body.data.school.logoUpdatedAt).toBeNull()

    const logo = await agent.get(`/api/schools/${schoolId}/profile/logo`)
    expect(logo.status).toBe(404)
  })

  it('lets only a school administrator replace the logo', async () => {
    const { agent, schoolId } = await registerProfile()
    const before = await agent.get(`/api/schools/${schoolId}/profile`)
    const teacher = await loginAs(
      'teacher@greenvalley.test',
      'CLASS_TEACHER',
      schoolId,
    )

    const teacherUpload = await uploadLogo(teacher, schoolId)
    expect(teacherUpload.status).toBe(403)

    const teacherProfileUpdate = await teacher
      .patch(`/api/schools/${schoolId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ landmark: 'Teacher landmark' })
    expect(teacherProfileUpdate.status).toBe(403)

    // Members may still read the profile and logo.
    expect((await teacher.get(`/api/schools/${schoolId}/profile`)).status).toBe(
      200,
    )
    expect((await teacher.get(`/api/schools/${schoolId}/profile/logo`)).status).toBe(
      200,
    )

    const after = await agent.get(`/api/schools/${schoolId}/profile`)
    expect(after.body.data.school.logoUrl).toBe(
      before.body.data.school.logoUrl,
    )
  })

  it('stores a replacement logo under the school scope and keeps the old object', async () => {
    const { agent, schoolId } = await registerProfile()
    const before = await agent.get(`/api/schools/${schoolId}/profile`)
    const oldKey = auth.schools.get(schoolId)!.logoObjectKey!
    const oldLogoUrl = before.body.data.school.logoUrl as string

    const response = await uploadLogo(agent, schoolId)

    expect(response.status).toBe(200)
    expect(response.body.data.school.logoUrl).not.toBe(oldLogoUrl)
    expect(response.body.data.school.logoUrl).toContain(
      `/api/schools/${schoolId}/profile/logo`,
    )
    expect(response.body.data.school).not.toHaveProperty('logoObjectKey')

    const stored = schools.logos.get(schoolId)!
    expect(stored.storageKey).toMatch(
      new RegExp(`^schools/${schoolId}/school-logo/[0-9a-f-]+\\.png$`),
    )
    expect(stored.storageKey).not.toBe(oldKey)
    expect(storage.writtenKeys.has(stored.storageKey)).toBe(true)
    // Historical report snapshots may still reference the previous object.
    expect(await storage.getObject(oldKey)).not.toBeNull()
    expect(schools.auditActions()).toContain('SCHOOL_LOGO_UPDATED')
  })

  it('keeps the previous logo when a replacement upload is invalid', async () => {
    const { agent, schoolId } = await registerProfile()
    const before = await agent.get(`/api/schools/${schoolId}/profile`)
    const beforeKey = schools.logos.get(schoolId)!.storageKey
    const writesBefore = new Set(storage.writtenKeys)

    const response = await agent
      .post(`/api/schools/${schoolId}/profile/logo`)
      .set('Origin', TEST_ORIGIN)
      .send({
        logo: {
          mimeType: 'image/png',
          base64: Buffer.from('not an image').toString('base64'),
        },
      })

    expect(response.status).toBe(400)
    expect(schools.logos.get(schoolId)!.storageKey).toBe(beforeKey)

    const after = await agent.get(`/api/schools/${schoolId}/profile`)
    expect(after.body.data.school.logoUrl).toBe(
      before.body.data.school.logoUrl,
    )
    expect(new Set(storage.writtenKeys)).toEqual(writesBefore)
  })

  it('updates the landmark and re-evaluates profile completeness', async () => {
    const { agent, schoolId } = await registerProfile()

    const response = await agent
      .patch(`/api/schools/${schoolId}`)
      .set('Origin', TEST_ORIGIN)
      .send({ landmark: 'Behind the community library' })

    expect(response.status).toBe(200)
    expect(response.body.data.school).toMatchObject({
      landmark: 'Behind the community library',
      profileComplete: true,
    })
    expect(schools.auditActions()).toContain('SCHOOL_PROFILE_UPDATED')
  })

  it('isolates logos per school and blocks cross-school access', async () => {
    const first = await registerProfile({
      schoolName: 'Green Valley Academy',
      email: 'admin@greenvalley.test',
    })
    const second = await registerProfile({
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })

    const firstProfile = await first.agent.get(
      `/api/schools/${first.schoolId}/profile`,
    )
    const secondProfile = await second.agent.get(
      `/api/schools/${second.schoolId}/profile`,
    )

    expect(firstProfile.body.data.school.logoUrl).toContain(
      `/api/schools/${first.schoolId}/profile/logo`,
    )
    expect(secondProfile.body.data.school.logoUrl).toContain(
      `/api/schools/${second.schoolId}/profile/logo`,
    )
    expect(firstProfile.body.data.school.logoUrl).not.toBe(
      secondProfile.body.data.school.logoUrl,
    )

    const firstKey = schools.logos.get(first.schoolId)!.storageKey
    const secondKey = schools.logos.get(second.schoolId)!.storageKey
    expect(firstKey).toContain(`schools/${first.schoolId}/`)
    expect(secondKey).toContain(`schools/${second.schoolId}/`)
    expect(firstKey).not.toBe(secondKey)

    // A member of one school can never read or mutate another school's logo.
    expect(
      (await first.agent.get(`/api/schools/${second.schoolId}/profile`)).status,
    ).toBe(403)
    expect(
      (
        await first.agent.get(
          `/api/schools/${second.schoolId}/profile/logo`,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await first.agent
          .post(`/api/schools/${second.schoolId}/profile/logo`)
          .set('Origin', TEST_ORIGIN)
          .send({
            logo: {
              mimeType: 'image/png',
              base64: VALID_PNG.toString('base64'),
            },
          })
      ).status,
    ).toBe(403)

    // The second school's logo is unchanged after the rejected attempt.
    expect(schools.logos.get(second.schoolId)!.storageKey).toBe(secondKey)
  })
})

describe('school administrator signature routes', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let storage: RecordingStorage
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    storage = new RecordingStorage()
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      reportStorage: storage,
    })
  })

  interface SignatureContext {
    agent: ReturnType<typeof request.agent>
    schoolId: string
    adminUserId: string
  }

  async function registerProfile(
    overrides: Parameters<typeof registrationBody>[0] = {},
  ): Promise<SignatureContext> {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody(overrides))

    expect(response.status).toBe(201)

    const schoolId = response.body.data.school.id as string
    const adminUserId = response.body.data.user.id as string
    const stored = auth.schools.get(schoolId)!

    schools.seedSchool({
      id: schoolId,
      name: stored.name,
      slug: stored.slug,
      email: stored.email,
      phone: stored.phone,
      address: stored.address,
      landmark: stored.landmark,
      logoObjectKey: stored.logoObjectKey,
      logoMimeType: stored.logoMimeType,
      logoUpdatedAt: stored.logoUpdatedAt,
    })

    return { agent, schoolId, adminUserId }
  }

  async function loginAs(
    email: string,
    role: 'CLASS_TEACHER' | 'SUBJECT_TEACHER',
    schoolId: string,
  ) {
    const user = await auth.createUser({ email, password: TEST_PASSWORD })
    await auth.addMembership(user.id, schoolId, role)
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })

    expect(response.status).toBe(200)
    return agent
  }

  function uploadSignature(
    agent: ReturnType<typeof request.agent>,
    schoolId: string,
    options: {
      bytes?: Buffer
      mimeType?: string
      name?: string
      designation?: string
    } = {},
  ) {
    return agent
      .post(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({
        signature: {
          mimeType: options.mimeType ?? 'image/png',
          base64: (options.bytes ?? VALID_PNG).toString('base64'),
          originalName: 'headteacher-signature.png',
        },
        name: options.name ?? 'Ama Serwaa',
        designation: options.designation ?? 'Headteacher',
      })
  }

  it('stores, updates and streams the administrator signature privately', async () => {
    const { agent, schoolId } = await registerProfile()

    const response = await uploadSignature(agent, schoolId)

    expect(response.status).toBe(200)
    expect(response.body.data.signature).toMatchObject({
      hasSignature: true,
      mimeType: 'image/png',
      name: 'Ama Serwaa',
      designation: 'Headteacher',
    })
    expect(response.body.data.signature.url).toMatch(
      new RegExp(
        `^/api/schools/${schoolId}/profile/signature/file\\?v=\\d+$`,
      ),
    )

    const stored = schools.signatures.get(schoolId)!
    expect(stored.storageKey).toMatch(
      new RegExp(`^schools/${schoolId}/signature/[0-9a-f-]+\\.png$`),
    )
    expect(storage.writtenKeys.has(stored.storageKey)).toBe(true)
    expect((await storage.getObject(stored.storageKey))?.equals(VALID_PNG)).toBe(
      true,
    )
    // Only the private streaming URL crosses the API boundary.
    expect(response.body.data.signature).not.toHaveProperty('storageKey')
    expect(JSON.stringify(response.body)).not.toContain(stored.storageKey)

    const metadata = await agent.get(
      `/api/schools/${schoolId}/profile/signature`,
    )
    expect(metadata.status).toBe(200)
    expect(metadata.body.data.signature.hasSignature).toBe(true)
    expect(metadata.body.data.signature.name).toBe('Ama Serwaa')

    const file = await agent.get(
      `/api/schools/${schoolId}/profile/signature/file`,
    )
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('image/png')
    expect(file.headers['cache-control']).toBe('private, no-store')
    expect(file.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(file.body).equals(VALID_PNG)).toBe(true)

    expect(schools.auditActions()).toContain('SCHOOL_SIGNATURE_UPDATED')
  })

  it('replaces the signature but keeps the previous private object for historical reports', async () => {
    const { agent, schoolId } = await registerProfile()

    expect((await uploadSignature(agent, schoolId)).status).toBe(200)
    const firstKey = schools.signatures.get(schoolId)!.storageKey

    const replacement = await uploadSignature(agent, schoolId, {
      bytes: JPEG_BYTES,
      mimeType: 'image/jpeg',
      name: 'Kojo Mensah',
      designation: 'Headmaster',
    })
    expect(replacement.status).toBe(200)

    const secondKey = schools.signatures.get(schoolId)!.storageKey
    expect(secondKey).toMatch(
      new RegExp(`^schools/${schoolId}/signature/[0-9a-f-]+\\.jpg$`),
    )
    expect(secondKey).not.toBe(firstKey)
    expect(storage.writtenKeys.has(firstKey)).toBe(true)
    expect(storage.writtenKeys.has(secondKey)).toBe(true)
    // Released report snapshots may still point at the first object.
    expect(await storage.getObject(firstKey)).not.toBeNull()

    const file = await agent.get(
      `/api/schools/${schoolId}/profile/signature/file`,
    )
    expect(file.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.from(file.body).equals(JPEG_BYTES)).toBe(true)
  })

  it('updates the printed signer details without touching the image', async () => {
    const { agent, schoolId } = await registerProfile()

    expect((await uploadSignature(agent, schoolId)).status).toBe(200)
    const before = await agent.get(
      `/api/schools/${schoolId}/profile/signature`,
    )
    const storageKey = schools.signatures.get(schoolId)!.storageKey

    const response = await agent
      .patch(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'Yaa Asantewaa', designation: 'Principal' })

    expect(response.status).toBe(200)
    expect(response.body.data.signature).toMatchObject({
      hasSignature: true,
      name: 'Yaa Asantewaa',
      designation: 'Principal',
      url: before.body.data.signature.url,
    })
    expect(schools.signatures.get(schoolId)!.storageKey).toBe(storageKey)
    expect(schools.auditActions()).toContain(
      'SCHOOL_SIGNATURE_DETAILS_UPDATED',
    )

    const empty = await agent
      .patch(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({})
    expect(empty.status).toBe(400)
  })

  it('rejects invalid or oversized signature uploads without storing anything', async () => {
    const { agent, schoolId } = await registerProfile()
    const writesBefore = new Set(storage.writtenKeys)

    const unsupported = await agent
      .post(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({
        signature: { mimeType: 'image/gif', base64: VALID_PNG.toString('base64') },
      })
    expect(unsupported.status).toBe(400)

    const spoofed = await uploadSignature(agent, schoolId, {
      bytes: VALID_PNG,
      mimeType: 'image/jpeg',
    })
    expect(spoofed.status).toBe(400)
    expect(spoofed.body.error.message).toBe(
      'The uploaded file does not match the declared image type',
    )

    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_SIGNATURE_BYTES),
    ])
    const tooLarge = await uploadSignature(agent, schoolId, {
      bytes: oversized,
    })
    expect(tooLarge.status).toBe(400)
    expect(tooLarge.body.error.message).toBe(
      'Signatures must be 1 MB or smaller',
    )

    expect(schools.signatures.size).toBe(0)
    expect(new Set(storage.writtenKeys)).toEqual(writesBefore)
  })

  it('requires a school administrator for every signature action', async () => {
    const { agent, schoolId } = await registerProfile()
    expect((await uploadSignature(agent, schoolId)).status).toBe(200)
    const storageKey = schools.signatures.get(schoolId)!.storageKey

    const teacher = await loginAs(
      'teacher@greenvalley.test',
      'CLASS_TEACHER',
      schoolId,
    )

    expect(
      (await teacher.get(`/api/schools/${schoolId}/profile/signature`)).status,
    ).toBe(403)
    expect(
      (
        await teacher.get(
          `/api/schools/${schoolId}/profile/signature/file`,
        )
      ).status,
    ).toBe(403)
    expect((await uploadSignature(teacher, schoolId)).status).toBe(403)
    expect(
      (
        await teacher
          .patch(`/api/schools/${schoolId}/profile/signature`)
          .set('Origin', TEST_ORIGIN)
          .send({ name: 'Not allowed' })
      ).status,
    ).toBe(403)
    expect(
      (
        await teacher
          .delete(`/api/schools/${schoolId}/profile/signature`)
          .set('Origin', TEST_ORIGIN)
      ).status,
    ).toBe(403)

    // The original signature is untouched by the rejected attempts.
    expect(schools.signatures.get(schoolId)!.storageKey).toBe(storageKey)
    expect(await storage.getObject(storageKey)).not.toBeNull()
  })

  it('removes the signature and returns to a blank signature state', async () => {
    const { agent, schoolId } = await registerProfile()
    expect((await uploadSignature(agent, schoolId)).status).toBe(200)
    const storageKey = schools.signatures.get(schoolId)!.storageKey

    const response = await agent
      .delete(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)

    expect(response.status).toBe(200)
    expect(response.body.data.signature).toMatchObject({
      hasSignature: false,
      url: null,
      name: null,
      designation: null,
    })

    const metadata = await agent.get(
      `/api/schools/${schoolId}/profile/signature`,
    )
    expect(metadata.body.data.signature.hasSignature).toBe(false)

    const file = await agent.get(
      `/api/schools/${schoolId}/profile/signature/file`,
    )
    expect(file.status).toBe(404)

    // Historical reports keep their snapshotted object.
    expect(await storage.getObject(storageKey)).not.toBeNull()
    expect(schools.auditActions()).toContain('SCHOOL_SIGNATURE_REMOVED')
  })

  it('isolates signatures between schools', async () => {
    const first = await registerProfile({
      schoolName: 'Green Valley Academy',
      email: 'admin@greenvalley.test',
    })
    const second = await registerProfile({
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })

    expect((await uploadSignature(first.agent, first.schoolId)).status).toBe(
      200,
    )
    const firstKey = schools.signatures.get(first.schoolId)!.storageKey

    const secondMetadata = await second.agent.get(
      `/api/schools/${second.schoolId}/profile/signature`,
    )
    expect(secondMetadata.status).toBe(200)
    expect(secondMetadata.body.data.signature.hasSignature).toBe(false)

    expect(
      (
        await second.agent.get(
          `/api/schools/${first.schoolId}/profile/signature/file`,
        )
      ).status,
    ).toBe(403)
    expect((await uploadSignature(second.agent, first.schoolId)).status).toBe(
      403,
    )
    expect((await uploadSignature(first.agent, second.schoolId)).status).toBe(
      403,
    )

    expect(schools.signatures.get(first.schoolId)!.storageKey).toBe(firstKey)
    expect(schools.signatures.has(second.schoolId)).toBe(false)
  })
})

describe('pupil photograph routes', () => {
  let auth: FakeAuthRepository
  let schools: FakeSchoolRepository
  let storage: RecordingStorage
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    auth = new FakeAuthRepository()
    schools = new FakeSchoolRepository(auth)
    storage = new RecordingStorage()
    app = createApp({
      authRepository: auth,
      schoolRepository: schools,
      reportStorage: storage,
    })
  })

  interface PhotoContext {
    adminAgent: ReturnType<typeof request.agent>
    teacherAgent: ReturnType<typeof request.agent>
    schoolId: string
    adminUserId: string
    classId: string
    yearId: string
    pupilId: string
  }

  async function login(email: string) {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })

    expect(response.status).toBe(200)
    return agent
  }

  async function registerSchool(
    overrides: { schoolName?: string; email?: string } = {},
  ): Promise<{
    agent: ReturnType<typeof request.agent>
    schoolId: string
    adminUserId: string
  }> {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/register-school')
      .set('Origin', TEST_ORIGIN)
      .send(registrationBody(overrides))

    expect(response.status).toBe(201)

    const schoolId = response.body.data.school.id as string
    const adminUserId = response.body.data.user.id as string
    const stored = auth.schools.get(schoolId)!

    schools.seedSchool({
      id: schoolId,
      name: stored.name,
      slug: stored.slug,
      email: stored.email,
      phone: stored.phone,
      address: stored.address,
      landmark: stored.landmark,
      logoObjectKey: stored.logoObjectKey,
      logoMimeType: stored.logoMimeType,
      logoUpdatedAt: stored.logoUpdatedAt,
    })
    schools.seedDefaults(schoolId, adminUserId)

    return { agent, schoolId, adminUserId }
  }

  async function setupPupil(): Promise<PhotoContext> {
    const {
      agent: adminAgent,
      schoolId,
      adminUserId,
    } = await registerSchool()

    const teacherEmail = 'ct-photo@greenvalley.test'
    const teacherResponse = await adminAgent
      .post(`/api/schools/${schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Class',
        lastName: 'Teacher',
        email: teacherEmail,
        role: 'CLASS_TEACHER',
        initialPassword: TEST_PASSWORD,
        className: 'Basic 1',
      })
    expect(teacherResponse.status).toBe(201)

    const teacherAgent = await login(teacherEmail)
    const classId = schools.classByName(schoolId, 'Basic 1').id

    const plan = buildAcademicYearPlan(
      academicStartYearFor(todayInCalendar()),
    )
    const year = await schools.createAcademicYear(
      schoolId,
      {
        name: plan.name,
        startsOn: plan.startsOn,
        endsOn: plan.endsOn,
        isCurrent: true,
      },
      { actorUserId: adminUserId },
    )

    const pupil = await teacherAgent
      .post(`/api/schools/${schoolId}/pupils`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Ama',
        lastName: 'Mensah',
        admissionNumber: 'GVA-001',
        gender: 'FEMALE',
        dateOfBirth: '2016-04-12',
        classId,
        academicYearId: year.id,
        startedOn: plan.startsOn,
      })
    expect(pupil.status).toBe(201)

    return {
      adminAgent,
      teacherAgent,
      schoolId,
      adminUserId,
      classId,
      yearId: year.id,
      pupilId: pupil.body.data.pupil.id as string,
    }
  }

  function uploadPhoto(
    agent: ReturnType<typeof request.agent>,
    schoolId: string,
    pupilId: string,
    options: { bytes?: Buffer; mimeType?: string } = {},
  ) {
    return agent
      .post(`/api/schools/${schoolId}/pupils/${pupilId}/photo`)
      .set('Origin', TEST_ORIGIN)
      .send({
        photo: {
          mimeType: options.mimeType ?? 'image/png',
          base64: (options.bytes ?? VALID_PNG).toString('base64'),
          originalName: 'pupil-photo.png',
        },
      })
  }

  it('lets the assigned class teacher upload, preview and stream a pupil photograph', async () => {
    const { adminAgent, teacherAgent, schoolId, pupilId } = await setupPupil()

    const response = await uploadPhoto(teacherAgent, schoolId, pupilId)

    expect(response.status).toBe(200)
    expect(response.body.data.pupil.photoUrl).toMatch(
      new RegExp(
        `^/api/schools/${schoolId}/pupils/${pupilId}/photo\\?v=\\d+$`,
      ),
    )
    expect(response.body.data.pupil.photoUpdatedAt).toBeTruthy()
    expect(response.body.data.pupil).not.toHaveProperty('photoReference')

    const stored = await schools.getPupilPhoto(schoolId, pupilId)
    expect(stored?.storageKey).toMatch(
      new RegExp(
        `^schools/${schoolId}/pupils/${pupilId}/photo/[0-9a-f-]+\\.png$`,
      ),
    )
    expect(storage.writtenKeys.has(stored!.storageKey)).toBe(true)
    // The private storage key never crosses the API boundary.
    expect(JSON.stringify(response.body)).not.toContain(stored!.storageKey)

    const teacherFile = await teacherAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(teacherFile.status).toBe(200)
    expect(teacherFile.headers['content-type']).toBe('image/png')
    expect(teacherFile.headers['cache-control']).toBe('private, max-age=300')
    expect(teacherFile.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(teacherFile.body).equals(VALID_PNG)).toBe(true)

    const adminFile = await adminAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(adminFile.status).toBe(200)
    expect(Buffer.from(adminFile.body).equals(VALID_PNG)).toBe(true)

    expect(schools.auditActions()).toContain('PUPIL_PHOTO_UPDATED')
  })

  it('lets a school administrator manage a pupil photograph', async () => {
    const { adminAgent, schoolId, pupilId } = await setupPupil()

    const uploaded = await uploadPhoto(adminAgent, schoolId, pupilId)
    expect(uploaded.status).toBe(200)

    const removed = await adminAgent
      .delete(`/api/schools/${schoolId}/pupils/${pupilId}/photo`)
      .set('Origin', TEST_ORIGIN)
    expect(removed.status).toBe(200)
    expect(removed.body.data.pupil.photoUrl).toBeNull()
    expect(removed.body.data.pupil.photoUpdatedAt).toBeNull()
  })

  it('rejects photographs for pupils outside the class teacher assignment', async () => {
    const { adminAgent, schoolId, pupilId } = await setupPupil()
    const writesBefore = new Set(storage.writtenKeys)

    const otherTeacher = await adminAgent
      .post(`/api/schools/${schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Second',
        lastName: 'Teacher',
        email: 'ct-photo-other@greenvalley.test',
        role: 'CLASS_TEACHER',
        initialPassword: TEST_PASSWORD,
        className: 'Basic 2',
      })
    expect(otherTeacher.status).toBe(201)
    const otherAgent = await login('ct-photo-other@greenvalley.test')

    const upload = await uploadPhoto(otherAgent, schoolId, pupilId)
    expect(upload.status).toBe(403)
    expect(upload.body.error.message).toBe(
      'You can only manage photographs for pupils in your assigned class',
    )

    const read = await otherAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(read.status).toBe(403)

    expect(await schools.getPupilPhoto(schoolId, pupilId)).toBeNull()
    expect(new Set(storage.writtenKeys)).toEqual(writesBefore)
  })

  it('rejects unsupported, oversized and spoofed photograph uploads', async () => {
    const { teacherAgent, schoolId, pupilId } = await setupPupil()
    const writesBefore = new Set(storage.writtenKeys)

    const unsupported = await uploadPhoto(teacherAgent, schoolId, pupilId, {
      bytes: VALID_PNG,
      mimeType: 'image/gif',
    })
    expect(unsupported.status).toBe(400)

    const spoofed = await uploadPhoto(teacherAgent, schoolId, pupilId, {
      bytes: VALID_PNG,
      mimeType: 'image/jpeg',
    })
    expect(spoofed.status).toBe(400)
    expect(spoofed.body.error.message).toBe(
      'The uploaded file does not match the declared image type',
    )

    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_PUPIL_PHOTO_BYTES),
    ])
    const tooLarge = await uploadPhoto(teacherAgent, schoolId, pupilId, {
      bytes: oversized,
    })
    expect(tooLarge.status).toBe(400)
    expect(tooLarge.body.error.message).toBe(
      'Pupil photographs must be 5 MB or smaller',
    )

    expect(await schools.getPupilPhoto(schoolId, pupilId)).toBeNull()
    expect(new Set(storage.writtenKeys)).toEqual(writesBefore)

    const missing = await teacherAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(missing.status).toBe(404)
  })

  it('replaces a photograph and preserves the previous private object', async () => {
    const { teacherAgent, schoolId, pupilId } = await setupPupil()

    expect((await uploadPhoto(teacherAgent, schoolId, pupilId)).status).toBe(
      200,
    )
    const firstKey = (await schools.getPupilPhoto(schoolId, pupilId))!
      .storageKey

    const replacement = await uploadPhoto(teacherAgent, schoolId, pupilId, {
      bytes: JPEG_BYTES,
      mimeType: 'image/jpeg',
    })
    expect(replacement.status).toBe(200)
    expect(replacement.body.data.pupil.photoUrl).toContain(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )

    const secondKey = (await schools.getPupilPhoto(schoolId, pupilId))!
      .storageKey
    expect(secondKey).toMatch(
      new RegExp(
        `^schools/${schoolId}/pupils/${pupilId}/photo/[0-9a-f-]+\\.jpg$`,
      ),
    )
    expect(secondKey).not.toBe(firstKey)
    expect(await storage.getObject(firstKey)).not.toBeNull()

    const file = await teacherAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(file.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.from(file.body).equals(JPEG_BYTES)).toBe(true)
  })

  it('removes the photograph but keeps the private object for historical reports', async () => {
    const { teacherAgent, schoolId, pupilId } = await setupPupil()

    expect((await uploadPhoto(teacherAgent, schoolId, pupilId)).status).toBe(
      200,
    )
    const storageKey = (await schools.getPupilPhoto(schoolId, pupilId))!
      .storageKey

    const removed = await teacherAgent
      .delete(`/api/schools/${schoolId}/pupils/${pupilId}/photo`)
      .set('Origin', TEST_ORIGIN)

    expect(removed.status).toBe(200)
    expect(removed.body.data.pupil.photoUrl).toBeNull()
    expect(removed.body.data.pupil.photoUpdatedAt).toBeNull()
    expect(await schools.getPupilPhoto(schoolId, pupilId)).toBeNull()
    expect(await storage.getObject(storageKey)).not.toBeNull()
    expect(schools.auditActions()).toContain('PUPIL_PHOTO_REMOVED')

    const missing = await teacherAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(missing.status).toBe(404)
  })

  it('detects tampering with the stored photograph', async () => {
    const { teacherAgent, schoolId, pupilId } = await setupPupil()
    expect((await uploadPhoto(teacherAgent, schoolId, pupilId)).status).toBe(
      200,
    )

    const stored = (await schools.getPupilPhoto(schoolId, pupilId))!
    await storage.putObject(
      stored.storageKey,
      Buffer.from('tampered-image-bytes'),
      'image/png',
    )

    const response = await teacherAgent.get(
      `/api/schools/${schoolId}/pupils/${pupilId}/photo`,
    )
    expect(response.status).toBe(500)
    expect(response.body.error.message).toBe(
      'The pupil photograph failed integrity verification',
    )
  })

  it('keeps photographs isolated between schools and behind authentication', async () => {
    const first = await setupPupil()
    expect(
      (await uploadPhoto(first.teacherAgent, first.schoolId, first.pupilId))
        .status,
    ).toBe(200)

    const second = await registerSchool({
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })

    expect(
      (
        await second.agent.get(
          `/api/schools/${first.schoolId}/pupils/${first.pupilId}/photo`,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await second.agent
          .post(
            `/api/schools/${first.schoolId}/pupils/${first.pupilId}/photo`,
          )
          .set('Origin', TEST_ORIGIN)
          .send({
            photo: {
              mimeType: 'image/png',
              base64: VALID_PNG.toString('base64'),
            },
          })
      ).status,
    ).toBe(403)

    const unauthenticated = await request(app).get(
      `/api/schools/${first.schoolId}/pupils/${first.pupilId}/photo`,
    )
    expect(unauthenticated.status).toBe(401)

    expect(await schools.getPupilPhoto(first.schoolId, first.pupilId)).not.toBeNull()
    await expect(
      schools.getPupilPhoto(second.schoolId, first.pupilId),
    ).rejects.toThrow('Pupil not found')
  })
})
