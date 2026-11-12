import { create } from 'zustand'
import {
  applyStatusTemplate,
  createSession,
  createTemplate,
  deleteCharacter,
  deleteSession,
  deleteTemplate,
  deleteTurn as deleteTurnApi,
  editTurn as editTurnApi,
  exportSession,
  getCharacter,
  getSession,
  getSettings,
  getTemplate,
  getWorkspaces,
  importCharacter,
  listCharacters,
  listSessions,
  listTemplates,
  openWorkspace as openWorkspaceApi,
  patchSession,
  pickWorkspace,
  putSettings,
  regenerateTurn,
  saveCharacter,
  streamStudio,
  streamTurn,
  suggestTemplate,
  updateCharacter,
  updateStatusTemplate,
  updateStatusValue,
  updateTemplate,
  type Effort,
  type SessionCreateInput,
  type SessionMeta,
  type SettingsInput,
  type SettingsView,
  type Workspace,
} from './api'
import type {
  CardSummary,
  CharacterCard,
  MessageRecord,
  StatusItem,
  StatusTemplate,
  StatusView,
  StudioMessage,
  TemplateDoc,
  TemplateSummary,
  TurnEvent,
} from './types'
import { lastTurnOf } from './turns'

export type View = 'play' | 'characters' | 'status-templates'

/** 工坊自己的模型选择，不写进任何一场戏。 */
export type StudioSelection = {
  providerId: string | null
  model: string
  reasoningEffort: Effort | null
}

interface AppState {
  workspaces: Workspace[]
  currentWorkspace: string | null
  sessions: SessionMeta[]
  currentId: string | null
  loading: boolean
  creating: boolean
  error: string | null
  retryInput: string | null

  meta: SessionMeta | null
  messages: MessageRecord[]
  /** 当前这场戏的角色状态（模板 + 当前值 + 最近变化）。 */
  status: StatusView | null
  sessionLoading: boolean

  streaming: boolean
  streamText: string
  abort: AbortController | null

  view: View

  cards: CardSummary[]
  cardsLoading: boolean
  selectedCardId: string | null
  selectedCard: CharacterCard | null
  cardLoading: boolean

  /** 工作区级的状态模板库。 */
  statusTemplates: TemplateSummary[]
  statusTemplatesLoading: boolean
  selectedTemplateId: string | null
  selectedTemplate: TemplateDoc | null
  templateLoading: boolean

  studioMessages: StudioMessage[]
  studioStreaming: boolean
  studioText: string
  studioAbort: AbortController | null
  studioSelection: StudioSelection | null
  /** 非空表示工坊正在修改这张已有卡；空就是新建。 */
  studioEditId: string | null

  load: () => Promise<void>
  pick: () => Promise<void>
  openWorkspace: (path: string) => Promise<void>
  create: (input?: SessionCreateInput) => Promise<void>
  select: (id: string | null) => void
  loadSession: (id: string) => Promise<void>
  send: (input: string, options?: { retry?: boolean }) => Promise<void>
  cancel: () => void
  retry: () => Promise<void>
  regenerate: () => Promise<void>
  editNarrative: (turn: number, text: string) => Promise<{ memoryStale: boolean }>
  deleteLastTurn: () => Promise<void>
  dismissError: () => void
  rename: (id: string, title: string) => Promise<void>
  setStatus: (id: string, status: SessionMeta['status']) => Promise<void>
  setPerspective: (id: string, perspective: string) => Promise<void>
  /** 手改一个状态值。 */
  setStatusValue: (cardId: string, item: string, value: string) => Promise<void>
  /** 整份替换状态模板（增删条目后用）。 */
  saveStatusTemplate: (template: StatusTemplate) => Promise<void>
  /** 把模板库里的模板套到这个角色上（快照）；templateId 空串表示清空。 */
  applyTemplateToRole: (cardId: string, templateId: string) => Promise<void>

