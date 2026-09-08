import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/*.tsbuildinfo", "coverage/**", "playwright-report/**", "test-results/**"],
  },

  // Baseline for every TypeScript file, including the config files and database
  // scripts that sit outside the two build tsconfigs.
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // TypeScript resolves identifiers itself, and the base rule does not know
      // about DOM or Node globals under a flat config.
      "no-undef": "off",
      // Express identifies an error handler by its arity, so `_next` has to stay
      // in the signature even though nothing calls it.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Type-aware rules, limited to the files a build tsconfig actually covers.
  // Mostly for no-floating-promises: nearly everything here is async, and a
  // forgotten await on a money call would be silent.
  {
    files: ["server/src/**/*.ts", "client/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Tests assert against fixtures they set up themselves, so non-null assertions
  // are fine there.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Last, so it can switch off anything that would fight the formatter.
  prettier,
);
