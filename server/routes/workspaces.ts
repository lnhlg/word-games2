import { Hono } from 'hono'
import { loadRegistry, openWorkspace, removeWorkspace } from '../lib/workspace-store'

const app = new Hono()

app.get('/', (c) => c.json(loadRegistry()))

app.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: unknown }
  const input = typeof body.path === 'string' ? body.path.trim() : ''
  if (!input) return c.json({ error: 'path required' }, 400)

  try {
    const workspace = openWorkspace(input)
    return c.json({ workspace, ...loadRegistry() })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
})

app.delete('/', (c) => {
  const input = c.req.query('path')
  if (!input) return c.json({ error: 'path required' }, 400)
  removeWorkspace(input)
  return c.json(loadRegistry())
})

export default app
