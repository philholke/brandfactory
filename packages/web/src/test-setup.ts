import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react's automatic cleanup only runs when `globals: true` is
// set on the test runner. It is — but be explicit anyway: cleanup unmounts
// every rendered component after each test, so the jsdom DOM is empty going
// into the next one. Without this, tests rendering similarly-named buttons
// clash on `getByRole`.
afterEach(() => {
  cleanup()
})
