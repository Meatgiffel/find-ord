import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/**", "build/**", "dist/**", "data/**", "assets/**"] },
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "vite.config.ts", "svelte.config.js"],
    extends: [js.configs.recommended, ts.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] }
  },
  {
    files: ["src/**/*.svelte"],
    extends: [svelte.configs.recommended],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: [".svelte"] },
      globals: { ...globals.browser }
    }
  }
);
