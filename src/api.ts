import type { GameState, MessageRecord, TurnEvent } from './types'

export interface SessionMeta {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
}

export interface SessionDetail {
  meta: SessionMeta
  messages: MessageRecord[]
  state: GameState
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

export async function createSession(workspace: string): Promise<SessionMeta> {
  const { session } = await request<{ session: SessionMeta }>(
    `/api/sessions?workspace=${encodeURIComponent(workspace)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
  return session
}

export async function getSession(workspace: string, id: string): Promise<SessionDetail> {
  return request<SessionDetail>(
    `/api/sessions/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`,
  )
}

/** 提交一次玩家输入，按 SSE 事件回调；signal 中断时 fetch 被 abort。 */
export async function streamTurn(
  workspace: string,
  id: string,
  input: string,
  onEvent: (event: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/turns?workspace=${encodeURIComponent(workspace)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
    signal,
  })

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
          onEvent(JSON.parse(line.slice(5).trim()) as TurnEvent)
        } catch {
          // 忽略坏帧
        }
      }
      index = buffer.indexOf('\n\n')
    }
  }
}
