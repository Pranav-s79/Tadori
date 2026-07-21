import type { ApiError } from "./types.js";

export interface ApiErrorResult {
  statusCode: number;
  payload: ApiError;
}

function build(statusCode: number, code: string, detail?: string): ApiErrorResult {
  return {
    statusCode,
    payload: {
      error: code,
      code,
      ...(detail === undefined ? {} : { detail })
    }
  };
}

export function badRequest(code: string, detail?: string): ApiErrorResult {
  return build(400, code, detail);
}

export function forbidden(code: string, detail?: string): ApiErrorResult {
  return build(403, code, detail);
}

export function notFound(code: string, detail?: string): ApiErrorResult {
  return build(404, code, detail);
}

export function conflict(code: string, detail?: string): ApiErrorResult {
  return build(409, code, detail);
}

export function notImplemented(code: string, detail?: string): ApiErrorResult {
  return build(501, code, detail);
}
