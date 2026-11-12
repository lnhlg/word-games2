import type { CardSummary, CharacterCard, MessageRecord, StudioEvent, StudioMessage, TurnEvent } from './types'

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export const REASONING_PARAMS = ['reasoning_effort', 'thinking_level'] as const
export type ReasoningParam = (typeof REASONING_PARAMS)[number]

/** 各参数支持的档位；thinking_level（Gemini）不接受 max。 */
export function effortsForParam(param: ReasoningParam): Effort[] {
  return param === 'thinking_level' ? ['low', 'medium', 'high'] : ['low', 'high', 'max']
}

export interface ModelEntry {
  name: string
  efforts: Effort[]
  defaultEffort?: Effort
  reasoningParam?: ReasoningParam
}

export interface PublicProvider {
  id: string
  name: string
  baseUrl: string
  hasKey: boolean
  models: ModelEntry[]
}

export interface Selection {
  providerId: string | null
  model: string
  effort: Effort | null
}

export interface SessionMeta {
  id: string
  title: string
  model: string
  providerId?: string
  reasoningEffort?: Effort | null
  perspective?: string
  cast?: string[]
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
}

export interface SessionDetail {
  meta: SessionMeta
  messages: MessageRecord[]
}

export interface Workspace {
  path: string
  name: string
  lastOpenedAt: string
}

export interface WorkspaceRegistry {
  workspaces: Workspace[]
  current: string | null
}

export type PickResult = (WorkspaceRegistry & { workspace: Workspace }) | { cancelled: true }

export interface SessionCreateInput {
  title?: string
  cast?: string[]
  perspective?: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

export async function getWorkspaces(): Promise<WorkspaceRegistry> {
  return request<WorkspaceRegistry>('/api/workspaces')
}

/** 让后端弹系统文件夹选择框；用户取消时返回 { cancelled: true }。 */
export async function pickWorkspace(): Promise<PickResult> {
  return request<PickResult>('/api/workspaces/pick', { method: 'POST' })
}

export async function openWorkspace(path: string): Promise<WorkspaceRegistry & { workspace: Workspace }> {
  return request<WorkspaceRegistry & { workspace: Workspace }>('/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function listSessions(workspace: string): Promise<SessionMeta[]> {
  const { sessions } = await request<{ sessions: SessionMeta[] }>(
    `/api/sessions?workspace=${encodeURIComponent(workspace)}`,
  )
  return sessions
}

export async function createSession(workspace: string, input: SessionCreateInput = {}): Promise<SessionMeta> {
  const { session } = await request<{ session: SessionMeta }>(
    `/api/sessions?workspace=${encodeURIComponent(workspace)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return session
}

export async function getSession(workspace: string, id: string): Promise<SessionDetail> {
  return request<SessionDetail>(
    `/api/sessions/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`,
  )
}

export async function patchSession(
  workspace: string,
  id: string,
  patch: {
    title?: string
    status?: SessionMeta['status']
    model?: string
    providerId?: string | null
    reasoningEffort?: Effort | null
    perspective?: string
  },
): Promise<SessionMeta> {
  const { session } = await request<{ session: SessionMeta }>(
    `/api/sessions/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  return session
}

export async function deleteSession(workspace: string, id: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/sessions/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`,
    { method: 'DELETE' },
  )
}

export async function exportSession(workspace: string, id: string): Promise<string> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/export?workspace=${encodeURIComponent(workspace)}`,
  )
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  return res.text()
}

/** 读出 SSE 流里的 data 帧，逐条回调。 */
async function readSse<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const line = block.split('\n').find((l) => l.startsWith('data:'))
      if (line) {
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as T)
        } catch {
          // 忽略坏帧
        }
      }
      index = buffer.indexOf('\n\n')
    }
  }
}

/** 提交一条导演大纲，按 SSE 事件回调；signal 中断时 fetch 被 abort。 */
export async function streamTurn(
  workspace: string,
  id: string,
  input: string,
  onEvent: (event: TurnEvent) => void,
  signal: AbortSignal,
  options?: { retry?: boolean },
): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/turns?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, retry: options?.retry === true }),
    signal,
  })
  await readSse(res, onEvent)
}

