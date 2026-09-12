export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string, code = "BAD_REQUEST"): HttpError {
  return new HttpError(400, code, message);
}

export function unauthorized(message = "Authentication required"): HttpError {
  return new HttpError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Not allowed"): HttpError {
  return new HttpError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, "NOT_FOUND", message);
}

export function conflict(message: string, code = "CONFLICT"): HttpError {
  return new HttpError(409, code, message);
}
