// @ts-check
import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
      '**/dist/**',
      '**/build/**',
    ],
  },
  ...tanstackConfig,
  {
    rules: {
      'max-params': ['error', { max: 3 }],
    },
  },
]
