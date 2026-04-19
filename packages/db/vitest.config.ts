import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/db',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
