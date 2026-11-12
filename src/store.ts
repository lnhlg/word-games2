import { create } from 'zustand'
import {
  createSession,
  deleteSession,
  exportSession,
  getSession,
  getWorkspaces,
  listSessions,
  openWorkspace as openWorkspaceApi,
  patchSession,
  pickWorkspace,
  rollbackSession as rollbackSessionApi,
  streamTurn,
  type SessionMeta,
  type Workspace,
} from './api'
import type { GameState, MessageRecord, TurnEvent } from './types'

export interface ToolCard {
  id: string
  name: string
  args: unknown
  result?: unknown
  ok?: boolean
}

interface AppState {
  workspaces: Workspace[]
  currentWorkspace: string | null
  sessions: SessionMeta[]
  currentId: string | null
  loading: boolean
  creating: boolean
  error: string | null

  meta: SessionMeta | null
  messages: MessageRecord[]
  gameState: GameState | null
  sessionLoading: boolean

  streaming: boolean
  streamText: string
  liveTools: ToolCard[]
  options: string[]
  abort: AbortController | null

  load: () => Promise<void>
  pick: () => Promise<void>
  openWorkspace: (path: string) => Promise<void>
  create: () => Promise<void>
  select: (id: string | null) => void
  loadSession: (id: string) => Promise<void>
  send: (input: string) => Promise<void>
  cancel: () => void
  rename: (id: string, title: string) => Promise<void>
  setStatus: (id: string, status: SessionMeta['status']) => Promise<void>
  remove: (id: string) => Promise<void>
  exportMarkdown: (id: string) => Promise<string>
  rollback: (turn: number) => Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useApp = create<AppState>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,
  sessions: [],
  currentId: null,
  loading: false,
  creating: false,
  error: null,

  meta: null,
  messages: [],
  gameState: null,
  sessionLoading: false,

  streaming: false,
  streamText: '',
  liveTools: [],
  options: [],
  abort: null,

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
      })
      const first = get().currentId ?? sessions[0]?.id ?? null
      set({ currentId: first })
      if (first) await get().loadSession(first)
    } catch (e) {
      set({ loading: false, error: messageOf(e) })
    }
  },

  pick: async () => {
    set({ loading: true, error: null })
    try {
      const result = await pickWorkspace()
      if ('cancelled' in result) {
        set({ loading: false })
        return
      }
      if (!result.current) {
        set({ loading: false, error: '没有选中工作区' })
        return
      }
      const sessions = await listSessions(result.current)
      set({
        workspaces: result.workspaces,
        currentWorkspace: result.current,
        sessions,
        loading: false,
        currentId: sessions[0]?.id ?? null,
      })
      if (sessions[0]) await get().loadSession(sessions[0].id)
    } catch (e) {
      set({ loading: false, error: messageOf(e) })
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
      if (sessions[0]) await get().loadSession(sessions[0].id)
    } catch (e) {
      set({ loading: false, error: messageOf(e) })
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
      await get().loadSession(session.id)
    } catch (e) {
      set({ creating: false, error: messageOf(e) })
    }
  },

  select: (id) => {
    set({ currentId: id, error: null })
    if (id) void get().loadSession(id)
  },

  loadSession: async (id) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    set({ sessionLoading: true })
    try {
      const detail = await getSession(workspace, id)
      set({
        meta: detail.meta,
        messages: detail.messages,
        gameState: detail.state,
        sessionLoading: false,
        streamText: '',
        liveTools: [],
        options: [],
      })    } catch (e) {
      set({ sessionLoading: false, error: messageOf(e) })
    }
  },

  send: async (input) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id || get().streaming || !input.trim()) return

    const abort = new AbortController()
    const meta = get().meta
    set({
      streaming: true,
      streamText: '',
      liveTools: [],
      options: [],
      abort,
      error: null,
      messages: [
        ...get().messages,
        { role: 'player', turn: meta?.turn ?? 0, at: new Date().toISOString(), text: input },
      ],
    })

    const apply = (event: TurnEvent) => {
      const state = get()
      switch (event.type) {
        case 'turn_start':
          set({ streamText: '', liveTools: [], options: [] })
          break
        case 'delta':
          set({ streamText: state.streamText + event.text })
          break
        case 'tool_call':
          set({ liveTools: [...state.liveTools, { id: event.id, name: event.name, args: event.args }] })
          break
        case 'tool_result':
          set({
            liveTools: state.liveTools.map((tool) =>
              tool.id === event.id ? { ...tool, ok: event.ok, result: event.result } : tool,
            ),
          })
          break
        case 'options':
          set({ options: event.options })
          break
        case 'state':
          set({ gameState: event.state })
          break
        case 'error':
          set({ error: event.message })
          break
        default:
          break
      }
    }

    try {
      await streamTurn(workspace, id, input, apply, abort.signal)
    } catch (e) {
      if (!abort.signal.aborted) set({ error: messageOf(e) })
    } finally {
      set({ streaming: false, abort: null })
      await get().loadSession(id)
      const sessions = get().currentWorkspace ? await listSessions(get().currentWorkspace!) : []
      set({ sessions })
    }
  },

  cancel: () => {
    get().abort?.abort()
    set({ streaming: false, abort: null })
  },

  rename: async (id, title) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const meta = await patchSession(workspace, id, { title })
      set({
        sessions: get().sessions.map((session) => (session.id === id ? meta : session)),
        meta: get().meta?.id === id ? meta : get().meta,
        error: null,
      })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  setStatus: async (id, status) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const meta = await patchSession(workspace, id, { status })
      set({
        sessions: get().sessions.map((session) => (session.id === id ? meta : session)),
        meta: get().meta?.id === id ? meta : get().meta,
        error: null,
      })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  remove: async (id) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      await deleteSession(workspace, id)
      const sessions = get().sessions.filter((session) => session.id !== id)
      if (get().currentId === id) {
        const next = sessions[0]?.id ?? null
        set({ sessions, currentId: next, meta: null, messages: [], gameState: null, options: [], error: null })
        if (next) await get().loadSession(next)
      } else {
        set({ sessions, error: null })
      }
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  exportMarkdown: (id) => {
    const workspace = get().currentWorkspace
    if (!workspace) return Promise.reject(new Error('先打开一个工作区'))
    return exportSession(workspace, id)
  },

  rollback: async (turn) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id) return
    try {
      const result = await rollbackSessionApi(workspace, id, turn)
      set({
        meta: result.meta,
        messages: result.messages,
        gameState: result.state,
        streamText: '',
        liveTools: [],
        options: [],
        sessions: get().sessions.map((session) => (session.id === id ? result.meta : session)),
        error: null,
      })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },
}))
