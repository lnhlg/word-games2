import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  createSession,
  exportMarkdown,
  listSessions,
  patchMeta,
  readMessages,
  readMeta,
  readSession,
  readState,
  removeSession,
  rollbackSession,
  sessionDir,
  visibleMessages,
  type MessageRecord,
  type SessionMeta,
} from '../lib/session-fs'
import { runTurn } from '../lib/turn'
import { loadWorld } from '../lib/world'

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

app.patch('/:id', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  let body: { title?: unknown; status?: unknown } = {}
  try {
    body = (await c.req.json()) as { title?: unknown; status?: unknown }
  } catch {
    body = {}
  }

  const patch: { title?: string; status?: SessionMeta['status'] } = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (body.status === 'active' || body.status === 'ended' || body.status === 'archived') {
    patch.status = body.status
  }
  if (patch.title === undefined && patch.status === undefined) {
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
  const id = c.req.param('id')
  const session = readSession(workspace, id)
  if (!session) return c.json({ error: 'session not found' }, 404)
  const markdown = exportMarkdown(sessionDir(workspace, id), session.meta, session.messages, session.state)
  c.header('Content-Type', 'text/markdown; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${session.meta.title}.md`)}`)
  return c.body(markdown)
})

app.post('/:id/rollback', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const dir = sessionDir(workspace, c.req.param('id'))
  if (!existsSync(path.join(dir, 'session.json'))) return c.json({ error: 'session not found' }, 404)

  let body: { turn?: unknown } = {}
  try {
    body = (await c.req.json()) as { turn?: unknown }
  } catch {
    body = {}
  }
  const turn = typeof body.turn === 'number' ? body.turn : Number.NaN
  if (!Number.isInteger(turn) || turn < 0) return c.json({ error: 'turn required' }, 400)

  const result = rollbackSession(dir, turn)
  if (!result) return c.json({ error: 'snapshot not found' }, 404)
  return c.json(result)
})

/** 最近 8 回合的原始对白，供 prompt 组装用。 */function extractHistory(messages: MessageRecord[]): { role: string; text: string }[] {
  const out: { role: string; text: string }[] = []
  for (const m of messages) {
    if (m.role === 'player') out.push({ role: 'player', text: m.text })
    else if (m.role === 'engine' && m.kind === 'text') out.push({ role: 'engine', text: m.text })
  }
  return out.slice(-16)
}

app.post('/:id/turns', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  const id = c.req.param('id')
  const dir = sessionDir(workspace, id)
  if (!existsSync(path.join(dir, 'session.json'))) {
    return c.json({ error: 'session not found' }, 404)
  }

  let body: { input?: string } = {}
  try {
    body = (await c.req.json()) as { input?: string }
  } catch {
    body = {}
  }
  const input = (body.input ?? '').trim()
  if (!input) return c.json({ error: 'input required' }, 400)

  const meta = readMeta(dir)
  const state = readState(dir)
  const world = loadWorld(dir)
  const history = extractHistory(visibleMessages(readMessages(dir), meta))

  const modelFile = path.join(dir, `${meta.model}.md`)
  const agentFile = path.join(dir, 'AGENT.md')
  const agentMd = existsSync(modelFile)
    ? readFileSync(modelFile, 'utf8')
    : existsSync(agentFile)
      ? readFileSync(agentFile, 'utf8')
      : ''

  return streamSSE(c, async (stream) => {
    const abort = new AbortController()
    stream.onAbort(() => abort.abort())

    const started = Date.now()
    try {
      await runTurn({
        dir,
        meta,
        world,
        state,
        agentMd,
        summary: '',
        history,
        playerInput: input,
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

export default app
