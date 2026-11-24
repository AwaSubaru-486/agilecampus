import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Electron main/preload and native Node tests deliberately use CommonJS.
  { files: ["desktop-pet/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "vscode-extension/dist/**",
    "vscode-extension/node_modules/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
