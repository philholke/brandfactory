import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/server',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
