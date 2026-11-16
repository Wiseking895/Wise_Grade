import { useCallback, useEffect, useState } from 'react'
import { listAcademicYears } from '../schools/api'
import type { AcademicTerm, AcademicYear } from '../schools/types'

export interface TermOption {
  yearId: string
  yearName: string
  termId: string
  termName: string
  label: string
  isCurrent: boolean
}

function buildOptions(years: AcademicYear[]): TermOption[] {
  return years.flatMap((year) =>
    year.terms.map((term) => ({
      yearId: year.id,
      yearName: year.name,
      termId: term.id,
      termName: term.name,
      label: `${year.name} · ${term.name}`,
      isCurrent: year.isCurrent && term.isCurrent,
    })),
  )
}

function preferredOption(options: TermOption[]): TermOption | undefined {
  return options.find((option) => option.isCurrent) ?? options[0]
}

export function useAcademicTerms(schoolId: string | null) {
  const [years, setYears] = useState<AcademicYear[]>([])
  const [options, setOptions] = useState<TermOption[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schoolId) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const response = await listAcademicYears(schoolId)
      const nextOptions = buildOptions(response.academicYears)
      const preferred = preferredOption(nextOptions)

      setYears(response.academicYears)
      setOptions(nextOptions)
      setSelectedTermId((current) =>
        nextOptions.some((option) => option.termId === current)
          ? current
          : (preferred?.termId ?? ''),
      )
      setError(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load the academic calendar.',
      )
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const selected =
    options.find((option) => option.termId === selectedTermId) ?? null

  return {
    years,
    options,
    selected,
    selectedTermId,
    setSelectedTermId,
    loading,
    error,
    reload: load,
  }
}

export function termOptionFor(
  options: TermOption[],
  termId: string,
): TermOption | null {
  return options.find((option) => option.termId === termId) ?? null
}

export function termName(
  years: AcademicYear[],
  termId: string,
): string | null {
  for (const year of years) {
    const term: AcademicTerm | undefined = year.terms.find(
      (item) => item.id === termId,
    )

    if (term) return `${year.name} · ${term.name}`
  }

  return null
}
