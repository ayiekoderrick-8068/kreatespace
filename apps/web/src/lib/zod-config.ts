import { config } from "zod";

// By default zod compiles a faster checker for each schema with `new Function(...)`. The
// website's content security policy forbids that (and reports a violation on every page load
// even though zod falls back safely), so the compiler is switched off. Validation is still
// instant at the size of KreateSpace's forms. This module must be imported before any schema is
// created, so it is the first import in main.tsx.
config({ jitless: true });
