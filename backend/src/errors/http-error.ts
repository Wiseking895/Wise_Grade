export class HttpError extends Error {
  readonly statusCode: number
  readonly details?: unknown
  /**
   * Stable machine-readable reason. Clients use it to distinguish, for example,
   * an expired session from a missing cookie, a CSRF origin failure, a password
   * validation error or a generic server failure without parsing prose.
   */
  readonly code?: string

  constructor(
    statusCode: number,
    message: string,
    details?: unknown,
    code?: string,
  ) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.details = details
    this.code = code
  }
}
