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
  summary: string
  history: { role: string; text: string }[]
  playerInput: string
  emit: (event: TurnEvent) => void | Promise<void>
  signal?: AbortSignal
}

const MAX_STEPS = 6

export async function runTurn(args: RunTurnArgs): Promise<void> {
  const { dir, meta, world, state, emit } = args
  const turn = meta.turn

  await emit({ type: 'turn_start', turn })
  appendMessage(dir, { role: 'player', turn, at: new Date().toISOString(), text: args.playerInput })

  const messages = buildMessages({
    agentMd: args.agentMd,
    world,
    state,
    summary: args.summary,
    history: args.history,
    playerInput: args.playerInput,
  })

  const llm = getLlmRunner()
  let narrative = ''
  let ended = false
  let options: string[] | null = null
  let endingNarrative: string | null = null

  for (let step = 0; step < MAX_STEPS; step++) {
    if (args.signal?.aborted) throw new Error('已中断')

    let text = ''
    const calls: { id: string; name: string; args: string }[] = []

    for await (const chunk of llm({ model: meta.model, messages })) {
      if (args.signal?.aborted) throw new Error('已中断')
      if (chunk.type === 'delta' && chunk.text) {
        text += chunk.text
        await emit({ type: 'delta', text: chunk.text })
      }
      if (chunk.type === 'tool_call' && chunk.toolCall) calls.push(chunk.toolCall)
      if (chunk.type === 'done') break
    }

    if (text) {
      narrative += text
      appendMessage(dir, { role: 'engine', turn, at: new Date().toISOString(), kind: 'text', text })
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

      await emit({ type: 'tool_call', id: call.id, name: call.name, args: parsed })
      const outcome = executeTool(call.name, parsed, { world, state })
      await emit({ type: 'tool_result', id: call.id, name: call.name, ok: outcome.ok, result: outcome.result })
      appendMessage(dir, {
        role: 'engine',
        turn,
        at: new Date().toISOString(),
        kind: 'tool_call',
        id: call.id,
        name: call.name,
        args: parsed,
      })
      appendMessage(dir, {
        role: 'tool',
        turn,
        at: new Date().toISOString(),
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

  if (!narrative && endingNarrative) {
    narrative = endingNarrative
    await emit({ type: 'delta', text: endingNarrative })
    appendMessage(dir, { role: 'engine', turn, at: new Date().toISOString(), kind: 'text', text: endingNarrative })
  }

  if (!narrative) {
    narrative = '（引擎没有给出叙事。请重试，或检查模型配置。）'
    await emit({ type: 'delta', text: narrative })
    appendMessage(dir, { role: 'engine', turn, at: new Date().toISOString(), kind: 'text', text: narrative })
  }

  if (options && options.length >= 2) {
    appendMessage(dir, { role: 'engine', turn, at: new Date().toISOString(), kind: 'options', options })
    await emit({ type: 'options', options })
  }

  state.turn = turn + 1
  writeState(dir, state)
  writeSnapshot(dir, turn, state)

  const nextMeta: SessionMeta = {
    ...meta,
    turn: turn + 1,
    updatedAt: new Date().toISOString(),
    status: state.ending ? 'ended' : meta.status,
  }
  writeMeta(dir, nextMeta)

  await emit({ type: 'state', state })
  await emit({ type: 'done', turn: nextMeta.turn })
}
