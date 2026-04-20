import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENV_SCHEMA_KEYS } from './env'

// Drift guard: every key declared in `EnvObject` (re-exported as
// `ENV_SCHEMA_KEYS`) must appear in the repo-root `.env.example`, either
// active (`KEY=...`) or commented (`# KEY=...`). The file exists to give
// new contributors a copy-pasteable starting point, and silent drift is
// the main failure mode when the schema widens.

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..')
const ENV_EXAMPLE_PATH = join(REPO_ROOT, '.env.example')

function envExampleKeys(): Set<string> {
  const body = readFileSync(ENV_EXAMPLE_PATH, 'utf8')
  const keys = new Set<string>()
  for (const rawLine of body.split('\n')) {
    // Strip a single leading `#` + optional whitespace so commented-out
    // assignments count as "documented".
    const line = rawLine.replace(/^\s*#\s?/, '').trim()
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line)
    if (match?.[1]) keys.add(match[1])
  }
  return keys
}

describe('.env.example drift guard', () => {
  it('documents every EnvSchema key', () => {
    const documented = envExampleKeys()
    const missing = ENV_SCHEMA_KEYS.filter((k) => !documented.has(k as string))
    expect(missing, `missing from .env.example: ${missing.join(', ')}`).toEqual([])
  })
})
