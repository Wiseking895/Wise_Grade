const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(`${value.slice(0, 10)}T00:00:00`)

  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date)
}

export function pupilName(pupil: {
  firstName: string
  lastName: string
  otherNames?: string | null
}): string {
  return [pupil.firstName, pupil.otherNames, pupil.lastName]
    .filter(Boolean)
    .join(' ')
}

export function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

export function statusLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
