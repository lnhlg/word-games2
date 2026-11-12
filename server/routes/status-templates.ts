import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { readCard } from '../lib/card-store'
import { suggestStatusItems } from '../lib/options'
import { defaultSelection, resolveSelection } from '../lib/providers'
import {
  TemplateExistsError,
  createTemplate,
  deleteTemplate,
  listTemplates,
  readTemplate,
  updateTemplate,
} from '../lib/status-templates'

const app = new Hono()

/** 模板库挂在某个工作区（磁盘目录）下，用 ?workspace= 指过去。 */
function workspaceOf(c: Context): string | null {
  const raw = c.req.query('workspace')
  if (!raw) return null
  const resolved = path.resolve(raw)
  return existsSync(resolved) ? resolved : null
}

app.get('/', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  return c.json({ templates: listTemplates(workspace) })
})

app.get('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')
  const template = readTemplate(workspace, id)
  if (!template) return c.json({ error: 'template not found' }, 404)
  return c.json({ id, template })
})

app.post('/', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  let body: { template?: unknown; overwrite?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (body.template === undefined) return c.json({ error: 'template required' }, 400)

  try {
    const { id, template } = createTemplate(workspace, body.template, body.overwrite === true)
    return c.json({ id, template, templates: listTemplates(workspace) }, 201)
  } catch (error) {
    if (error instanceof TemplateExistsError) {
      return c.json({ error: error.message, exists: error.id }, 409)
    }
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

/** 按原 id 更新；id 与文件名不变（改名只改 `name`）。 */
app.patch('/:id', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')

  let body: { template?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  try {
    const saved = updateTemplate(workspace, id, body.template ?? {})
    if (!saved) return c.json({ error: 'template not found' }, 404)
    return c.json({ id: saved.id, template: saved.template, templates: listTemplates(workspace) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

app.delete('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  if (!deleteTemplate(workspace, c.req.param('id'))) {
    return c.json({ error: 'template not found' }, 404)
  }
  return c.json({ ok: true, templates: listTemplates(workspace) })
})

/** 让 AI 生成一组状态项：可以挂一张角色卡当上下文，也可以不挂（通用模板）。 */
app.post('/suggest', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  let body: { prompt?: unknown; cardId?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return c.json({ error: 'prompt required' }, 400)

  const cardId = typeof body.cardId === 'string' && body.cardId.trim() ? body.cardId.trim() : null
  const card = cardId ? readCard(workspace, cardId) : null

  let selection: ReturnType<typeof resolveSelection>
  try {
    const fallback = defaultSelection()
    selection = resolveSelection({
      model: fallback.model,
      providerId: fallback.providerId ?? undefined,
      reasoningEffort: fallback.effort,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }

  const items = await suggestStatusItems({
    prompt,
    name: card?.data.name,
    description: card?.data.description,
    personality: card?.data.personality,
    model: selection.model,
    baseUrl: selection.provider?.baseUrl,
    apiKey: selection.provider?.apiKey,
  })
  return c.json({ items })
})

export default app
