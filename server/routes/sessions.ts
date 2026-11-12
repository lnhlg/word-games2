import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { createSession, listSessions, readSession } from '../lib/session-fs'

const app = new Hono()

/** 会话都挂在某个工作区（磁盘目录）下，用 ?workspace= 指过去。 */
function workspaceOf(c: Context): string | null {
  const raw = c.req.query('workspace')
  if (!raw) return null
  const resolved = path.resolve(raw)
  return existsSync(resolved) ? resolved : null
}

app.get('/', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  return c.json({ sessions: listSessions(workspace) })
})

app.post('/', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  return c.json({ session: createSession(workspace) }, 201)
})

app.get('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const result = readSession(workspace, c.req.param('id'))
  if (!result) return c.json({ error: 'session not found' }, 404)
  return c.json(result)
})

export default app
