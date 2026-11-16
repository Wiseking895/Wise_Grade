import type { PlatformOperationsRepository } from './operations-repository.js'
import type {
  PlatformNotificationInput,
  PlatformNotificationRecord,
} from './operations-types.js'

export interface PlatformNotifier {
  /**
   * Best-effort notification sink. A notification failure must never fail the
   * business operation that triggered it, and a retried job must be idempotent
   * through `dedupeKey`.
   */
  notify(input: PlatformNotificationInput): Promise<PlatformNotificationRecord | null>
}

export function createPlatformNotifier(
  repository: PlatformOperationsRepository,
  logger: (message: string) => void = (message) => console.error(message),
): PlatformNotifier {
  return {
    async notify(input) {
      try {
        return await repository.createNotification(input)
      } catch (error) {
        logger(
          `[gradely-api] failed to create platform notification (${input.type}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return null
      }
    },
  }
}

/** A no-op sink for tests and deployments without the operations repository. */
export const silentNotifier: PlatformNotifier = {
  async notify() {
    return null
  },
}
