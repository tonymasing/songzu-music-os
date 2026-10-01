import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      ".desktop-app/**",
      ".electron-app/**",
      ".electron-package/**",
      ".next/**",
      "output/**",
      ".cache/**",
      "android/**",
      "ios/**",
      "next-env.d.ts",
      "dist/**",
      "dist-electron/**",
      "dist-mobile/**",
      "exports/**",
      "node_modules/**",
      "prisma/dev.db",
      "uploads/**"
    ]
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    }
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  }
];
