/**
 * Timezone-safe helpers for school operational session dates.
 *
 * School session dates are stored as date-only columns (`@db.Date`) and are
 * treated as school-local calendar days, never converted through UTC in a way
 * that shifts them to a neighbouring day. The authoritative "has the session
 * closed?" check compares the school-local calendar date of "now" against the
 * configured closing date, so it is correct for every IANA timezone including
 * zones with daylight-saving changes.
 */

export const DEFAULT_SCHOOL_TIMEZONE = 'Africa/Accra'

/** Parses a `YYYY-MM-DD` calendar date into a UTC-midnight Date. */
export function parseSchoolDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/**
 * Returns the school-local calendar date of `now` as `YYYY-MM-DD`, falling back
 * to the UTC date when the stored timezone identifier is not usable.
 */
export function schoolLocalDate(
  now: Date,
  timeZone: string,
): string {
  const formatter = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

  try {
    return formatter(timeZone).format(now)
  } catch {
    return formatter('UTC').format(now)
  }
}

/**
 * True once the school-local date has passed the configured closing date.
 * A code remains usable throughout the entire closing day.
 */
export function isSchoolSessionClosed(
  now: Date,
  closingDate: string,
  timeZone: string,
): boolean {
  return schoolLocalDate(now, timeZone) > closingDate
}

/**
 * A coarse UTC instant used only to store an informational expiry timestamp on
 * access-code records. The authoritative check is `isSchoolSessionClosed`; this
 * value exists so `SubjectTeacherInvitation.expiresAt` (non-null) carries a
 * sensible snapshot rather than the old fixed seven-day offset.
 */
export function closingDateBoundary(closingDate: string): Date {
  return new Date(parseSchoolDate(closingDate).getTime() + 24 * 60 * 60 * 1000)
}
