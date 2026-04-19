import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/adapter-storage',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
