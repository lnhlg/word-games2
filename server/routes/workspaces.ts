import { Hono } from 'hono'
import { pickFolder } from '../lib/folder-picker'
import { loadRegistry, openWorkspace, removeWorkspace } from '../lib/workspace-store'

const app = new Hono()

app.get('/', (c) => c.json(loadRegistry()))

/** 弹系统文件夹选择框，选中后直接打开为工作区。 */
app.post('/pick', async (c) => {
  try {
    const picked = await pickFolder()
    if (!picked) return c.json({ cancelled: true })
    const workspace = openWorkspace(picked)
    return c.json({ workspace, ...loadRegistry() })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

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
