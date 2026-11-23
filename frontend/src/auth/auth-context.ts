import { createContext } from 'react'
import type {
  AuthSession,
  AuthState,
  RegisterSchoolInput,
  SessionEndReason,
  SubjectSession,
} from './types'

export interface AuthContextValue extends AuthState {
  login(email: string, password: string): Promise<AuthSession>
  registerSchool(input: RegisterSchoolInput): Promise<void>
  /**
   * Opens a restricted subject session from a reusable access code. No User,
   * membership or password is created.
   */
  enterAccessCode(code: string): Promise<SubjectSession>
  /** Confirms a single-use email-verification token and refreshes the session. */
  confirmEmailVerification(token: string): Promise<string>
  /** Requests a new verification link, invalidating the previous one. */
  resendEmailVerification(): Promise<string>
  /** Replaces the current password and clears any forced-change flag. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>
  logout(reason?: SessionEndReason): Promise<void>
  refresh(): Promise<void>
  /** Human-readable notice shown after an idle or expired session ends. */
  sessionNotice: string | null
  dismissSessionNotice(): void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
