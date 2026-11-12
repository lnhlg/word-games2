import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  createSession,
  deleteTurnFiles,
  editNarrativeFile,
  exportMarkdown,
  lastTurnOf,
  listSessions,
  patchMeta,
  readMessages,
  readMeta,
  readSession,
  removeSession,
  sessionDir,
  withoutNarrative,
  withoutTurn,
  writeMessages,
  writeMeta,
  type MessageRecord,
  type SessionMeta,
} from '../lib/session-fs'
import { resolveAgentMd } from '../lib/agent-md'
import { readMemories, rememberedUntil } from '../lib/memory'
import { loadCards, readCard } from '../lib/card-store'
import { isEffort, resolveSelection, type Effort } from '../lib/providers'
import { runTurn } from '../lib/turn'
import {
  clearTurnStatus,
  rollbackStatus,
  saveStatusTemplate,
  setStatusValue,
  statusMarkdown,
  statusView,
  type StatusValue,
} from '../lib/status'
import { readTemplate } from '../lib/status-templates'

const app = new Hono()

/** 会话都挂在某个工作区（磁盘目录）下，用 ?workspace= 指过去。 */
function workspaceOf(c: Context): string | null {
  const raw = c.req.query('workspace')
  if (!raw) return null
  const resolved = path.resolve(raw)
  return existsSync(resolved) ? resolved : null
}

/**
 * 一次建好本回合要用的两样东西：
 * 演员表注入用的状态（键是角色名），以及 AI 更新时把名字映射回卡 id 的表。
 */
function castContext(
  workspace: string,
  dir: string,
  meta: SessionMeta,
): { nameToId: Record<string, string>; statusByName: Record<string, StatusValue[]> } {
  const view = statusView(dir, meta)
  const nameToId: Record<string, string> = {}
  const statusByName: Record<string, StatusValue[]> = {}
  for (const id of meta.cast ?? []) {
    const card = readCard(workspace, id)
    if (!card) continue
    if (!(card.data.name in nameToId)) nameToId[card.data.name] = id
    if (view.values[id]) statusByName[card.data.name] = view.values[id]
  }
  return { nameToId, statusByName }
}

app.get('/', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  return c.json({ sessions: listSessions(workspace) })
})

app.post('/', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  let body: { title?: unknown; cast?: unknown; perspective?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }

  const cast = Array.isArray(body.cast)
    ? body.cast.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  for (const id of cast) {
    if (!readCard(workspace, id)) return c.json({ error: `角色卡「${id}」不存在`, id }, 400)
  }

  const session = createSession(workspace, {
    title: typeof body.title === 'string' ? body.title : undefined,
    cast,
    perspective: typeof body.perspective === 'string' ? body.perspective : undefined,
  })
  return c.json({ session }, 201)
})

app.get('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')
  const result = readSession(workspace, id)
  if (!result) return c.json({ error: 'session not found' }, 404)
  return c.json({ ...result, status: statusView(sessionDir(workspace, id), result.meta) })
})

app.patch('/:id', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  let body: {
    title?: unknown
    status?: unknown
    model?: unknown
    providerId?: unknown
    reasoningEffort?: unknown
    perspective?: unknown
  } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }

  const patch: {
    title?: string
    status?: SessionMeta['status']
    model?: string
    providerId?: string | null
    reasoningEffort?: Effort | null
    perspective?: string
  } = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (body.status === 'active' || body.status === 'ended' || body.status === 'archived') {
    patch.status = body.status
  }
  if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim()
  if (typeof body.providerId === 'string') patch.providerId = body.providerId.trim() || null
  else if (body.providerId === null) patch.providerId = null
  else if (body.providerId !== undefined) return c.json({ error: 'invalid providerId' }, 400)
  if (body.reasoningEffort === null) patch.reasoningEffort = null
  else if (isEffort(body.reasoningEffort)) patch.reasoningEffort = body.reasoningEffort
  else if (body.reasoningEffort !== undefined) return c.json({ error: 'invalid reasoningEffort' }, 400)
  if (typeof body.perspective === 'string') patch.perspective = body.perspective

  if (
    patch.title === undefined &&
    patch.status === undefined &&
    patch.model === undefined &&
    patch.providerId === undefined &&
    patch.reasoningEffort === undefined &&
    patch.perspective === undefined
  ) {
    return c.json({ error: 'nothing to patch' }, 400)
  }
  return c.json({ session: patchMeta(dir, patch) })
})

