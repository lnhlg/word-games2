import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  createSession,
  listSessions,
  readMessages,
  readMeta,
  readSession,
  readState,
  sessionDir,
  type MessageRecord,
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

/** 最近 8 回合的原始对白，供 prompt 组装用。 */
function extractHistory(messages: MessageRecord[]): { role: string; text: string }[] {
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
  const history = extractHistory(readMessages(dir))

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
