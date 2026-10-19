/**
 * A summary of an error that is safe to write to logs: what kind it was, where it came from, and
 * the human-readable last line of its message. Database errors put the query and its values at
 * the top of the message, so the full object is never logged.
 */
export function describeError(error: unknown): {
  name: string;
  code?: string;
  message: string;
  stack: string;
} {
  if (!(error instanceof Error)) return { name: typeof error, message: "", stack: "" };
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === "string" ? { code } : {}),
    message: error.message.split("\n").pop() ?? "",
    // The first line of a stack repeats the whole message, so only the frames are kept.
    stack: (error.stack ?? "")
      .split("\n")
      .filter((line) => line.trimStart().startsWith("at "))
      .slice(0, 5)
      .join("\n"),
  };
}
