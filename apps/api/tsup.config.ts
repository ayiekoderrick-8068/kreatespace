import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source, so bundle it into the output.
  noExternal: ["@kreatespace/shared"],
});
