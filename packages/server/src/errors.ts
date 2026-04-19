// Minimal error boundary. Phase 9 replaces this with the full `AppError`
// taxonomy; the wire shape (`{ code, message, details? }`) is the stable
// contract.

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'unauthorized') {
    super(401, 'UNAUTHORIZED', message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'forbidden') {
    super(403, 'FORBIDDEN', message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'not found', code = 'NOT_FOUND') {
    super(404, code, message)
    this.name = 'NotFoundError'
  }
}

// Reserved for business-rule validation failures. Zod boundary errors
// surface as `ZodError` and are handled separately in `onError`.
export class ValidationError extends HttpError {
  constructor(message = 'validation failed', details?: unknown) {
    super(400, 'VALIDATION', message, details)
    this.name = 'ValidationError'
  }
}
