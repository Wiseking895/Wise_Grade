import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  AutoSaveEngine,
  type AutoSaveEngineOptions,
  type AutoSaveSnapshot,
} from './auto-save-engine'

export type { AutoSaveSnapshot, AutoSaveStatus } from './auto-save-engine'

export interface UseAutoSaveOptions<T> {
  value: T
  save: (value: T) => Promise<void>
  /** Loads only after the screen has its data; the first value is a baseline. */
  enabled?: boolean
  /** When false, debounced edits wait without calling the API (e.g. invalid). */
  canSave?: boolean
  delayMs?: number
}

export interface UseAutoSaveResult extends AutoSaveSnapshot {
  /** Save pending edits immediately, e.g. on field blur. */
  flush: () => Promise<void>
  /** Retry the last failed save with the newest value. */
  retry: () => Promise<void>
}

/**
 * React binding for the debounced auto-save engine. The engine owns the
 * single-flight queue, debounce timer and sequence guard, so a screen only has
 * to describe the value and the save call.
 */
export function useAutoSave<T>({
  value,
  save,
  enabled = true,
  canSave = true,
  delayMs = 800,
}: UseAutoSaveOptions<T>): UseAutoSaveResult {
  const [engine] = useState(
    () =>
      new AutoSaveEngine<T>(value, {
        save,
        delayMs,
      }),
  )

  // Screens usually pass an inline save callback, so keep the engine pointing
  // at the newest one. This effect runs before the effects that enable the
  // engine or publish values on the same commit.
  useEffect(() => {
    engine.updateOptions({ save, delayMs })
  }, [engine, save, delayMs])

  // Publish the newest value before enabling: a screen that finishes loading
  // flips `enabled` in the same commit, and the loaded value must become the
  // baseline rather than a pending edit.
  useEffect(() => {
    engine.setValue(value)
  }, [engine, value])

  useEffect(() => {
    engine.setEnabled(enabled)
  }, [engine, enabled])

  useEffect(() => {
    engine.setCanSave(canSave)
  }, [engine, canSave])

  useEffect(() => {
    return () => engine.dispose()
  }, [engine])

  const snapshot = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  )

  return {
    ...snapshot,
    flush: engine.flush,
    retry: engine.retry,
  }
}

export type { AutoSaveEngineOptions }
