import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs'] },

  // ── Base JS recommended rules ─────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript type-aware rules ───────────────────────────────────
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // ── Per-project tsconfig mapping ──────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Custom rules ──────────────────────────────────────────────────
  {
    rules: {
      // Unused vars: error, but allow _ prefixed and rest siblings
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Allow non-null assertions (we use them intentionally with DOM)
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allow empty functions (event handler stubs)
      '@typescript-eslint/no-empty-function': 'off',
      // Allow numbers in template literals (very common in game code)
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Warn on floating promises (missing await)
      '@typescript-eslint/no-floating-promises': 'error',
      // Prefer const over let when no reassignment
      'prefer-const': 'error',
      // Enforce === over ==
      eqeqeq: ['error', 'always'],
      // Prefer template literals over string concatenation
      'prefer-template': 'error',
      // Prefer shorthand properties in objects
      'object-shorthand': 'error',
      // No else after return
      'no-else-return': 'error',
      // No console.log in production code (warn so it's visible)
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // ── Test files: relax some rules ──────────────────────────────────
  {
    files: ['**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-console': 'off',
    },
  },

  // ── Scripts: disable type-checked rules for one-off scripts ────────
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['scripts/**/*.ts'],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },

  // ── Disable formatting rules (Prettier handles those) ─────────────
  prettierConfig,
)
