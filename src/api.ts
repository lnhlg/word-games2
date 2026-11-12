export interface SessionMeta {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
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
