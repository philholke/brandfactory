import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: '@brandfactory/web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
})
