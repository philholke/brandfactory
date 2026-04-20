import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getStoredTheme, resolveTheme, setStoredTheme } from './theme'

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? prefersDark : !prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  )
  // window.matchMedia is what the source reads; jsdom exposes both globals.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: globalThis.matchMedia,
  })
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getStoredTheme', () => {
    it('defaults to "system" when nothing is stored', () => {
      expect(getStoredTheme()).toBe('system')
    })

    it('returns a stored valid mode', () => {
      localStorage.setItem('bf_theme', 'dark')
      expect(getStoredTheme()).toBe('dark')
    })

    it('falls back to "system" for an unknown value', () => {
      localStorage.setItem('bf_theme', 'neon')
      expect(getStoredTheme()).toBe('system')
    })
  })

  describe('setStoredTheme', () => {
    it('writes the mode to localStorage', () => {
      setStoredTheme('light')
      expect(localStorage.getItem('bf_theme')).toBe('light')
    })
  })

  describe('resolveTheme', () => {
    it('returns the mode directly for explicit light/dark', () => {
      expect(resolveTheme('light')).toBe('light')
      expect(resolveTheme('dark')).toBe('dark')
    })

    it('resolves "system" via prefers-color-scheme: dark', () => {
      mockMatchMedia(true)
      expect(resolveTheme('system')).toBe('dark')
    })

    it('resolves "system" to light when the OS prefers light', () => {
      mockMatchMedia(false)
      expect(resolveTheme('system')).toBe('light')
    })
  })

  describe('applyTheme', () => {
    it('toggles the `.dark` class on <html> based on the resolved mode', () => {
      applyTheme('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      applyTheme('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })
})