  loadTemplates: () => Promise<void>
  selectTemplate: (id: string | null) => Promise<void>
  createTemplateDoc: (draft: { name: string; note: string; items: StatusItem[] }) => Promise<string>
  updateTemplateDoc: (
    id: string,
    draft: { name: string; note: string; items: StatusItem[] },
  ) => Promise<void>
  deleteTemplateDoc: (id: string) => Promise<void>
  /** 让 AI 生成一组状态项；cardId 可选，不挂卡就是通用模板。 */
  suggestTemplateItems: (prompt: string, cardId?: string | null) => Promise<StatusItem[]>
  remove: (id: string) => Promise<void>
  exportMarkdown: (id: string) => Promise<string>

  setView: (view: View) => void
  loadCards: () => Promise<void>
  selectCard: (id: string | null) => Promise<void>
  editCard: (id: string, data: CharacterCard['data']) => Promise<void>
  deleteCard: (id: string, force?: boolean) => Promise<void>
  importCard: (file: File) => Promise<void>

  studioSend: (text: string) => Promise<void>
  studioCancel: () => void
  studioReset: () => void
  studioStartEdit: (id: string) => void
  studioStopEdit: () => void
  setStudioSelection: (selection: StudioSelection) => void

  settings: SettingsView | null
  loadSettings: () => Promise<void>
  saveSettings: (input: SettingsInput) => Promise<void>
  setSelection: (
    id: string,
    selection: { providerId: string | null; model: string; reasoningEffort: Effort | null },
  ) => Promise<void>
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
  retryInput: null,

  meta: null,
  messages: [],
  status: null,
  sessionLoading: false,

  streaming: false,
  streamText: '',
  abort: null,

  view: 'play',

  cards: [],
  cardsLoading: false,
  selectedCardId: null,
  selectedCard: null,
  cardLoading: false,

  statusTemplates: [],
  statusTemplatesLoading: false,
  selectedTemplateId: null,
  selectedTemplate: null,
  templateLoading: false,

