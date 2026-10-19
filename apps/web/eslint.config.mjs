import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import rootConfig from "../../eslint.config.mjs";

export default tseslint.config(...rootConfig, {
  files: ["src/**/*.{ts,tsx}"],
  languageOptions: {
    globals: { ...globals.browser },
  },
  plugins: { "react-hooks": reactHooks },
  rules: {
    ...reactHooks.configs.recommended.rules,
  },
});
