import { describe, it, expect } from 'vitest'
import type { User } from '@brandfactory/db'
import { createLocalAuthProvider } from './local'
import { InvalidTokenError } from './port'

const VALID_UUID = '11111111-2222-3333-4444-555555555555'

function makeUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@example.com`,
    displayName: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as User
}

describe('createLocalAuthProvider', () => {
  it('verifyToken accepts a uuid that resolves to a user', async () => {
    const auth = createLocalAuthProvider({
      getUserById: async (id) => (id === VALID_UUID ? makeUser(VALID_UUID) : null),
    })
    const { userId } = await auth.verifyToken(VALID_UUID)
    expect(userId).toBe(VALID_UUID)
  })

  it('verifyToken rejects a non-uuid token', async () => {
    const auth = createLocalAuthProvider({ getUserById: async () => null })
    await expect(auth.verifyToken('not-a-uuid')).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it('verifyToken rejects when user is missing', async () => {
    const auth = createLocalAuthProvider({ getUserById: async () => null })
    await expect(auth.verifyToken(VALID_UUID)).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it('getUserById delegates to the lookup', async () => {
    const auth = createLocalAuthProvider({
      getUserById: async (id) => makeUser(id),
    })
    const user = await auth.getUserById(VALID_UUID)
    expect(user?.id).toBe(VALID_UUID)
  })
})
