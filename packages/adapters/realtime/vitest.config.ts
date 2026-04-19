import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/adapter-realtime',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
