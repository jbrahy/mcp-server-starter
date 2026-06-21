// Flat ESLint config (ESM). Enforces the stdout-purity discipline at the lint
// layer: console.* is banned across src/** because any write to fd 1 in stdio
// mode corrupts JSON-RPC framing, and even console.error (fd 2) bypasses the
// structured logger and its secret redaction. See shared/docs/01-transport.md
// and shared/docs/03-observability.md.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='console']",
          message:
            "console.* is banned: it corrupts stdout JSON-RPC framing in stdio mode and bypasses the structured logger + secret redaction. Use the pino logger bound to fd 2.",
        },
      ],
    },
  },
];
