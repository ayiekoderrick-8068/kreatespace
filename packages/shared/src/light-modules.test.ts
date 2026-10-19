import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Public pages import small helpers from this package (phone formatting, WhatsApp links, county
// lists). If one of those files imported the validation library, every visitor's first page would
// download it (about 24 KB compressed) even though only forms need it. Validation schemas live in
// other files on purpose.
const LIGHT_MODULES = ["kenya", "legal", "phone", "quotes", "urls", "whatsapp"];

const sourceOf = (name: string) => readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");

describe("modules that public pages rely on stay free of the validation library", () => {
  it.each(LIGHT_MODULES)("%s.ts does not import zod or a schema file", (name) => {
    const imports = [...sourceOf(name).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports).not.toContain("zod");
    for (const imported of imports) {
      if (imported.startsWith("./")) {
        const target = imported.replace(/^\.\//, "").replace(/\.js$/, "");
        expect(LIGHT_MODULES, `${name}.ts imports ${imported}`).toContain(target);
      }
    }
  });
});
