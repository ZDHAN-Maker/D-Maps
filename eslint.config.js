import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'pipeline', 'public', 'data', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Offline guarantee: no hard-coded remote endpoints in application code.
      'no-restricted-syntax': ['error', {
        selector: "Literal[value=/^https?:\\/\\/(?!(?:127\\.0\\.0\\.1|localhost)(?::|\\/|$)|www\\.openstreetmap\\.org\\/copyright|www\\.openstreetmap\\.org$|opendatacommons\\.org|leafletjs\\.com|www\\.w3\\.org)/]",
        message: 'Remote URL literal in app code. D\'Maps core features must not call remote services (see docs/architecture.md).',
      }],
    },
  },
);
