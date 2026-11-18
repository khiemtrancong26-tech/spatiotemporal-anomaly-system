import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' } },
  { files: ['**/*.ts'], languageOptions: { parserOptions: { project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname } }, rules: {
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/only-throw-error': 'error',
    '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
  } },
);
