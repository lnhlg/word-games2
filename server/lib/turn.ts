import {
  appendMessage,
  writeMeta,
  writeSnapshot,
  writeState,
  type GameState,
  type SessionMeta,
} from './session-fs'
import { buildMessages } from './prompt'
import { executeTool } from './tools'
import { getLlmRunner } from './llm'
import { memoryBlock, rememberBatch, type MemoryRecord } from './memory'
import type { World } from './world'

export type TurnEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown }
  | { type: 'options'; options: string[] }
  | { type: 'state'; state: GameState }
  | { type: 'done'; turn: number }
  | { type: 'error'; message: string }

export interface RunTurnArgs {
  dir: string
  meta: SessionMeta
  world: World
  state: GameState
  agentMd: string
  memories: MemoryRecord[]
  history: { role: string; text: string }[]
  playerInput: string
  /** 重试时复用 messages.jsonl 里已有的玩家输入，不再追加一条。 */
  reusePlayer?: boolean
  emit: (event: TurnEvent) => void | Promise<void>
  signal?: AbortSignal
}

const MAX_STEPS = 6

function now(): string {
  return new Date().toISOString()
}

/** 连接可能被中断/关闭，落盘优先，emit 失败不抛。 */
async function safeEmit(args: RunTurnArgs, event: TurnEvent): Promise<void> {
  try {
    await args.emit(event)
  } catch {
    // 客户端已断开（中断或关页），忽略。
  }
}

function isAborted(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

export async function runTurn(args: RunTurnArgs): Promise<void> {
  const { dir, meta, world, state } = args
  const turn = meta.turn

  await args.emit({ type: 'turn_start', turn })
  if (!args.reusePlayer) {
    appendMessage(dir, { role: 'player', turn, at: now(), text: args.playerInput })
  }

  const messages = buildMessages({
    agentMd: args.agentMd,
    world,
    state,
    memory: memoryBlock(args.memories),
    history: args.history,
    playerInput: args.playerInput,
  })

  const llm = getLlmRunner()
  let narrative = ''
  let ended = false
  let options: string[] | null = null
  let endingNarrative: string | null = null
  // 当前步骤里已收到、但还没落盘的文本；中断或失败时把它保住。
  let tail = ''

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (args.signal?.aborted) throw new Error('aborted')

      let text = ''
      const calls: { id: string; name: string; args: string }[] = []
      tail = ''

      for await (const chunk of llm({ model: meta.model, messages })) {
        if (args.signal?.aborted) throw new Error('aborted')
        if (chunk.type === 'delta' && chunk.text) {
          text += chunk.text
          tail = text
          await args.emit({ type: 'delta', text: chunk.text })
        }
        if (chunk.type === 'tool_call' && chunk.toolCall) calls.push(chunk.toolCall)
        if (chunk.type === 'done') break
      }

      tail = ''
      if (text) {
        narrative += text
        appendMessage(dir, { role: 'engine', turn, at: now(), kind: 'text', text })
      }

      if (!calls.length) break

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.args },
        })),
      })

      for (const call of calls) {
        let parsed: unknown = {}
        try {
          parsed = call.args ? JSON.parse(call.args) : {}
        } catch {
          parsed = {}
        }

        await args.emit({ type: 'tool_call', id: call.id, name: call.name, args: parsed })
        const outcome = executeTool(call.name, parsed, { world, state, dir, memories: args.memories })
        await args.emit({ type: 'tool_result', id: call.id, name: call.name, ok: outcome.ok, result: outcome.result })
        appendMessage(dir, {
          role: 'engine',
          turn,
          at: now(),
          kind: 'tool_call',
          id: call.id,
          name: call.name,
          args: parsed,
        })
        appendMessage(dir, {
          role: 'tool',
          turn,
          at: now(),
          callId: call.id,
          name: call.name,
          ok: outcome.ok,
          result: outcome.result,
        })

        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result) })

        if (call.name === 'end_turn' || outcome.ended) {
          ended = true
          options = outcome.options ?? []
          endingNarrative = outcome.narrative ?? ''
        }
      }

      if (ended) break
    }
  } catch (error) {
    // 已收到的半截叙事先落盘。
    if (tail) {
      appendMessage(dir, { role: 'engine', turn, at: now(), kind: 'text', text: tail })
    }

    if (isAborted(error, args.signal)) {
      appendMessage(dir, {
        role: 'system',
        at: now(),
        kind: 'error',
        text: `回合 ${turn + 1} 已中断，已生成的内容保留。`,
      })
      writeMeta(dir, { ...meta, updatedAt: now() })
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[turn] 回合 ${turn + 1} 失败：${message}`)
    appendMessage(dir, { role: 'system', at: now(), kind: 'error', text: message })
    writeMeta(dir, { ...meta, updatedAt: now() })
    await safeEmit(args, { type: 'error', message })
    return
  }

  if (!narrative && endingNarrative) {
    narrative = endingNarrative
    await args.emit({ type: 'delta', text: endingNarrative })
    appendMessage(dir, { role: 'engine', turn, at: now(), kind: 'text', text: endingNarrative })
  }

  if (!narrative) {
    narrative = '（引擎没有给出叙事。请重试，或检查模型配置。）'
    await args.emit({ type: 'delta', text: narrative })
    appendMessage(dir, { role: 'engine', turn, at: now(), kind: 'text', text: narrative })
  }

  if (options && options.length >= 2) {
    appendMessage(dir, { role: 'engine', turn, at: now(), kind: 'options', options })
    await args.emit({ type: 'options', options })
  }

  state.turn = turn + 1
  writeState(dir, state)
  writeSnapshot(dir, turn, state)

  const nextMeta: SessionMeta = {
    ...meta,
    turn: turn + 1,
    updatedAt: now(),
    status: state.ending ? 'ended' : meta.status,
  }
  writeMeta(dir, nextMeta)

  await args.emit({ type: 'state', state })
  await args.emit({ type: 'done', turn: nextMeta.turn })

  // 超过最近 8 回合后，把最早的一批压成「摘要 + 索引」；失败不影响本回合。
  try {
    await rememberBatch(dir, args.memories, nextMeta.turn, meta.model)
  } catch (error) {
    console.error(`[memory] 回合 ${nextMeta.turn} 记忆失败：`, error)
  }
}
