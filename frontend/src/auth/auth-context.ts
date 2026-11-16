import { createContext } from 'react'
import type {
  AuthSession,
  AuthState,
  RegisterSchoolInput,
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
  logout(): Promise<void>
  refresh(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