app.delete('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  if (!removeSession(workspace, c.req.param('id'))) {
    return c.json({ error: 'session not found' }, 404)
  }
  return c.json({ ok: true })
})

/** 整份替换状态模板：导演在面板里增删条目后提交；只接受参演角色的键。 */
app.patch('/:id/status/template', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  let body: { template?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }

  const meta = readMeta(dir)
  const cast = new Set(meta.cast ?? [])
  const raw = body.template && typeof body.template === 'object' && !Array.isArray(body.template)
    ? (body.template as Record<string, unknown>)
    : {}
  const template: Record<string, unknown> = {}
  for (const [cardId, items] of Object.entries(raw)) {
    if (cast.has(cardId)) template[cardId] = items
  }

  const next = saveStatusTemplate(dir, meta, template)
  return c.json({ session: next, status: statusView(dir, next) })
})

/** 导演手改一个值；记在最近一回合之后，删那一回合时跟着回滚。 */
app.patch('/:id/status/value', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  let body: { cardId?: unknown; item?: unknown; value?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }
  const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : ''
  const item = typeof body.item === 'string' ? body.item.trim() : ''
  if (!cardId || !item) return c.json({ error: 'cardId 与 item 必填' }, 400)

  const meta = readMeta(dir)
  const view = setStatusValue(dir, meta, {
    cardId,
    item,
    value: typeof body.value === 'string' ? body.value : '',
    turn: meta.turn > 0 ? meta.turn - 1 : null,
  })
  if (!view) return c.json({ error: '没有这个状态项' }, 404)
  return c.json({ status: view })
})

/** 把模板库里的某个模板套到这个角色上（快照复制）；templateId 为空表示清空这个角色的状态项。 */
app.post('/:id/status/apply-template', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  let body: { cardId?: unknown; templateId?: unknown } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }
  const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : ''
  const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : ''
  if (!cardId) return c.json({ error: 'cardId required' }, 400)

  const meta = readMeta(dir)
  if (!(meta.cast ?? []).includes(cardId)) {
    return c.json({ error: '这个角色不在本场演员表里' }, 400)
  }

  const nextTemplate = { ...(meta.statusTemplate ?? {}) }
  const ids = { ...(meta.statusTemplateIds ?? {}) }

  if (templateId) {
    const template = readTemplate(workspace, templateId)
    if (!template) return c.json({ error: 'template not found' }, 404)
    if (template.items.length === 0) return c.json({ error: '这个模板还没有条目' }, 400)
    nextTemplate[cardId] = template.items
    ids[cardId] = templateId
  } else {
    delete nextTemplate[cardId]
    delete ids[cardId]
  }

  const saved = saveStatusTemplate(dir, meta, nextTemplate)
  const next: SessionMeta = { ...saved }
  if (Object.keys(ids).length) next.statusTemplateIds = ids
  else delete next.statusTemplateIds
  writeMeta(dir, next)
  return c.json({ session: next, status: statusView(dir, next) })
})

app.get('/:id/export', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')
  const session = readSession(workspace, id)
  if (!session) return c.json({ error: 'session not found' }, 404)
  const dir = sessionDir(workspace, id)
  const view = statusView(dir, session.meta)
  const names: Record<string, string> = {}
  for (const cardId of session.meta.cast ?? []) {
    const card = readCard(workspace, cardId)
    if (card) names[cardId] = card.data.name
  }
  const markdown = exportMarkdown(session.meta, session.messages, statusMarkdown(view, names))
  c.header('Content-Type', 'text/markdown; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${session.meta.title}.md`)}`)
  return c.body(markdown)
})

