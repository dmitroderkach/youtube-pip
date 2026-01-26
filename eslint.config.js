import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-private-class-members': 'off',
      '@typescript-eslint/no-unused-private-class-members': 'error',
      // Require await or explicit void for async function calls
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: true,
          ignoreIIFE: false,
        },
      ],
      // Prevent misuse of Promises in conditions, comparisons, etc.
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksConditionals: true,
          checksVoidReturn: false,
        },
      ],
    },
  },
  eslintConfigPrettier,
];
