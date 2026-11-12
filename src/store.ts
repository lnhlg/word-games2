import { create } from 'zustand'
import { createSession, listSessions, type SessionMeta } from './api'

interface AppState {
  sessions: SessionMeta[]
  currentId: string | null
  loading: boolean
  creating: boolean
  error: string | null
  load: () => Promise<void>
  create: () => Promise<void>
  select: (id: string | null) => void
}

export const useApp = create<AppState>((set, get) => ({
  sessions: [],
  currentId: null,
  loading: false,
  creating: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const sessions = await listSessions()
      set({
        sessions,
        loading: false,
        currentId: get().currentId ?? sessions[0]?.id ?? null,
      })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  create: async () => {
    set({ creating: true, error: null })
    try {
      const session = await createSession()
      set({ creating: false, sessions: [session, ...get().sessions], currentId: session.id })
    } catch (e) {
      set({ creating: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  select: (id) => set({ currentId: id }),
}))
