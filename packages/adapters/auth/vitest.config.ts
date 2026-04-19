import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/adapter-auth',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
