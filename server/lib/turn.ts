import { appendMessage, readMeta, saveNextOptions, writeMeta, type SessionMeta } from './session-fs'
import { buildMessages } from './prompt'
import type { CharacterCard } from './character-card'
import { getLlmRunner } from './llm'
import { memoryBlock, rememberBatch, type MemoryRecord } from './memory'
import { generateTurnExtras } from './options'
import { applyAiStatus, type StatusValue, type StatusView } from './status'
import type { Effort, ReasoningParam } from './providers'

export type TurnEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; turn: number }
  | { type: 'next_options'; turn: number; options: string[] }
  | { type: 'status_update'; turn: number; status: StatusView }
  | { type: 'error'; message: string }

export interface RunTurnArgs {
  dir: string
  meta: SessionMeta
  agentMd: string
  /** 参演角色的卡；缺卡的 id 已在调用方跳过。 */
  cast: CharacterCard[]
  /** 每个角色此刻的状态，键是角色名；接在该角色段的末尾。 */
  statusByName?: Record<string, StatusValue[]>
  /** 角色名 → 角色卡 id；AI 更新状态时用它落回正确的角色。 */
  nameToId?: Record<string, string>
  memories: MemoryRecord[]
  history: { role: 'director' | 'narrative'; text: string }[]
  outline: string
  /**
   * 覆盖回合号：重新生成时传最后一条大纲的回合号（正常情况是 meta.turn - 1，
   * 失败后只剩大纲的那一回合则是 meta.turn）。
   */
  turn?: number
  /** 失败重试时复用已落盘的导演消息，不再追加一条。 */
  reuseOutline?: boolean
  /** 本回合实际使用的模型与供应商凭据；缺省用 meta.model 与 .env。 */
  model?: string
  provider?: { baseUrl: string; apiKey: string } | null
  reasoningEffort?: Effort | null
  /** 上游思考强度参数名；Gemini 系列为 thinking_level。 */
  reasoningParam?: ReasoningParam
  /** 该模型是否支持思考强度；true 时关闭强度会显式发送 thinking: disabled。 */
  supportsReasoning?: boolean
  emit: (event: TurnEvent) => void | Promise<void>
  signal?: AbortSignal
}

function now(): string {
  return new Date().toISOString()
}

/** 状态行给选项/状态那次调用看：`沈砚：好感度（35）、被怀疑（是）`。 */
function statusLinesOf(byName: Record<string, StatusValue[]>): string {
  return Object.entries(byName)
    .filter(([, values]) => values.length > 0)
    .map(
      ([name, values]) =>
        `${name}：${values.map((value) => `${value.name}（${value.value || '未定'}）`).join('、')}`,
    )
    .join('\n')
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

/**
 * 一个回合：一条导演大纲 → 一次模型调用 → 一段小说正文。
 * 不调用任何工具，也不写 state。
 */
export async function runTurn(args: RunTurnArgs): Promise<void> {
  const { dir, meta, cast } = args
  const turn = args.turn ?? meta.turn
  const model = args.model ?? meta.model

  await args.emit({ type: 'turn_start', turn })
  if (!args.reuseOutline) {
    appendMessage(dir, { role: 'director', turn, at: now(), text: args.outline })
  }

  const messages = buildMessages({
    agentMd: args.agentMd,
    cast,
    castStatus: args.statusByName ?? {},
    perspective: meta.perspective ?? '第三人称限知',
    memory: memoryBlock(args.memories),
    history: args.history,
    outline: args.outline,
  })

  const llm = getLlmRunner()
  let narrative = ''

  try {
    for await (const chunk of llm({
      model,
      messages,
      baseUrl: args.provider?.baseUrl,
      apiKey: args.provider?.apiKey,
      reasoningEffort: args.reasoningEffort,
      reasoningParam: args.reasoningParam,
      supportsReasoning: args.supportsReasoning,
    })) {
      if (args.signal?.aborted) throw new Error('aborted')
      if (chunk.type === 'delta' && chunk.text) {
        narrative += chunk.text
        await args.emit({ type: 'delta', text: chunk.text })
      }
      if (chunk.type === 'done') break
    }
  } catch (error) {
    // 已收到的半截情节先落盘，并标明这是中断的回合。
    if (narrative) {
      appendMessage(dir, { role: 'narrative', turn, at: now(), text: narrative, interrupted: true })
    }

    if (isAborted(error, args.signal)) {
      // 中断也占掉一个回合号，避免下一条导演消息与它撞号。
      writeMeta(dir, { ...meta, turn: turn + 1, updatedAt: now() })
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[turn] 回合 ${turn + 1} 失败：${message}`)
    appendMessage(dir, { role: 'system', at: now(), kind: 'error', text: message })
    writeMeta(dir, { ...meta, updatedAt: now() })
    await safeEmit(args, { type: 'error', message })
    return
  }

  if (!narrative) {
    narrative = '（模型没有给出情节。请重试，或检查模型配置。）'
    await args.emit({ type: 'delta', text: narrative })
  }

  appendMessage(dir, { role: 'narrative', turn, at: now(), text: narrative })

  const nextMeta: SessionMeta = { ...meta, turn: turn + 1, updatedAt: now() }
  writeMeta(dir, nextMeta)

  await args.emit({ type: 'done', turn: nextMeta.turn })

  // 正文写完后一次轻量调用：三条下一步的候选 + 角色状态更新。
  // 失败或为空都不影响本回合；状态解析坏了只是不更新状态。
  const extras = await generateTurnExtras({
    recent: narrative,
    statusLines: statusLinesOf(args.statusByName ?? {}),
    model,
    baseUrl: args.provider?.baseUrl,
    apiKey: args.provider?.apiKey,
  }).catch(() => ({ options: [], status: {} }))

  if (extras.options.length > 0) {
    saveNextOptions(dir, turn, extras.options)
    await safeEmit(args, { type: 'next_options', turn, options: extras.options })
  }

  // 只有这场戏配了状态模板才落状态；AI 可改值、可提议新增，不能删条目。
  if (args.nameToId && Object.keys(args.nameToId).length > 0) {
    const applied = applyAiStatus(dir, readMeta(dir), turn, extras.status, args.nameToId)
    if (applied.changed) {
      await safeEmit(args, { type: 'status_update', turn, status: applied.view })
    }
  }

  // 超过最近 8 回合后，把最早的一批压成摘要；失败不影响本回合。
  try {
    await rememberBatch(dir, args.memories, nextMeta.turn, {
      model,
      baseUrl: args.provider?.baseUrl,
      apiKey: args.provider?.apiKey,
    })
  } catch (error) {
    console.error(`[memory] 回合 ${nextMeta.turn} 记忆失败：`, error)
  }
}
