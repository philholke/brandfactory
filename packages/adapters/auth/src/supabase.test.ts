import { describe, it, expect } from 'vitest'
import { SignJWT, generateKeyPair, exportJWK, type JWK, type KeyLike } from 'jose'
import { createSupabaseAuthProvider } from './supabase'
import { InvalidTokenError } from './port'

const ISSUER = 'https://issuer.test'
const AUDIENCE = 'authenticated'

async function makeKeySet() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = (await exportJWK(publicKey)) as JWK
  jwk.kid = 'test-kid'
  jwk.alg = 'RS256'
  jwk.use = 'sig'
  return { privateKey, jwks: async () => publicKey }
}

async function signToken(privateKey: KeyLike, claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(typeof claims.sub === 'string' ? claims.sub : 'user-1')
    .setIssuedAt()
    .setExpirationTime(typeof claims.exp === 'number' ? claims.exp : '5m')
    .sign(privateKey)
}

describe('createSupabaseAuthProvider', () => {
  it('verifies a valid token and returns the sub as userId', async () => {
    const { privateKey, jwks } = await makeKeySet()
    const auth = createSupabaseAuthProvider(
      { jwksUrl: 'https://example.test/keys', audience: AUDIENCE, issuer: ISSUER },
      { jwks, getUserById: async () => null },
    )
    const token = await signToken(privateKey, { sub: 'abc-123' })
    const { userId } = await auth.verifyToken(token)
    expect(userId).toBe('abc-123')
  })

  it('rejects an expired token', async () => {
    const { privateKey, jwks } = await makeKeySet()
    const auth = createSupabaseAuthProvider(
      { jwksUrl: 'https://example.test/keys', audience: AUDIENCE, issuer: ISSUER },
      { jwks, getUserById: async () => null },
    )
    const expiredEpoch = Math.floor(Date.now() / 1000) - 60
    const token = await signToken(privateKey, { sub: 'abc-123', exp: expiredEpoch })
    await expect(auth.verifyToken(token)).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it('rejects a token with no sub claim', async () => {
    const { privateKey, jwks } = await makeKeySet()
    const auth = createSupabaseAuthProvider(
      { jwksUrl: 'https://example.test/keys', audience: AUDIENCE, issuer: ISSUER },
      { jwks, getUserById: async () => null },
    )
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    await expect(auth.verifyToken(token)).rejects.toBeInstanceOf(InvalidTokenError)
  })
})
