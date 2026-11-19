export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutoSaveSnapshot {
  status: AutoSaveStatus
  error: string | null
  lastSavedAt: Date | null
  /** True while the latest local value differs from the last saved value. */
  hasPendingChanges: boolean
}

export interface AutoSaveEngineOptions<T> {
  save: (value: T) => Promise<void>
  /** Debounce window. Kept inside the 700–1000 ms guidance. */
  delayMs?: number
  serialize?: (value: T) => string
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  now?: () => Date
}

const DEFAULT_DELAY_MS = 800

function defaultSerialize<T>(value: T): string {
  return JSON.stringify(value)
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== '') {
    return cause.message
  }

  return 'Could not save your changes.'
}

/**
 * Framework-free core of the debounced auto-save behaviour.
 *
 * Guarantees:
 * - rapid edits coalesce into one request carrying the newest value;
 * - only one request is ever in flight, so updates cannot be reordered on the
 *   wire and stale responses cannot overwrite newer local state;
 * - a failed save keeps the pending value untouched and exposes a retry;
 * - edits made while a request is in flight are saved immediately afterwards.
 */
export class AutoSaveEngine<T> {
  private value: T
  private latestKey: string
  private savedKey: string | null = null
  private enabled = true
  private canSave = true
  private inFlight = false
  private queued = false
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private runId = 0
  private options: AutoSaveEngineOptions<T>
  private snapshot: AutoSaveSnapshot = {
    status: 'idle',
    error: null,
    lastSavedAt: null,
    hasPendingChanges: false,
  }

  private readonly listeners = new Set<() => void>()

  constructor(value: T, options: AutoSaveEngineOptions<T>) {
    this.value = value
    this.options = options
    this.latestKey = this.serialize(value)
    // The value the engine was created with is loaded state, not an edit.
    this.savedKey = this.latestKey
  }

  private serialize(value: T): string {
    return (this.options.serialize ?? defaultSerialize)(value)
  }

  private setTimer(callback: () => void, delayMs: number) {
    return this.options.setTimer
      ? this.options.setTimer(callback, delayMs)
      : setTimeout(callback, delayMs)
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>) {
    if (this.options.clearTimer) {
      this.options.clearTimer(timer)
    } else {
      clearTimeout(timer)
    }
  }

  private publish(patch: Partial<AutoSaveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AutoSaveSnapshot => this.snapshot

  updateOptions(options: Partial<AutoSaveEngineOptions<T>>): void {
    this.options = { ...this.options, ...options }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return

    this.enabled = enabled

    if (!enabled) {
      this.cancelTimer()
      return
    }

    // A screen enables auto-save only after its data has loaded. Whatever value
    // arrived while it was disabled is the new baseline, never an edit to save
    // back. Genuine edits made while enabled still save normally.
    this.cancelTimer()
    this.queued = false
    this.savedKey = this.latestKey
    this.publish({
      status: 'idle',
      error: null,
      hasPendingChanges: false,
    })
  }

  setCanSave(canSave: boolean): void {
    if (this.canSave === canSave) return

    this.canSave = canSave

    if (!canSave) {
      this.cancelTimer()
      return
    }

    if (this.latestKey !== this.savedKey) {
      this.markPending()
      this.schedule()
    }
  }

  setValue(value: T): void {
    const nextKey = this.serialize(value)

    if (nextKey === this.latestKey) {
      this.value = value
      return
    }

    this.value = value
    this.latestKey = nextKey

    if (!this.enabled) return

    if (nextKey === this.savedKey) {
      this.cancelTimer()
      this.publish({
        status: this.inFlight ? 'saving' : 'saved',
        error: null,
        hasPendingChanges: false,
      })
      return
    }

    this.markPending()
    this.schedule()
  }

  private markPending(): void {
    this.publish({
      status: this.inFlight ? 'saving' : 'pending',
      error: null,
      hasPendingChanges: true,
    })
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  private schedule(delayMs = this.options.delayMs ?? DEFAULT_DELAY_MS): void {
    this.cancelTimer()
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.run()
    }, delayMs)
  }

  /** Save any pending edit now, for example when a field loses focus. */
  flush = async (): Promise<void> => {
    this.cancelTimer()

    if (!this.enabled || this.latestKey === this.savedKey) {
      return
    }

    if (this.inFlight) {
      this.queued = true
      return
    }

    await this.run()
  }

  /** Retry after a failure using the newest local value. */
  retry = async (): Promise<void> => {
    this.cancelTimer()

    if (this.inFlight) {
      this.queued = true
      return
    }

    if (!this.enabled || this.latestKey === this.savedKey) {
      return
    }

    await this.run()
  }

  private async run(): Promise<void> {
    if (this.disposed || !this.enabled) return

    if (this.inFlight) {
      this.queued = true
      return
    }

    if (!this.canSave) {
      this.publish({ status: 'pending', hasPendingChanges: true })
      return
    }

    if (this.latestKey === this.savedKey) {
      this.publish({
        status: 'saved',
        error: null,
        hasPendingChanges: false,
      })
      return
    }

    const runId = ++this.runId
    const value = this.value
    const key = this.latestKey

    this.inFlight = true
    this.queued = false
    this.publish({ status: 'saving', error: null, hasPendingChanges: true })

    let succeeded = false

    try {
      await this.options.save(value)

      if (this.disposed || runId !== this.runId) {
        return
      }

      succeeded = true
      this.savedKey = key

      if (this.latestKey === key) {
        this.publish({
          status: 'saved',
          error: null,
          lastSavedAt: (this.options.now ?? (() => new Date()))(),
          hasPendingChanges: false,
        })
      } else {
        this.publish({
          status: 'pending',
          error: null,
          hasPendingChanges: true,
        })
        this.queued = true
      }
    } catch (cause) {
      if (!this.disposed && runId === this.runId) {
        // Keep the value exactly as typed. The caller reads the message and the
        // user can retry without losing work.
        this.publish({
          status: 'error',
          error: errorMessage(cause),
          hasPendingChanges: this.latestKey !== this.savedKey,
        })
      }
    } finally {
      this.inFlight = false

      if (!this.disposed && this.queued) {
        this.queued = false
        // A newer edit arrived during the request. Save it immediately, but
        // only when the previous request succeeded; a failure must wait for an
        // explicit retry or another edit.
        if (succeeded) {
          this.schedule(0)
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.cancelTimer()
    this.listeners.clear()
  }
}
