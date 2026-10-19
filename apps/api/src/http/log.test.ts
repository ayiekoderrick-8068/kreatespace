import { describe, expect, it } from "vitest";
import { describeError } from "./log.js";

describe("describeError", () => {
  it("keeps the kind and the readable last line, and drops the query and its values", () => {
    const error = Object.assign(
      new Error(
        [
          "Invalid `prisma.user.create()` invocation:",
          "{ data: { email: 'maria@example.com', fullName: 'Maria Wanjiku' } }",
          "Unique constraint failed on the fields: (`email`)",
        ].join("\n"),
      ),
      { name: "PrismaClientKnownRequestError", code: "P2002" },
    );
    const summary = describeError(error);
    expect(summary).toMatchObject({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      message: "Unique constraint failed on the fields: (`email`)",
    });
    expect(JSON.stringify(summary)).not.toContain("maria@example.com");
    expect(JSON.stringify(summary)).not.toContain("Maria Wanjiku");
  });

  it("limits the stack and copes with things that are not errors", () => {
    const stack = describeError(new Error("secret-token-123")).stack;
    expect(stack.split("\n").length).toBeLessThanOrEqual(5);
    expect(stack).not.toContain("secret-token-123");
    expect(describeError("a string with a secret token abc123")).toEqual({
      name: "string",
      message: "",
      stack: "",
    });
    expect(describeError(undefined).name).toBe("undefined");
  });
});
