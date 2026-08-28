import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The contract forbids `any` in exported signatures; make it an error, not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused args prefixed with _ are intentional (interface conformance).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Every error must be a SkilledError; a bare throw is a defect per the contract.
      'no-throw-literal': 'error',
    },
  },
);
