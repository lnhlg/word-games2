export interface SessionMeta {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

export async function listSessions(): Promise<SessionMeta[]> {
  const { sessions } = await request<{ sessions: SessionMeta[] }>('/api/sessions')
  return sessions
}

export async function createSession(): Promise<SessionMeta> {
  const { session } = await request<{ session: SessionMeta }>('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  return session
}
