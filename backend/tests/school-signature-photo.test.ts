import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import {
  decodePupilPhotoUpload,
  decodeSignatureUpload,
  MAX_PUPIL_PHOTO_BYTES,
  MAX_SIGNATURE_BYTES,
  pupilPhotoStorageKey,
  signatureStorageKey,
} from '../src/lib/school-branding.js'
import {
  MemoryStorageAdapter,
  type StoredObjectMetadata,
} from '../src/storage/storage.js'
import { registrationBody, TEST_ORIGIN, TEST_PASSWORD } from './helpers/auth-fixtures.js'
import { FakeAuthRepository } from './helpers/fake-auth-repository.js'
import { FakeSchoolRepository } from './helpers/fake-school-repository.js'
import { tinyPng } from './helpers/png.js'

const VALID_PNG = tinyPng(8)

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
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

describe('signature and pupil photograph upload validation', () => {
  it('accepts PNG, JPEG and WebP signature uploads and strips data URLs', () => {
    const png = decodeSignatureUpload({
      mimeType: 'image/png',
      base64: `data:image/png;base64,${VALID_PNG.toString('base64')}`,
    })
    expect(png.mimeType).toBe('image/png')
    expect(png.extension).toBe('png')
    expect(png.data.equals(VALID_PNG)).toBe(true)

    expect(
      decodeSignatureUpload({
        mimeType: 'image/jpeg',
        base64: JPEG_BYTES.toString('base64'),
      }).extension,
    ).toBe('jpg')
  })

  it('rejects invalid signature bytes, unsupported types and oversized files', () => {
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

    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_SIGNATURE_BYTES),
    ])
    expect(() =>
      decodeSignatureUpload({
        mimeType: 'image/png',
        base64: oversized.toString('base64'),
      }),
    ).toThrow('Signatures must be 1 MB or smaller')
  })

  it('validates pupil photographs against the larger 5 MB ceiling', () => {
    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_PUPIL_PHOTO_BYTES),
    ])

    expect(() =>
      decodePupilPhotoUpload({
        mimeType: 'image/png',
        base64: oversized.toString('base64'),
      }),
    ).toThrow('Pupil photographs must be 5 MB or smaller')

    expect(
      decodePupilPhotoUpload({
        mimeType: 'image/png',
        base64: VALID_PNG.toString('base64'),
      }).data.equals(VALID_PNG),
    ).toBe(true)
  })

  it('generates unique, school- and pupil-scoped private storage keys', () => {
    expect(signatureStorageKey('school-a', 'png')).toMatch(
      /^schools\/school-a\/signature\/[0-9a-f-]+\.png$/,
    )
    expect(signatureStorageKey('school-a', 'png')).not.toBe(
      signatureStorageKey('school-a', 'png'),
    )

    expect(pupilPhotoStorageKey('school-a', 'pupil-1', 'webp')).toMatch(
      /^schools\/school-a\/pupils\/pupil-1\/photo\/[0-9a-f-]+\.webp$/,
    )
    expect(pupilPhotoStorageKey('school-b', 'pupil-1', 'jpg')).toContain(
      'schools/school-b/pupils/pupil-1/photo/',
    )
  })
})

