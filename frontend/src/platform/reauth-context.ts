import { createContext, useContext } from 'react'

export interface ReauthContextValue {
  /**
   * Opens the reauthentication dialog and resolves with a short-lived,
   * single-use grant token, or null when the administrator cancels.
   */
  ensureReauth: (purpose: string, description?: string) => Promise<string | null>
}

export const ReauthContext = createContext<ReauthContextValue | null>(null)

export function usePlatformReauth(): ReauthContextValue {
  const context = useContext(ReauthContext)

  if (!context) {
    throw new Error(
      'usePlatformReauth must be used inside PlatformReauthProvider',
    )
  }

  return context
}
