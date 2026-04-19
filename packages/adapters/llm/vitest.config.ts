import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/adapter-llm',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
