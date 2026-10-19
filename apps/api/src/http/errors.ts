import type { ZodType } from "zod";

/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message = "Resource not found") =>
  new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const forbidden = (message = "You do not have access to this resource") =>
  new HttpError(403, "FORBIDDEN", message);

/** Parses untrusted input with a shared Zod schema, throwing a 400 with field errors. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields });
  }
  return result.data;
}