/** 最近 8 回合的原始记录，供 prompt 组装用；已记忆的回合不再重复。 */
function extractHistory(
  messages: MessageRecord[],
  fromTurn: number,
): { role: 'director' | 'narrative'; text: string }[] {
  return messages
    .filter(
      (message): message is Exclude<MessageRecord, { role: 'system' }> =>
        message.role !== 'system' && message.turn >= fromTurn,
    )
    .slice(-16)
    .map((message) => ({ role: message.role, text: message.text }))
}

/** 组装 prompt 用的最近情节；排除正在生成/重写的那一回合。 */
function historyBefore(
  messages: MessageRecord[],
  turn: number,
  fromTurn: number,
): { role: 'director' | 'narrative'; text: string }[] {
  return extractHistory(
    messages.filter((message) => message.role === 'system' || message.turn < turn),
    fromTurn,
  )
}

app.post('/:id/turns', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  const id = c.req.param('id')
  const dir = sessionDir(workspace, id)
  if (!existsSync(path.join(dir, 'session.json'))) {
    return c.json({ error: 'session not found' }, 404)
  }

  let body: { input?: string; retry?: boolean } = {}
  try {
    body = (await c.req.json()) as { input?: string; retry?: boolean }
  } catch {
    body = {}
  }
  const outline = (body.input ?? '').trim()
  if (!outline) return c.json({ error: 'input required' }, 400)

  const meta = readMeta(dir)
  // 上一回合生成失败时只留下一条大纲、回合号没有前进：新大纲直接顶替它，
  // 免得两条大纲抢同一个回合号。重试走 reuseOutline，保留原大纲。
  let messages = readMessages(dir)
  if (body.retry !== true) {
    const stale = lastTurnOf(messages)
    if (stale?.pending && stale.turn === meta.turn) {
      writeMessages(dir, withoutTurn(messages, stale.turn))
      messages = readMessages(dir)
    }
  }
  const memories = readMemories(dir)
  // 每次回合现解析一次：切换供应商/模型后下一回合立即生效。
  let selection: ReturnType<typeof resolveSelection>
  try {
    selection = resolveSelection(meta)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
  // 已记忆的回合不再进最近情节（它们已压成摘要）。
  const history = historyBefore(messages, meta.turn, rememberedUntil(memories))
  const cast = loadCards(workspace, meta.cast ?? [])
  const agentMd = resolveAgentMd(dir, selection.model)
  const { nameToId, statusByName } = castContext(workspace, dir, meta)

  return streamSSE(c, async (stream) => {
    const abort = new AbortController()
    stream.onAbort(() => abort.abort())

    const started = Date.now()
    try {
      await runTurn({
        dir,
        meta,
        agentMd,
        cast,
        statusByName,
        nameToId,
        memories,
        history,
        outline,
        reuseOutline: body.retry === true,
        model: selection.model,
        provider: selection.provider
          ? { baseUrl: selection.provider.baseUrl, apiKey: selection.provider.apiKey }
          : null,
        reasoningEffort: selection.effort,
        reasoningParam: selection.reasoningParam,
        supportsReasoning: selection.supportsReasoning,
        signal: abort.signal,
        emit: (event) => stream.writeSSE({ data: JSON.stringify(event) }),
      })
      console.log(`[turn] ${id} 回合 ${meta.turn} 完成，用时 ${Date.now() - started}ms`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[turn] ${id} 回合 ${meta.turn} 失败：${message}`)
      if (!abort.signal.aborted) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', message }) })
      }
    }
  })
})

/** 删除最后一回合（导演大纲 + 情节），回合号回退一格；失败后只剩大纲的那一回合也在这里删。 */
app.delete('/:id/turns/:turn', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  const turn = Number(c.req.param('turn'))
  if (!Number.isInteger(turn) || turn < 0) return c.json({ error: 'invalid turn' }, 400)

  const meta = readMeta(dir)
  const messages = readMessages(dir)
  // 失败的那一回合不占回合号，但它的大纲仍在，同样算最后一回合。
  const last = lastTurnOf(messages)
  if (!last) return c.json({ error: '还没有可以删除的回合' }, 400)
  if (turn !== last.turn) return c.json({ error: '只能删除最后一个回合' }, 400)
  if (!deleteTurnFiles(dir, turn)) return c.json({ error: 'turn not found' }, 404)

  // 这一回合带来的状态变化跟着回滚；导演在这一回合之后的手改也一并丢掉。
  rollbackStatus(dir, turn)

  // 删掉失败后只剩大纲的那一条时回合号本来就没前进；其余删的是最后一回合，回退一格。
  const nextMeta: SessionMeta = {
    ...meta,
    turn: Math.min(meta.turn, last.turn),
    updatedAt: new Date().toISOString(),
  }
  writeMeta(dir, nextMeta)
  return c.json({ meta: nextMeta, messages: readMessages(dir), status: statusView(dir, nextMeta) })
})

/** 改写某一回合的情节原文；已压进摘要的回合会带 memoryStale 提示。 */
app.patch('/:id/turns/:turn', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  const turn = Number(c.req.param('turn'))
  if (!Number.isInteger(turn) || turn < 0) return c.json({ error: 'invalid turn' }, 400)
  const meta = readMeta(dir)
  if (turn >= meta.turn) return c.json({ error: '这一回合还没有落盘' }, 404)

  let body: { text?: unknown } = {}
  try {
    body = (await c.req.json()) as { text?: unknown }
  } catch {
    body = {}
  }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) return c.json({ error: 'text required' }, 400)
  if (!editNarrativeFile(dir, turn, text)) return c.json({ error: '这一回合还没有情节' }, 404)

  return c.json({
    ok: true,
    memoryStale: turn < rememberedUntil(readMemories(dir)),
    messages: readMessages(dir),
  })
})

/** 用同一大纲重写最后一回合；覆盖旧稿，不留版本。 */
app.post('/:id/turns/regenerate', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')
  const dir = sessionDir(workspace, id)
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  const meta = readMeta(dir)
  const messages = readMessages(dir)
  // 失败后只剩大纲的那一回合也能重新生成：它的回合号就是最后一条大纲的回合号。
  const last = lastTurnOf(messages)
  if (!last) return c.json({ error: '还没有可以重新生成的回合' }, 400)
  const turn = last.turn

  const director = [...messages]
    .reverse()
    .find(
      (message): message is Extract<MessageRecord, { role: 'director' }> =>
        message.role === 'director' && message.turn === turn,
    )
  if (!director) {
    return c.json({ error: '找不到这一回合的大纲，无法重新生成' }, 404)
  }

  const memories = readMemories(dir)
  let selection: ReturnType<typeof resolveSelection>
  try {
    selection = resolveSelection(meta)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
  const history = historyBefore(messages, turn, rememberedUntil(memories))
  const cast = loadCards(workspace, meta.cast ?? [])
  const agentMd = resolveAgentMd(dir, selection.model)
  const { nameToId, statusByName } = castContext(workspace, dir, meta)

  // 先清掉旧稿再重写；失败时只留下大纲，可再重写或删除。旧稿带来的状态变化一并作废。
  clearTurnStatus(dir, turn)
  writeMessages(dir, withoutNarrative(messages, turn))

  return streamSSE(c, async (stream) => {
    const abort = new AbortController()
    stream.onAbort(() => abort.abort())

    const started = Date.now()
    try {
      await runTurn({
        dir,
        meta,
        agentMd,
        cast,
        statusByName,
        nameToId,
        memories,
        history,
        outline: director.text,
        turn,
        reuseOutline: true,
        model: selection.model,
        provider: selection.provider
          ? { baseUrl: selection.provider.baseUrl, apiKey: selection.provider.apiKey }
          : null,
        reasoningEffort: selection.effort,
        reasoningParam: selection.reasoningParam,
        supportsReasoning: selection.supportsReasoning,
        signal: abort.signal,
        emit: (event) => stream.writeSSE({ data: JSON.stringify(event) }),
      })
      console.log(`[turn] ${id} 回合 ${turn + 1} 重新生成完成，用时 ${Date.now() - started}ms`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[turn] ${id} 回合 ${turn + 1} 重新生成失败：${message}`)
      if (!abort.signal.aborted) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', message }) })
      }
    }
  })
})

export default app
