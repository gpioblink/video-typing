import parser from '@typescript-eslint/parser';
export default [{ ignores: ['node_modules/**', '.output/**', '.wxt/**', 'dist/**', 'playwright-report/**', 'test-results/**'] }, {
  files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
  languageOptions: { parser, ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: {
    'no-debugger': 'error', 'no-duplicate-imports': 'error', 'no-unreachable': 'error',
    'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
    'no-unsafe-finally': 'error', 'valid-typeof': 'error', 'eqeqeq': ['error', 'always', { null: 'ignore' }],
  },
}];
