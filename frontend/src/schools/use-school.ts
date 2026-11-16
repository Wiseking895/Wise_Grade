import { useContext } from 'react'
import { SchoolContext, type SchoolContextValue } from './school-context'

export function useSchool(): SchoolContextValue {
  const context = useContext(SchoolContext)

  if (!context) {
    throw new Error('useSchool must be used inside SchoolProvider')
  }

  return context
}
