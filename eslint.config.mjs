// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['jest.config.js'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'writable',
      },
    },
  },
  {
    files: ['src/**/*.{js,ts}', 'test/**/*.{js,ts}'],
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@/semi': ['error'],
      '@typescript-eslint/array-type': ['error'],
      '@/no-throw-literal': ['error'],
      quotes: 'off',
      '@/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'max-len': ['error', { code: 120 }],
      '@typescript-eslint/no-namespace': 'off',
      indent: ['error', 2],
      '@/eol-last': ['error', 'always'],
      '@/no-multiple-empty-lines': ['error', { max: 1 }],
      '@/object-curly-spacing': ['error', 'always'],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error'],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      'max-len': 'off',
    },
  },
  {
    files: ['test/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'writable',
        Buffer: 'readonly',
      },
    },
    rules: {
      'max-len': 'off',
    },
  },
);