describe('school signature management', () => {
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

  interface Context {
    admin: ReturnType<typeof request.agent>
    schoolId: string
  }

  async function registerSchool(
    overrides: Parameters<typeof registrationBody>[0] = {},
  ): Promise<Context> {
    const admin = request.agent(app)
    const response = await admin
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

    return { admin, schoolId }
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
    body: Record<string, unknown> = {},
  ) {
    return agent
      .post(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({
        signature: {
          mimeType: 'image/png',
          base64: VALID_PNG.toString('base64'),
          originalName: 'signature.png',
        },
        ...body,
      })
  }

  it('reports no signature before one is uploaded', async () => {
    const { admin, schoolId } = await registerSchool()
    const response = await admin.get(
      `/api/schools/${schoolId}/profile/signature`,
    )

    expect(response.status).toBe(200)
    expect(response.body.data.signature).toEqual({
      hasSignature: false,
      url: null,
      mimeType: null,
      updatedAt: null,
      name: null,
      designation: null,
    })
    expect([...storage.writtenKeys].some((key) => key.includes('/signature/'))).toBe(
      false,
    )
  })

  it('stores an uploaded signature privately and returns no storage key', async () => {
    const { admin, schoolId } = await registerSchool()

    const response = await uploadSignature(admin, schoolId, {
      name: 'Grace Mensah',
      designation: 'Headmistress',
    })

    expect(response.status).toBe(200)
    expect(response.body.data.signature).toMatchObject({
      hasSignature: true,
      mimeType: 'image/png',
      name: 'Grace Mensah',
      designation: 'Headmistress',
    })
    expect(response.body.data.signature.url).toContain(
      `/api/schools/${schoolId}/profile/signature/file`,
    )
    const stored = schools.signatures.get(schoolId)!
    expect(JSON.stringify(response.body)).not.toContain(stored.storageKey)
    expect(stored.storageKey).toMatch(
      new RegExp(`^schools/${schoolId}/signature/[0-9a-f-]+\\.png$`),
    )
    expect(storage.writtenKeys.has(stored.storageKey)).toBe(true)
    expect(schools.auditActions()).toContain('SCHOOL_SIGNATURE_UPDATED')
  })

  it('streams the signature only to an authenticated administrator', async () => {
    const { admin, schoolId } = await registerSchool()
    await uploadSignature(admin, schoolId)

    const response = await admin.get(
      `/api/schools/${schoolId}/profile/signature/file`,
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(response.body).equals(VALID_PNG)).toBe(true)

    const teacher = await loginAs(
      'teacher@greenvalley.test',
      'CLASS_TEACHER',
      schoolId,
    )
    expect(
      (
        await teacher.get(
          `/api/schools/${schoolId}/profile/signature/file`,
        )
      ).status,
    ).toBe(403)
    expect(
      (await request(app).get(`/api/schools/${schoolId}/profile/signature`))
        .status,
    ).toBe(401)
  })

  it('updates the printed name and designation without replacing the image', async () => {
    const { admin, schoolId } = await registerSchool()
    await uploadSignature(admin, schoolId, {
      name: 'Grace Mensah',
      designation: 'Headmistress',
    })
    const before = schools.signatures.get(schoolId)!.storageKey

    const response = await admin
      .patch(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'Grace A. Mensah', designation: 'School Administrator' })

    expect(response.status).toBe(200)
    expect(response.body.data.signature).toMatchObject({
      hasSignature: true,
      name: 'Grace A. Mensah',
      designation: 'School Administrator',
    })
    expect(schools.signatures.get(schoolId)!.storageKey).toBe(before)
    expect(schools.auditActions()).toContain('SCHOOL_SIGNATURE_DETAILS_UPDATED')
  })

  it('keeps the previous signature object when a replacement is uploaded', async () => {
    const { admin, schoolId } = await registerSchool()
    await uploadSignature(admin, schoolId)
    const firstKey = schools.signatures.get(schoolId)!.storageKey

    const response = await uploadSignature(admin, schoolId)

    expect(response.status).toBe(200)
    const secondKey = schools.signatures.get(schoolId)!.storageKey
    expect(secondKey).not.toBe(firstKey)
    expect(await storage.getObject(firstKey)).not.toBeNull()
  })

  it('keeps the existing signature when an invalid upload is rejected', async () => {
    const { admin, schoolId } = await registerSchool()
    await uploadSignature(admin, schoolId)
    const beforeKey = schools.signatures.get(schoolId)!.storageKey
    const writesBefore = new Set(storage.writtenKeys)

    const response = await admin
      .post(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)
      .send({
        signature: {
          mimeType: 'image/png',
          base64: Buffer.from('not an image').toString('base64'),
        },
      })

    expect(response.status).toBe(400)
    expect(schools.signatures.get(schoolId)!.storageKey).toBe(beforeKey)
    expect(new Set(storage.writtenKeys)).toEqual(writesBefore)
  })

  it('removes the signature but retains the private object for history', async () => {
    const { admin, schoolId } = await registerSchool()
    await uploadSignature(admin, schoolId)
    const key = schools.signatures.get(schoolId)!.storageKey

    const response = await admin
      .delete(`/api/schools/${schoolId}/profile/signature`)
      .set('Origin', TEST_ORIGIN)

    expect(response.status).toBe(200)
    expect(response.body.data.signature.hasSignature).toBe(false)
    expect(schools.signatures.has(schoolId)).toBe(false)
    expect(await storage.getObject(key)).not.toBeNull()
    expect(schools.auditActions()).toContain('SCHOOL_SIGNATURE_REMOVED')
    expect(
      (
        await admin.get(
          `/api/schools/${schoolId}/profile/signature/file`,
        )
      ).status,
    ).toBe(404)
  })

  it('forbids teachers from reading or mutating the signature', async () => {
    const { admin, schoolId } = await registerSchool()
    await uploadSignature(admin, schoolId)
    const teacher = await loginAs(
      'teacher@greenvalley.test',
      'CLASS_TEACHER',
      schoolId,
    )

    expect(
      (await teacher.get(`/api/schools/${schoolId}/profile/signature`)).status,
    ).toBe(403)
    expect((await uploadSignature(teacher, schoolId)).status).toBe(403)
    expect(
      (
        await teacher
          .patch(`/api/schools/${schoolId}/profile/signature`)
          .set('Origin', TEST_ORIGIN)
          .send({ name: 'Forged' })
      ).status,
    ).toBe(403)
    expect(
      (
        await teacher
          .delete(`/api/schools/${schoolId}/profile/signature`)
          .set('Origin', TEST_ORIGIN)
      ).status,
    ).toBe(403)
  })

  it('isolates signatures between schools', async () => {
    const first = await registerSchool({
      schoolName: 'Green Valley Academy',
      email: 'admin@greenvalley.test',
    })
    const second = await registerSchool({
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })

    await uploadSignature(first.admin, first.schoolId)
    expect(schools.signatures.has(second.schoolId)).toBe(false)

    expect(
      (
        await first.admin.get(
          `/api/schools/${second.schoolId}/profile/signature`,
        )
      ).status,
    ).toBe(403)
    expect(
      (await uploadSignature(first.admin, second.schoolId)).status,
    ).toBe(403)
    expect(schools.signatures.has(second.schoolId)).toBe(false)
  })
})