  studioMessages: [],
  studioStreaming: false,
  studioText: '',
  studioAbort: null,
  studioSelection: null,
  studioEditId: null,

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
      if (registry.current) await get().loadCards()
      if (registry.current) await get().loadTemplates()
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
        cards: [],
        selectedCardId: null,
        selectedCard: null,
        studioEditId: null,
      })
      if (sessions[0]) await get().loadSession(sessions[0].id)
      await get().loadCards()
      await get().loadTemplates()
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
        cards: [],
        selectedCardId: null,
        selectedCard: null,
        studioEditId: null,
      })
      if (sessions[0]) await get().loadSession(sessions[0].id)
      await get().loadCards()
      await get().loadTemplates()
    } catch (e) {
      set({ loading: false, error: messageOf(e) })
      throw e
    }
  },

  create: async (input = {}) => {
    const workspace = get().currentWorkspace
    if (!workspace) {
      set({ error: '先打开一个工作区' })
      return
    }
    set({ creating: true, error: null })
    try {
      const session = await createSession(workspace, input)
      set({ creating: false, sessions: [session, ...get().sessions], currentId: session.id, view: 'play' })
      await get().loadSession(session.id)
    } catch (e) {
      set({ creating: false, error: messageOf(e) })
      throw e
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
        status: detail.status,
        sessionLoading: false,
        streamText: '',
      })
    } catch (e) {
      set({ sessionLoading: false, error: messageOf(e) })
    }
  },

  send: async (input, options) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id || get().streaming || !input.trim()) return

    const abort = new AbortController()
    const meta = get().meta
    const current = get().messages
    // 失败时只落了一条大纲、回合号没有前进；找到它，别让两条大纲挤同一个回合号。
    const pending = lastTurnOf(current)
    const staleTurn = pending?.pending && pending.turn === (meta?.turn ?? 0) ? pending.turn : null
    // 失败后最后一条记录是系统错误，往上找才是那条大纲。
    const last = [...current].reverse().find((message) => message.role !== 'system')
    const alreadyShown = options?.retry === true && last?.role === 'director' && last.text === input
    const base =
      staleTurn === null || options?.retry === true
        ? current
        : current.filter((message) => message.role === 'system' || message.turn !== staleTurn)
    set({
      streaming: true,
      streamText: '',
      abort,
      error: null,
      retryInput: null,
      messages: alreadyShown
        ? base
        : [
            ...base,
            { role: 'director', turn: meta?.turn ?? 0, at: new Date().toISOString(), text: input },
          ],
    })

    const apply = (event: TurnEvent) => {
      const state = get()
      switch (event.type) {
        case 'turn_start':
          set({ streamText: '' })
          break
        case 'delta':
          set({ streamText: state.streamText + event.text })
          break
        case 'status_update':
          set({ status: event.status })
          break
        case 'error':
          set({ error: event.message, retryInput: input })
          break
        default:
          break
      }
    }

    try {
      await streamTurn(workspace, id, input, apply, abort.signal, options)
    } catch (e) {
      if (!abort.signal.aborted) set({ error: messageOf(e), retryInput: input })
    } finally {
      set({ streaming: false, abort: null })
      await get().loadSession(id)
      const sessions = get().currentWorkspace ? await listSessions(get().currentWorkspace!) : []
      set({ sessions })
    }
  },

  cancel: () => {
    const id = get().currentId
    get().abort?.abort()
    set({ streaming: false, abort: null, retryInput: null })
    if (!id) return
    // 服务端要等 abort 传过去才落盘中断标记；fetch 断开比它早，所以轮询到看见标记为止。
    let tries = 0
    const tick = async () => {
      tries += 1
      await get().loadSession(id)
      const last = get().messages[get().messages.length - 1]
      const interrupted = last?.role === 'narrative' && last.interrupted === true
      if (!interrupted && tries < 6) {
        setTimeout(() => void tick(), 400)
        return
      }
      const workspace = get().currentWorkspace
      if (workspace) set({ sessions: await listSessions(workspace) })
    }
    setTimeout(() => void tick(), 300)
  },

  /** 模型失败后，用同一句大纲重发（服务端不重复写导演消息）。 */
  retry: async () => {
    const input = get().retryInput
    if (!input) return
    set({ retryInput: null })
    await get().send(input, { retry: true })
  },

  /** 用同一大纲重写最后一回合；旧稿被覆盖。 */
  regenerate: async () => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    const last = lastTurnOf(get().messages)
    if (!workspace || !id || get().streaming || !last) return
    const lastTurn = last.turn
    const abort = new AbortController()
    set({
      streaming: true,
      streamText: '',
      abort,
      error: null,
      retryInput: null,
      // 旧稿马上会被覆盖，先从界面上拿掉，避免和新流重复。
      messages: get().messages.filter((message) => !(message.role === 'narrative' && message.turn === lastTurn)),
    })

    const apply = (event: TurnEvent) => {
      if (event.type === 'turn_start') set({ streamText: '' })
      else if (event.type === 'delta') set({ streamText: get().streamText + event.text })
      else if (event.type === 'status_update') set({ status: event.status })
      else if (event.type === 'error') set({ error: event.message })
    }

    try {
      await regenerateTurn(workspace, id, apply, abort.signal)
    } catch (e) {
      if (!abort.signal.aborted) set({ error: messageOf(e) })
    } finally {
      set({ streaming: false, abort: null })
      await get().loadSession(id)
      const sessions = get().currentWorkspace ? await listSessions(get().currentWorkspace!) : []
      set({ sessions })
    }
  },

  /** 改写某一回合的 AI 回复；已记忆的回合会提示摘要不会跟着改。 */
  editNarrative: async (turn, text) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id) return { memoryStale: false }
    try {
      const result = await editTurnApi(workspace, id, turn, text)
      set({ messages: result.messages, error: null, retryInput: null })
      return { memoryStale: result.memoryStale }
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  /** 删除最后一回合。 */
  deleteLastTurn: async () => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    const last = lastTurnOf(get().messages)
    if (!workspace || !id || get().streaming || !last) return
    try {
      const result = await deleteTurnApi(workspace, id, last.turn)
      set({
        meta: result.meta,
        messages: result.messages,
        status: result.status,
        error: null,
        retryInput: null,
      })
      const sessions = get().currentWorkspace ? await listSessions(get().currentWorkspace!) : []
      set({ sessions })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  dismissError: () => set({ error: null, retryInput: null }),

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

  setPerspective: async (id, perspective) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const meta = await patchSession(workspace, id, { perspective })
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

  setStatusValue: async (cardId, item, value) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id) return
    try {
      const status = await updateStatusValue(workspace, id, { cardId, item, value })
      set({ status, error: null })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  saveStatusTemplate: async (template) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id) return
    try {
      const result = await updateStatusTemplate(workspace, id, template)
      set({
        meta: get().meta?.id === id ? result.session : get().meta,
        status: result.status,
        error: null,
      })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  applyTemplateToRole: async (cardId, templateId) => {
    const workspace = get().currentWorkspace
    const id = get().currentId
    if (!workspace || !id) return
    try {
      const result = await applyStatusTemplate(workspace, id, cardId, templateId)
      set({
        meta: get().meta?.id === id ? result.session : get().meta,
        status: result.status,
        error: null,
      })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  loadTemplates: async () => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    set({ statusTemplatesLoading: true })
    try {
      const templates = await listTemplates(workspace)
      set({ statusTemplates: templates, statusTemplatesLoading: false })
      if (!get().selectedTemplateId && templates[0]) await get().selectTemplate(templates[0].id)
    } catch (e) {
      set({ statusTemplatesLoading: false, error: messageOf(e) })
    }
  },

  selectTemplate: async (id) => {
    const workspace = get().currentWorkspace
    set({ selectedTemplateId: id, selectedTemplate: null, templateLoading: Boolean(id) })
    if (!workspace || !id) return
    try {
      const { template } = await getTemplate(workspace, id)
      set({ selectedTemplate: template, templateLoading: false })
    } catch (e) {
      set({ templateLoading: false, error: messageOf(e) })
    }
  },

  createTemplateDoc: async (draft) => {
    const workspace = get().currentWorkspace
    if (!workspace) throw new Error('先打开一个工作区')
    try {
      const result = await createTemplate(workspace, draft)
      set({
        statusTemplates: result.templates,
        selectedTemplateId: result.id,
        selectedTemplate: result.template,
        error: null,
      })
      return result.id
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  updateTemplateDoc: async (id, draft) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const result = await updateTemplate(workspace, id, draft)
      set({
        statusTemplates: result.templates,
        selectedTemplate: get().selectedTemplateId === id ? result.template : get().selectedTemplate,
        error: null,
      })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  deleteTemplateDoc: async (id) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const templates = await deleteTemplate(workspace, id)
      const next =
        get().selectedTemplateId === id ? (templates[0]?.id ?? null) : get().selectedTemplateId
      set({ statusTemplates: templates, selectedTemplateId: next, selectedTemplate: null, error: null })
      if (next) await get().selectTemplate(next)
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  suggestTemplateItems: async (prompt, cardId) => {
    const workspace = get().currentWorkspace
    if (!workspace) return []
    try {
      const items = await suggestTemplate(workspace, prompt, cardId)
      set({ error: null })
      return items
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
        set({ sessions, currentId: next, meta: null, messages: [], error: null })
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

  setView: (view) => {
    set({ view, error: null })
    if (view === 'characters' && get().cards.length === 0) void get().loadCards()
    if (view === 'status-templates' && get().statusTemplates.length === 0) void get().loadTemplates()
  },

  loadCards: async () => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    set({ cardsLoading: true })
    try {
      const cards = await listCharacters(workspace)
      set({ cards, cardsLoading: false })
      const selected = get().selectedCardId
      if (!selected && cards[0]) await get().selectCard(cards[0].id)
    } catch (e) {
      set({ cardsLoading: false, error: messageOf(e) })
    }
  },

  selectCard: async (id) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    set({ selectedCardId: id, selectedCard: null, cardLoading: Boolean(id) })
    if (!id) return
    try {
      const { card } = await getCharacter(workspace, id)
      set({ selectedCard: card, cardLoading: false })
    } catch (e) {
      set({ cardLoading: false, error: messageOf(e) })
    }
  },

  /** 手工编辑：保存整段 data，后端按原 id 合并（extensions 等额外字段保留）。 */
  editCard: async (id, data) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const result = await updateCharacter(workspace, id, data)
      set({ selectedCardId: result.id, selectedCard: result.card, error: null })
      await get().loadCards()
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  deleteCard: async (id, force = false) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      await deleteCharacter(workspace, id, force)
      const cards = get().cards.filter((card) => card.id !== id)
      set({ cards, error: null })
      if (get().studioEditId === id) set({ studioEditId: null })
      if (get().selectedCardId === id) await get().selectCard(cards[0]?.id ?? null)
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  importCard: async (file) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const result = await importCharacter(workspace, file)
      set({ cards: result.cards, error: null })
      await get().selectCard(result.id)
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  studioSend: async (text) => {
    const workspace = get().currentWorkspace
    const content = text.trim()
    if (!workspace || !content || get().studioStreaming) return

    const abort = new AbortController()
    const history = [...get().studioMessages, { role: 'user' as const, content }]
    set({ studioMessages: history, studioStreaming: true, studioText: '', studioAbort: abort, error: null })

    const picked = get().studioSelection
    const selection: StudioSelection = picked ?? {
      providerId: get().settings?.default.providerId ?? null,
      model: get().settings?.default.model ?? get().meta?.model ?? '',
      reasoningEffort: get().settings?.default.effort ?? null,
    }
    let assistant = ''

    try {
      await streamStudio(
        workspace,
        history,
        { providerId: selection.providerId, model: selection.model, reasoningEffort: selection.reasoningEffort },
        get().studioEditId,
        (event) => {
          if (event.type === 'delta') {
            assistant += event.text
            set({ studioText: assistant })
          } else if (event.type === 'card_saved') {
            void get().loadCards()
            set({ selectedCardId: event.id, selectedCard: event.card })
          } else if (event.type === 'error') {
            set({ error: event.message })
          }
        },
        abort.signal,
      )
    } catch (e) {
      if (!abort.signal.aborted) {
        const message = messageOf(e)
        set({ error: message })
        // 编辑目标已经被删掉：退出编辑态，别让下一条消息一直报 404。
        if (message.includes('card not found')) set({ studioEditId: null })
      }
    } finally {
      const finalText = get().studioText
      set({
        studioStreaming: false,
        studioAbort: null,
        studioText: '',
        studioMessages: finalText
          ? [...get().studioMessages, { role: 'assistant', content: finalText }]
          : get().studioMessages,
      })
      await get().loadCards()
    }
  },

  studioCancel: () => {
    get().studioAbort?.abort()
    set({ studioStreaming: false, studioAbort: null })
  },

  studioReset: () => set({ studioMessages: [], studioText: '', error: null }),

  /** 进入编辑态：清掉上一轮对话，接下来每条消息都会带上这张卡的 id。 */
  studioStartEdit: (id) => set({ studioEditId: id, studioMessages: [], studioText: '', error: null }),

  studioStopEdit: () => set({ studioEditId: null }),

  setStudioSelection: (selection) => set({ studioSelection: selection }),

  settings: null,

  loadSettings: async () => {
    try {
      const settings = await getSettings()
      set({
        settings,
        studioSelection: get().studioSelection ?? {
          providerId: settings.default.providerId,
          model: settings.default.model,
          reasoningEffort: settings.default.effort,
        },
      })
    } catch (e) {
      set({ error: messageOf(e) })
    }
  },

  saveSettings: async (input) => {
    try {
      set({ settings: await putSettings(input), error: null })
    } catch (e) {
      set({ error: messageOf(e) })
      throw e
    }
  },

  setSelection: async (id, selection) => {
    const workspace = get().currentWorkspace
    if (!workspace) return
    try {
      const meta = await patchSession(workspace, id, {
        model: selection.model,
        providerId: selection.providerId,
        reasoningEffort: selection.reasoningEffort,
      })
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
}))
