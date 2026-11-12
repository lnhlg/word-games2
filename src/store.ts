import { create } from 'zustand'
import {
  createSession,
  getWorkspaces,
  listSessions,
  openWorkspace as openWorkspaceApi,
  type SessionMeta,
  type Workspace,
} from './api'

interface AppState {
  workspaces: Workspace[]
  currentWorkspace: string | null
  sessions: SessionMeta[]
  currentId: string | null
  loading: boolean
  creating: boolean
  error: string | null
  load: () => Promise<void>
  openWorkspace: (path: string) => Promise<void>
  create: () => Promise<void>
  select: (id: string | null) => void
}

export const useApp = create<AppState>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,
  sessions: [],
  currentId: null,
  loading: false,
  creating: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const registry = await getWorkspaces()
      const sessions = registry.current ? await listSessions(registry.current) : []
      set({
        workspaces: registry.workspaces,
        currentWorkspace: registry.current,
        sessions,
        loading: false,
        currentId: get().currentId ?? sessions[0]?.id ?? null,
      })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  openWorkspace: async (path) => {
    set({ loading: true, error: null })
    try {
      const registry = await openWorkspaceApi(path)
      const sessions = registry.current ? await listSessions(registry.current) : []
      set({
        workspaces: registry.workspaces,
        currentWorkspace: registry.current,
        sessions,
        loading: false,
        currentId: sessions[0]?.id ?? null,
      })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  },

  create: async () => {
    const workspace = get().currentWorkspace
    if (!workspace) {
      set({ error: '先打开一个工作区' })
      return
    }
    set({ creating: true, error: null })
    try {
      const session = await createSession(workspace)
      set({ creating: false, sessions: [session, ...get().sessions], currentId: session.id })
    } catch (e) {
      set({ creating: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  select: (id) => set({ currentId: id }),
}))
