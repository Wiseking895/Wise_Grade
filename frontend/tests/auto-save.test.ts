import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  AutoSaveEngine,
  type AutoSaveEngineOptions,
} from '../src/lib/auto-save-engine.ts'

interface Draft {
  value: string
}

function manualTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; callback: () => void }>()

  return {
    setTimer(callback: () => void, delayMs: number) {
      const id = nextId++
      pending.set(id, { at: now + delayMs, callback })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer(timer: ReturnType<typeof setTimeout>) {
      pending.delete(timer as unknown as number)
    },
    advance(ms: number) {
      now += ms
      for (const [id, entry] of [...pending]) {
        if (entry.at <= now) {
          pending.delete(id)
          entry.callback()
        }
      }
    },
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

function engineFor(
  save: (value: Draft) => Promise<void>,
  timers: ReturnType<typeof manualTimers>,
  options: Partial<AutoSaveEngineOptions<Draft>> = {},
) {
  return new AutoSaveEngine<Draft>(
    { value: '' },
    {
      save,
      delayMs: 800,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      ...options,
    },
  )
}

describe('auto-save engine', () => {
  it('debounces rapid edits into a single save with the newest value', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        saved.push(value.value)
      },
      timers,
    )

    engine.setEnabled(true)
    engine.setValue({ value: 'a' })
    engine.setValue({ value: 'ab' })
    engine.setValue({ value: 'abc' })

    timers.advance(799)
    await settle()
    assert.deepEqual(saved, [])

    timers.advance(1)
    await settle()
    assert.deepEqual(saved, ['abc'])
    assert.equal(engine.getSnapshot().status, 'saved')
    assert.equal(engine.getSnapshot().hasPendingChanges, false)
  })

  it('saves immediately when the screen flushes on blur', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        saved.push(value.value)
      },
      timers,
    )

    engine.setEnabled(true)
    engine.setValue({ value: 'term two remark' })
    await engine.flush()

    assert.deepEqual(saved, ['term two remark'])
    assert.equal(engine.getSnapshot().status, 'saved')

    // The cancelled debounce must not fire a duplicate request.
    timers.advance(1_000)
    await settle()
    assert.deepEqual(saved, ['term two remark'])
  })

  it('keeps the unsaved value after a failure and retries the newest edit', async () => {
    const timers = manualTimers()
    let attempts = 0
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('Network unavailable')
        }
        saved.push(value.value)
      },
      timers,
    )

    engine.setEnabled(true)
    engine.setValue({ value: 'first version' })
    timers.advance(800)
    await settle()

    assert.equal(engine.getSnapshot().status, 'error')
    assert.match(engine.getSnapshot().error ?? '', /Network unavailable/)
    assert.equal(engine.getSnapshot().hasPendingChanges, true)
    assert.deepEqual(saved, [])

    // Further typing stays local until the debounce fires again.
    engine.setValue({ value: 'second version' })
    await engine.retry()

    assert.deepEqual(saved, ['second version'])
    assert.equal(engine.getSnapshot().status, 'saved')
    assert.equal(engine.getSnapshot().error, null)
  })

  it('never overlaps requests and follows an edit made while saving', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    let active = 0
    let maxActive = 0
    let releaseFirst: () => void = () => {}
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const engine = engineFor(
      async (value) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        saved.push(value.value)

        if (saved.length === 1) {
          await firstSaveGate
        }

        active -= 1
      },
      timers,
    )

    engine.setEnabled(true)
    engine.setValue({ value: 'first' })
    timers.advance(800)
    await settle()

    assert.deepEqual(saved, ['first'])
    assert.equal(engine.getSnapshot().status, 'saving')

    engine.setValue({ value: 'second' })
    engine.setValue({ value: 'third' })

    releaseFirst()
    await settle()
    timers.advance(0)
    await settle()

    assert.deepEqual(saved, ['first', 'third'])
    assert.equal(maxActive, 1)
    assert.equal(engine.getSnapshot().status, 'saved')
  })

  it('waits while validation blocks saving', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        saved.push(value.value)
      },
      timers,
    )

    engine.setCanSave(false)
    engine.setEnabled(true)
    engine.setValue({ value: 'incomplete' })
    timers.advance(800)
    await settle()

    assert.deepEqual(saved, [])
    assert.equal(engine.getSnapshot().status, 'pending')
    assert.equal(engine.getSnapshot().hasPendingChanges, true)

    engine.setCanSave(true)
    timers.advance(800)
    await settle()

    assert.deepEqual(saved, ['incomplete'])
  })

  it('does not treat the first loaded value as an edit', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        saved.push(value.value)
      },
      timers,
    )

    engine.setEnabled(false)
    engine.setValue({ value: 'loaded from the server' })
    engine.setEnabled(true)
    timers.advance(2_000)
    await settle()

    assert.deepEqual(saved, [])
    assert.equal(engine.getSnapshot().status, 'idle')
  })

  it('saves the first edit when enabled from the start', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        saved.push(value.value)
      },
      timers,
    )

    engine.setValue({ value: 'typed once' })
    timers.advance(800)
    await settle()

    assert.deepEqual(saved, ['typed once'])
  })

  it('treats a freshly loaded sheet as a baseline, not an edit', async () => {
    const timers = manualTimers()
    const saved: string[] = []
    const engine = engineFor(
      async (value) => {
        saved.push(value.value)
      },
      timers,
    )

    engine.setValue({ value: 'sheet one' })
    timers.advance(800)
    await settle()
    assert.deepEqual(saved, ['sheet one'])

    // Switching sheets disables auto-save while the next sheet loads.
    engine.setEnabled(false)
    engine.setValue({ value: 'sheet two loaded' })
    engine.setEnabled(true)
    timers.advance(2_000)
    await settle()

    assert.deepEqual(saved, ['sheet one'])
    assert.equal(engine.getSnapshot().status, 'idle')
    assert.equal(engine.getSnapshot().hasPendingChanges, false)
  })
})

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('auto-saved screens', () => {
  it('auto-saves the school profile but keeps logo and signature uploads explicit', async () => {
    const page = await source('../src/pages/dashboard/SchoolProfilePage.tsx')

    assert.match(page, /useAutoSave<SchoolProfileInput>/)
    assert.match(page, /onBlur=\{\(\) => void autoSave\.flush\(\)\}/)
    assert.match(page, /<AutoSaveIndicator/)
    assert.match(page, /updateSchoolProfile/)
    // Uploads are not text edits: they keep their own explicit action.
    assert.match(page, /uploadSchoolLogo/)
    assert.doesNotMatch(page, /Save profile/)
  })

  it('auto-saves report settings without generating or releasing reports', async () => {
    const page = await source('../src/pages/dashboard/ReportSettingsPage.tsx')

    assert.match(page, /useAutoSave<ReportSettingsInput \| null>/)
    assert.match(page, /onBlur=\{\(\) => void autoSave\.flush\(\)\}/)
    assert.match(page, /<AutoSaveIndicator/)
    assert.match(page, /updateReportSettings/)
    assert.match(page, /uploadReportAsset/)
    assert.match(page, /does not\s+generate or release any report card/)
    assert.doesNotMatch(page, /Save report settings/)
  })

  it('auto-saves score drafts but keeps submission an explicit, guarded action', async () => {
    const page = await source('../src/pages/dashboard/ScoreEntryPage.tsx')

    assert.match(page, /useAutoSave<ScoreValues>/)
    assert.match(page, /void autoSave\.flush\(\)/)
    assert.match(page, /saveScoreDraft/)
    assert.match(page, /Submit results/)
    assert.match(page, /autoSave\.hasPendingChanges/)
    assert.match(page, /autoSave\.status !== 'saving'/)
    assert.match(page, /autoSave\.status !== 'error'/)
    assert.doesNotMatch(page, /Save draft/)
    // A failed or pending draft must never be submitted automatically.
    assert.doesNotMatch(page, /setSubmitOpen\(true\);?\s*void autoSave/)
  })

  it('auto-saves platform profile names while email, password and sessions stay explicit', async () => {
    const page = await source('../src/pages/platform/PlatformAccountPage.tsx')

    assert.match(page, /profileAutoSave = useAutoSave/)
    assert.match(page, /updatePlatformAccountProfile/)
    assert.match(page, /profileAutoSave\.flush/)
    assert.match(page, /changePlatformAccountEmail/)
    assert.match(page, /changePlatformAccountPassword/)
    assert.match(page, /revokeOtherPlatformAccountSessions/)
    assert.doesNotMatch(page, /Save profile/)
  })

  it('keeps platform settings behind an explicit save and reauthentication', async () => {
    const page = await source('../src/pages/platform/PlatformSettingsPage.tsx')

    assert.match(page, /Save settings/)
    assert.doesNotMatch(page, /useAutoSave/)
  })
})
