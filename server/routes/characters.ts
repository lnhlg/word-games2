import { existsSync } from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  CardExistsError,
  deleteCard,
  listCards,
  readCard,
  referencedBy,
  saveCard,
} from '../lib/card-store'
import { parseCardBuffer } from '../lib/character-card'
import { getLlmRunner } from '../lib/llm'
import { defaultModel } from '../lib/session-fs'
import { isEffort, resolveSelection } from '../lib/providers'
import type { ChatMessage } from '../lib/prompt'

const app = new Hono()

/** 卡库挂在某个工作区（磁盘目录）下，用 ?workspace= 指过去。 */
function workspaceOf(c: Context): string | null {
  const raw = c.req.query('workspace')
  if (!raw) return null
  const resolved = path.resolve(raw)
  return existsSync(resolved) ? resolved : null
}

/** 工坊工具：模型把整张卡的 data 段塞进来，后端归一化后落盘。 */
export const SAVE_CARD_TOOL = {
  type: 'function',
  function: {
    name: 'save_character_card',
    description: '把一张完整的角色卡保存到当前工作区的角色卡库。同名卡会被覆盖。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '角色名，必填' },
        description: { type: 'string', description: '人物设定：外貌、身份、经历、当前处境' },
        personality: { type: 'string', description: '性格、说话方式、习惯' },
        scenario: { type: 'string', description: '这个角色通常处在什么情境里' },
        first_mes: { type: 'string', description: '首次登场时的一句话，作为语气参考' },
        mes_example: { type: 'string', description: '一两组对话样例，展示说话风格' },
        system_prompt: { type: 'string', description: '写这个角色时最要紧的额外约束' },
        post_history_instructions: { type: 'string', description: '每次落笔前提醒模型注意的事' },
        alternate_greetings: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        creator_notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
} as const

const STUDIO_SYSTEM = `你是角色卡工坊的合写助手。用户会和你讨论一个角色，你负责把它写成一张可用的角色卡。

规则：
- 交谈保持简短，不要写小说正文，不要替用户决定角色的大方向；有歧义时先问一句。
- 当设定已经足够开演（至少 name 有，description 与 personality 有实质内容）时，调用 save_character_card 保存整张卡。
- 每次修改设定后都要重新调用一次 save_character_card，让卡库与讨论同步。
- 卡里的字段会原样进入写小说的提示词，所以要写具体、可执行，避免空话。`

app.get('/', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  return c.json({ cards: listCards(workspace) })
})

app.get('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')
  const card = readCard(workspace, id)
  if (!card) return c.json({ error: 'card not found' }, 404)
  return c.json({ id, card })
})

app.post('/', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  let body: { card?: unknown; overwrite?: unknown } = {}
  try {
    body = (await c.req.json()) as { card?: unknown; overwrite?: unknown }
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (body.card === undefined) return c.json({ error: 'card required' }, 400)

  try {
    const { id, card } = saveCard(workspace, body.card, body.overwrite === true ? 'overwrite' : 'create')
    return c.json({ id, card }, 201)
  } catch (error) {
    if (error instanceof CardExistsError) {
      return c.json({ error: error.message, exists: error.id }, 409)
    }
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

/** 导入：JSON 或带 `chara` chunk 的 PNG；重名自动加后缀，不覆盖。 */
app.post('/import', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  let body: Record<string, unknown>
  try {
    body = (await c.req.parseBody()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'multipart body required' }, 400)
  }
  const file = body.file
  if (!(file instanceof File)) return c.json({ error: 'file required' }, 400)

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const raw = parseCardBuffer(buffer, file.name || 'card.json')
    const { id, card } = saveCard(workspace, raw, 'auto')
    return c.json({ id, card, cards: listCards(workspace) }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

app.delete('/:id', (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)
  const id = c.req.param('id')
  const refs = referencedBy(workspace, id)
  const force = c.req.query('force') === '1'
  if (refs.length > 0 && !force) {
    return c.json({ error: 'card in use', referencedBy: refs }, 409)
  }
  if (!deleteCard(workspace, id)) return c.json({ error: 'card not found' }, 404)
  return c.json({ ok: true })
})

/** 工坊：一段对话，模型可随时调用 save_character_card 落卡。 */
app.post('/studio', async (c) => {
  const workspace = workspaceOf(c)
  if (!workspace) return c.json({ error: 'workspace required' }, 400)

  let body: {
    messages?: unknown
    model?: unknown
    providerId?: unknown
    reasoningEffort?: unknown
  } = {}
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    body = {}
  }

  const history: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m): m is { role: string; content: unknown } => typeof m === 'object' && m !== null)
        .map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: typeof m.content === 'string' ? m.content : '',
        }))
        .filter((m) => m.content.trim())
    : []
  if (history.length === 0) return c.json({ error: 'messages required' }, 400)

  const selection = resolveSelection({
    providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel(),
    reasoningEffort: isEffort(body.reasoningEffort) ? body.reasoningEffort : null,
  })

  return streamSSE(c, async (stream) => {
    const abort = new AbortController()
    stream.onAbort(() => abort.abort())
    const emit = (event: unknown) => stream.writeSSE({ data: JSON.stringify(event) })

    const messages: ChatMessage[] = [{ role: 'system', content: STUDIO_SYSTEM }, ...history]

    try {
      for (let step = 0; step < 4; step++) {
        if (abort.signal.aborted) return
        let text = ''
        const calls: { id: string; name: string; args: string }[] = []

        for await (const chunk of getLlmRunner()({
          model: selection.model,
          messages,
          baseUrl: selection.provider?.baseUrl,
          apiKey: selection.provider?.apiKey,
          reasoningEffort: selection.effort,
          reasoningParam: selection.reasoningParam,
          supportsReasoning: selection.supportsReasoning,
          tools: [SAVE_CARD_TOOL],
        })) {
          if (abort.signal.aborted) return
          if (chunk.type === 'delta' && chunk.text) {
            text += chunk.text
            await emit({ type: 'delta', text: chunk.text })
          }
          if (chunk.type === 'tool_call' && chunk.toolCall) calls.push(chunk.toolCall)
          if (chunk.type === 'done') break
        }

        if (!calls.length) break

        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.args },
          })),
        })

        for (const call of calls) {
          if (call.name !== 'save_character_card') {
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'unknown tool' }) })
            continue
          }
          try {
            const parsed = call.args ? (JSON.parse(call.args) as unknown) : {}
            const saved = saveCard(workspace, parsed, 'overwrite')
            await emit({ type: 'card_saved', id: saved.id, card: saved.card })
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true, id: saved.id }) })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: message }) })
          }
        }
      }

      await emit({ type: 'done' })
    } catch (error) {
      if (abort.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      console.error('[studio] 工坊失败：', message)
      await emit({ type: 'error', message })
    }
  })
})

export default app
