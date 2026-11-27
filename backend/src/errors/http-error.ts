export class HttpError extends Error {
  readonly statusCode: number
  readonly details?: unknown
  /**
   * Stable machine-readable reason. Clients use it to distinguish, for example,
   * an expired session from a missing cookie, a CSRF origin failure, a password
   * validation error or a generic server failure without parsing prose.
   */
  readonly code?: string
  /**
   * Structured, non-validation payload for clients that need to render a
   * decision dialog (for example the existing pupil that conflicts with a new
   * registration). Kept separate from `details`, which stays a list of field
   * errors for forms.
   */
  readonly meta?: unknown

  constructor(
    statusCode: number,
    message: string,
    details?: unknown,
    code?: string,
    meta?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.details = details
    this.code = code
    this.meta = meta
  }
}
