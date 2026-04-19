import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/agent',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
