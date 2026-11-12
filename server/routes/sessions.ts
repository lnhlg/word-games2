import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  createSession,
  deleteTurnFiles,
  editNarrativeFile,
  exportMarkdown,
  listSessions,
  patchMeta,
  readMessages,
  readMeta,
  readSession,
  removeSession,
  sessionDir,
  withoutNarrative,
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
  const result = readSession(workspace, c.req.param('id'))
  if (!result) return c.json({ error: 'session not found' }, 404)
  return c.json(result)
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

app.get('/:id/export', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const session = readSession(workspace, c.req.param('id'))
  if (!session) return c.json({ error: 'session not found' }, 404)
  const markdown = exportMarkdown(session.meta, session.messages)
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
  const memories = readMemories(dir)
  const messages = readMessages(dir)
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

/** 删除最后一回合（导演大纲 + 情节），回合号回退一格。 */
app.delete('/:id/turns/:turn', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  const turn = Number(c.req.param('turn'))
  if (!Number.isInteger(turn) || turn < 0) return c.json({ error: 'invalid turn' }, 400)

  const meta = readMeta(dir)
  const lastTurn = meta.turn - 1
  if (lastTurn < 0) return c.json({ error: '还没有可以删除的回合' }, 400)
  if (turn !== lastTurn) return c.json({ error: '只能删除最后一个回合' }, 400)
  if (!deleteTurnFiles(dir, turn)) return c.json({ error: 'turn not found' }, 404)

  const nextMeta: SessionMeta = { ...meta, turn: lastTurn, updatedAt: new Date().toISOString() }
  writeMeta(dir, nextMeta)
  return c.json({ meta: nextMeta, messages: readMessages(dir) })
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
  const turn = meta.turn - 1
  if (turn < 0) return c.json({ error: '还没有可以重新生成的回合' }, 400)

  const messages = readMessages(dir)
  const director = messages.find((message) => message.role === 'director' && message.turn === turn)
  if (!director) return c.json({ error: '找不到这一回合的大纲，无法重新生成' }, 404)

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

  // 先清掉旧稿再重写；失败时只留下大纲，可再重写或删除。
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