describe('pupil photograph management', () => {
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

  interface Context {
    admin: ReturnType<typeof request.agent>
    schoolId: string
    yearId: string
    classId: string
  }

  async function registerSchool(
    overrides: Parameters<typeof registrationBody>[0] = {},
  ): Promise<Context> {
    const admin = request.agent(app)
    const response = await admin
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

    const year = await schools.createAcademicYear(
      schoolId,
      {
        name: '2025/2026',
        startsOn: '2025-09-01',
        endsOn: '2026-07-31',
        isCurrent: true,
      },
      { actorUserId: adminUserId },
    )

    return {
      admin,
      schoolId,
      yearId: year.id,
      classId: schools.classByName(schoolId, 'Basic 3').id,
    }
  }

  async function registerClassTeacher(
    ctx: Context,
    className: string,
    email: string,
  ) {
    const response = await ctx.admin
      .post(`/api/schools/${ctx.schoolId}/teachers`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Class',
        lastName: 'Teacher',
        email,
        role: 'CLASS_TEACHER',
        className,
      })
    expect(response.status).toBe(201)

    await auth.setPasswordForTesting(email, TEST_PASSWORD)
    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: TEST_PASSWORD })
    expect(login.status).toBe(200)

    return {
      agent,
      classId: schools.classByName(ctx.schoolId, className).id,
    }
  }

  async function createPupil(
    ctx: Context,
    agent: ReturnType<typeof request.agent>,
    classId: string,
    admissionNumber = 'PHOTO-001',
  ): Promise<string> {
    const response = await agent
      .post(`/api/schools/${ctx.schoolId}/pupils`)
      .set('Origin', TEST_ORIGIN)
      .send({
        firstName: 'Ama',
        lastName: 'Mensah',
        admissionNumber,
        classId,
        academicYearId: ctx.yearId,
        startedOn: '2025-09-01',
      })
    expect(response.status).toBe(201)
    return response.body.data.pupil.id as string
  }

  function uploadPhoto(
    agent: ReturnType<typeof request.agent>,
    schoolId: string,
    pupilId: string,
    photo: Record<string, unknown> = {
      mimeType: 'image/png',
      base64: VALID_PNG.toString('base64'),
      originalName: 'pupil.png',
    },
  ) {
    return agent
      .post(`/api/schools/${schoolId}/pupils/${pupilId}/photo`)
      .set('Origin', TEST_ORIGIN)
      .send({ photo })
  }

  it('lets the assigned class teacher upload, stream and replace a photo', async () => {
    const ctx = await registerSchool()
    const teacher = await registerClassTeacher(
      ctx,
      'Basic 3',
      'ct-photo@greenvalley.test',
    )
    const pupilId = await createPupil(ctx, teacher.agent, teacher.classId)

    const upload = await uploadPhoto(
      teacher.agent,
      ctx.schoolId,
      pupilId,
    )
    expect(upload.status).toBe(200)
    expect(upload.body.data.pupil.photoUrl).toContain(
      `/api/schools/${ctx.schoolId}/pupils/${pupilId}/photo`,
    )
    expect(upload.body.data.pupil).not.toHaveProperty('photoReference')
    expect(JSON.stringify(upload.body)).not.toContain('photo/')

    const stored = schools.pupilPhotos.get(pupilId)!
    expect(stored.storageKey).toMatch(
      new RegExp(
        `^schools/${ctx.schoolId}/pupils/${pupilId}/photo/[0-9a-f-]+\\.png$`,
      ),
    )
    expect(storage.writtenKeys.has(stored.storageKey)).toBe(true)
    expect(schools.auditActions()).toContain('PUPIL_PHOTO_UPDATED')

    const stream = await teacher.agent.get(
      `/api/schools/${ctx.schoolId}/pupils/${pupilId}/photo`,
    )
    expect(stream.status).toBe(200)
    expect(stream.headers['content-type']).toBe('image/png')
    expect(stream.headers['cache-control']).toBe('private, max-age=300')
    expect(Buffer.from(stream.body).equals(VALID_PNG)).toBe(true)

    const firstKey = stored.storageKey
    const replace = await uploadPhoto(teacher.agent, ctx.schoolId, pupilId)
    expect(replace.status).toBe(200)
    const secondKey = schools.pupilPhotos.get(pupilId)!.storageKey
    expect(secondKey).not.toBe(firstKey)
    // Historical report snapshots may still reference the first object.
    expect(await storage.getObject(firstKey)).not.toBeNull()
  })

  it('allows a school administrator to manage pupil photographs', async () => {
    const ctx = await registerSchool()
    const teacher = await registerClassTeacher(
      ctx,
      'Basic 3',
      'ct-photo@greenvalley.test',
    )
    const pupilId = await createPupil(ctx, teacher.agent, teacher.classId)

    const upload = await uploadPhoto(ctx.admin, ctx.schoolId, pupilId)
    expect(upload.status).toBe(200)

    const remove = await ctx.admin
      .delete(`/api/schools/${ctx.schoolId}/pupils/${pupilId}/photo`)
      .set('Origin', TEST_ORIGIN)
    expect(remove.status).toBe(200)
    expect(remove.body.data.pupil.photoUrl).toBeNull()
    expect(schools.pupilPhotos.has(pupilId)).toBe(false)
    expect(schools.auditActions()).toContain('PUPIL_PHOTO_REMOVED')
  })

  it('rejects a class teacher managing another class’s pupil', async () => {
    const ctx = await registerSchool()
    const owner = await registerClassTeacher(
      ctx,
      'Basic 3',
      'ct-owner@greenvalley.test',
    )
    const outsider = await registerClassTeacher(
      ctx,
      'Basic 1',
      'ct-outsider@greenvalley.test',
    )
    const pupilId = await createPupil(ctx, owner.agent, owner.classId)

    expect(
      (await uploadPhoto(outsider.agent, ctx.schoolId, pupilId)).status,
    ).toBe(403)
    expect(schools.pupilPhotos.has(pupilId)).toBe(false)
    expect(
      (
        await outsider.agent.get(
          `/api/schools/${ctx.schoolId}/pupils/${pupilId}/photo`,
        )
      ).status,
    ).toBe(403)
  })

  it('rejects subject teachers even when the pupil exists', async () => {
    const ctx = await registerSchool()
    const teacher = await registerClassTeacher(
      ctx,
      'Basic 3',
      'ct-owner@greenvalley.test',
    )
    const pupilId = await createPupil(ctx, teacher.agent, teacher.classId)

    const user = await auth.createUser({
      email: 'subject-photo@greenvalley.test',
      password: TEST_PASSWORD,
    })
    await auth.addMembership(user.id, ctx.schoolId, 'SUBJECT_TEACHER')
    const agent = request.agent(app)
    const login = await agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'subject-photo@greenvalley.test', password: TEST_PASSWORD })
    expect(login.status).toBe(200)

    expect((await uploadPhoto(agent, ctx.schoolId, pupilId)).status).toBe(403)
  })

  it('validates photo type, size and magic bytes before writing storage', async () => {
    const ctx = await registerSchool()
    const teacher = await registerClassTeacher(
      ctx,
      'Basic 3',
      'ct-photo@greenvalley.test',
    )
    const pupilId = await createPupil(ctx, teacher.agent, teacher.classId)
    const writesBefore = new Set(storage.writtenKeys)

    expect(
      (
        await uploadPhoto(teacher.agent, ctx.schoolId, pupilId, {
          mimeType: 'image/gif',
          base64: VALID_PNG.toString('base64'),
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await uploadPhoto(teacher.agent, ctx.schoolId, pupilId, {
          mimeType: 'image/jpeg',
          base64: VALID_PNG.toString('base64'),
        })
      ).status,
    ).toBe(400)

    const oversized = Buffer.concat([
      VALID_PNG.subarray(0, 8),
      Buffer.alloc(MAX_PUPIL_PHOTO_BYTES),
    ])
    expect(
      (
        await uploadPhoto(teacher.agent, ctx.schoolId, pupilId, {
          mimeType: 'image/png',
          base64: oversized.toString('base64'),
        })
      ).status,
    ).toBe(400)

    expect(new Set(storage.writtenKeys)).toEqual(writesBefore)
    expect(schools.pupilPhotos.has(pupilId)).toBe(false)
  })

  it('returns 404 when no photo exists and never serves another school’s pupil', async () => {
    const first = await registerSchool()
    const firstTeacher = await registerClassTeacher(
      first,
      'Basic 3',
      'ct-first@greenvalley.test',
    )
    const pupilId = await createPupil(
      first,
      firstTeacher.agent,
      firstTeacher.classId,
    )
    await uploadPhoto(firstTeacher.agent, first.schoolId, pupilId)

    expect(
      (
        await firstTeacher.agent.get(
          `/api/schools/${first.schoolId}/pupils/${pupilId}/photo`,
        )
      ).status,
    ).toBe(200)

    // A different school cannot address the pupil at all.
    const second = await registerSchool({
      schoolName: 'Riverside School',
      email: 'admin@riverside.test',
    })

    expect(
      (
        await second.admin.get(
          `/api/schools/${second.schoolId}/pupils/${pupilId}/photo`,
        )
      ).status,
    ).toBe(404)

    // A pupil with no photograph is a 404, never a placeholder image.
    const secondTeacher = await registerClassTeacher(
      second,
      'Basic 3',
      'ct-second@riverside.test',
    )
    const secondPupil = await createPupil(
      second,
      secondTeacher.agent,
      secondTeacher.classId,
      'PHOTO-002',
    )
    expect(
      (
        await secondTeacher.agent.get(
          `/api/schools/${second.schoolId}/pupils/${secondPupil}/photo`,
        )
      ).status,
    ).toBe(404)
  })
})
