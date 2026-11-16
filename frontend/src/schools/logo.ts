/**
 * Chooses the image source for the dashboard school mark.
 *
 * A school logo is rendered whenever the profile has a logo URL and that exact
 * URL has not failed to load. Tracking the failed URL (rather than a boolean)
 * means a replacement logo with a new cache-busted URL is retried immediately
 * instead of inheriting the previous failure.
 */
export function schoolLogoSrc(
  logoUrl: string | null,
  failedUrl: string | null,
): string | null {
  return logoUrl !== null && logoUrl !== failedUrl ? logoUrl : null
}
