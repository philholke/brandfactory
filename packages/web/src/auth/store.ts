import { create } from 'zustand'

const TOKEN_KEY = 'bf_token'

interface AuthState {
  token: string | null
  userId: string | null
  setAuth: (token: string, userId: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: typeof window !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null,
  userId: null,
  setAuth: (token, userId) => {
    sessionStorage.setItem(TOKEN_KEY, token)
    set({ token, userId })
  },
  logout: () => {
    sessionStorage.removeItem(TOKEN_KEY)
    set({ token: null, userId: null })
  },
}))

// Safe to call outside React (beforeLoad, API client interceptors).
export function getAuthToken(): string | null {
  return useAuthStore.getState().token
}
