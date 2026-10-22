import toolkit from '@electron-toolkit/eslint-config-ts'

export default toolkit.config(
  {
    ignores: ['node_modules/**', '.claude/**', 'out/**', 'dist/**', 'build/**', 'resources/**',
      'engine/.venv/**', 'engine-venv/**', 'engine-bin/**',
      // Design mockups exported from Claude Design: reference only, not app code.
      'docs/design/**']
  },
  toolkit.configs.recommended,
  {
    files: ['scripts/**/*.cjs', 'scripts/icon/*.js', 'tests/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    files: ['tests/**/*.cjs'],
    rules: { '@typescript-eslint/no-empty-function': 'off' }
  }
)
