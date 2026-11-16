import { randomBytes } from 'node:crypto'

/**
 * Produces a URL-safe school slug, e.g. "green-valley-academy-4f2a1c".
 *
 * A short random suffix is always appended so registration never fails (or
 * retries) on slug collisions, and school slugs cannot be guessed from names.
 */
export function buildSchoolSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  const suffix = randomBytes(3).toString('hex')

  return `${base || 'school'}-${suffix}`
}
