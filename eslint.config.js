import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        structuredClone: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        MessageChannel: 'readonly',
        MessagePort: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      // ─── Error Prevention ───
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // ─── Best Practices ───
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-throw-literal': 'error',
      'no-useless-catch': 'error',
      'no-control-regex': 'off', // Terminal ANSI stripping needs control chars in regex
      'no-return-await': 'warn',
      'prefer-promise-reject-errors': 'error',

      // ─── Empty Blocks (catches the 22 bare catch {} blocks) ───
      'no-empty': ['error', { allowEmptyCatch: false }],

      // ─── Style (non-fixable, keep consistent) ───
      'prefer-const': 'warn',
      'no-var': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'warn',

      // ─── Async/Promise ───
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'off', // Intentional in agent loop
      'no-promise-executor-return': 'warn',

      // ─── Imports ───
      'no-duplicate-imports': 'error',

      // ─── Relaxed for CLI project ───
      'no-process-exit': 'off', // CLI tools need process.exit
      'no-console': 'off',      // CLI tool, console is the UI
    },
  },
  {
    // Test files can use globals from vitest
    files: ['tests/**/*.test.{js,jsx}', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off', // Test files often have setup vars
    },
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.windop-backups/**',
      'tests/ui/**', // Invalid UI tests (no src/ui/ exists)
    ],
  },
];