/** 用同一大纲重写最后一回合；旧稿由服务端覆盖。 */
export async function regenerateTurn(
  workspace: string,
  id: string,
  onEvent: (event: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(id)}/turns/regenerate?workspace=${encodeURIComponent(workspace)}`,
    { method: 'POST', signal },
  )
  await readSse(res, onEvent)
}

/** 改写某一回合的情节原文。 */
export async function editTurn(
  workspace: string,
  id: string,
  turn: number,
  text: string,
): Promise<{ memoryStale: boolean; messages: MessageRecord[] }> {
  return request<{ ok: boolean; memoryStale: boolean; messages: MessageRecord[] }>(
    `/api/sessions/${encodeURIComponent(id)}/turns/${turn}?workspace=${encodeURIComponent(workspace)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    },
  )
}

/** 删除最后一回合。 */
export async function deleteTurn(
  workspace: string,
  id: string,
  turn: number,
): Promise<{ meta: SessionMeta; messages: MessageRecord[] }> {
  return request<{ meta: SessionMeta; messages: MessageRecord[] }>(
    `/api/sessions/${encodeURIComponent(id)}/turns/${turn}?workspace=${encodeURIComponent(workspace)}`,
    { method: 'DELETE' },
  )
}

// —— 角色卡库 ——

export async function listCharacters(workspace: string): Promise<CardSummary[]> {
  const { cards } = await request<{ cards: CardSummary[] }>(
    `/api/characters?workspace=${encodeURIComponent(workspace)}`,
  )
  return cards
}

export async function getCharacter(workspace: string, id: string): Promise<{ id: string; card: CharacterCard }> {
  return request<{ id: string; card: CharacterCard }>(
    `/api/characters/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`,
  )
}

export async function saveCharacter(
  workspace: string,
  card: unknown,
  overwrite = false,
): Promise<{ id: string; card: CharacterCard }> {
  return request<{ id: string; card: CharacterCard }>(
    `/api/characters?workspace=${encodeURIComponent(workspace)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card, overwrite }),
    },
  )
}

export async function importCharacter(
  workspace: string,
  file: File,
): Promise<{ id: string; card: CharacterCard; cards: CardSummary[] }> {
  const form = new FormData()
  form.append('file', file)
  return request<{ id: string; card: CharacterCard; cards: CardSummary[] }>(
    `/api/characters/import?workspace=${encodeURIComponent(workspace)}`,
    { method: 'POST', body: form },
  )
}

export async function deleteCharacter(workspace: string, id: string, force = false): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/characters/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}${force ? '&force=1' : ''}`,
    { method: 'DELETE' },
  )
}

/** 工坊对话：模型可随时落卡，card_saved 事件带回整张卡。 */
export async function streamStudio(
  workspace: string,
  messages: StudioMessage[],
  selection: { providerId: string | null; model: string; reasoningEffort: Effort | null },
  onEvent: (event: StudioEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/characters/studio?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, ...selection }),
    signal,
  })
  await readSse(res, onEvent)
}

// —— 设置与供应商 ——

export interface SettingsView {
  providers: PublicProvider[]
  default: Selection
}

export interface ModelInput {
  name: string
  efforts: Effort[]
  defaultEffort?: Effort
  reasoningParam?: ReasoningParam
}

export interface ProviderInput {
  id?: string
  name: string
  baseUrl: string
  apiKey?: string
  models: ModelInput[]
}

export interface SettingsInput {
  providers: ProviderInput[]
  default: Selection
}

export async function getSettings(): Promise<SettingsView> {
  return request<SettingsView>('/api/settings')
}

export async function putSettings(input: SettingsInput): Promise<SettingsView> {
  return request<SettingsView>('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export interface ModelFetchCredentials {
  baseUrl?: string
  apiKey?: string
}

/** 由后端代理拉取供应商的模型清单，前端不接触 API key；未保存的供应商可临时传凭据。 */
export async function fetchProviderModels(
  id: string,
  credentials: ModelFetchCredentials = {},
): Promise<string[]> {
  const { models } = await request<{ models: string[] }>(
    `/api/providers/${encodeURIComponent(id)}/models`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    },
  )
  return models
}
