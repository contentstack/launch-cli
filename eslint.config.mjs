// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{js,ts}'],
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@/semi': ['error'],
      '@typescript-eslint/array-type': ['error'],
      '@/no-throw-literal': ['error'],
      quotes: 'off',
      '@/quotes': ['error', 'single'],
      'max-len': ['error', { code: 120 }],
      '@typescript-eslint/no-namespace': 'off',
      "indent": [
        "error",
        2
      ]
    },
  },
);
