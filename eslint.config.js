// Lints the kit, the example app, tests and scripts. Run with: npm run lint
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "example/.expo/**", "**/*.d.ts"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // Rules of Hooks + exhaustive deps, plus the React Compiler-era rules (refs during render,
  // setState in effects, …) for everything that renders.
  {
    files: ["components/**/*.{ts,tsx}", "example/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
  },

  // CLI scripts print on purpose.
  { files: ["scripts/**"], rules: { "no-console": "off" } },

  // Expo/Metro/Babel/Tailwind config files are CommonJS.
  {
    files: ["example/*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
