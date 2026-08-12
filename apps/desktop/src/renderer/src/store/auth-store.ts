import { create } from 'zustand'
import type { AuthUser } from '../../../shared/ipc-types'

type AuthStore = {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null

  setUser: (user: AuthUser | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,

  setUser: (user) => set({ user, isAuthenticated: user !== null, isLoading: false, error: null }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false })
}))
