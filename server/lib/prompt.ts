import type { GameState } from './session-fs'
import type { World } from './world'

/** 代码注入、用户不可编辑的最小系统指令。身份数据放 world.yaml 的 engine 段。 */
export const CONTRACT = `你是互动小说（Interactive Fiction）的叙事引擎（Narrative Engine）。
你只负责生成场景、描写环境、推进剧情、判定结果，不替玩家做决定。
每回合必须调用至少一次工具，并且必须以 end_turn 收尾；end_turn 的 options 给出 2–4 个可执行动作。
判定一律用 roll_check：d6 + 属性 对比 dc，以工具返回的结果为准，不要自己编数值。
移动一律用 move_to，只能走当前场景的出口。
触发结局用 trigger_ending；结局触发后不再 end_turn。
需要回忆更早的剧情细节时，用 recall 工具：按关键词搜记忆索引，或按回合范围取回原文。
叙事用第二人称、冷峻克制；不剧透未触发的结局，不替玩家描述其内心决定。`

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface PromptInput {
  agentMd: string
  world: World
  state: GameState
  /** 更早剧情的摘要 + 索引（memoryBlock 的结果）。 */
  memory: string
  history: { role: string; text: string }[]
  playerInput: string
}

export function worldBlock(world: World): string {
  const engine = world.engine
  const lines: string[] = []
  if (engine?.name) lines.push(`引擎身份：${engine.name}`)
  if (engine?.tone) lines.push(`语气：${engine.tone}`)
  if (engine?.boundaries?.length) lines.push(`边界：${engine.boundaries.join('；')}`)
  if (world.opening) lines.push(`开场：${world.opening}`)
  if (world.scenes.length) {
    lines.push('场景骨架：')
    for (const s of world.scenes) lines.push(`- ${s.id}（${s.name}）出口：${s.exits.join(', ') || '无'}`)
  }
  if (world.endings.length) {
    lines.push(`结局骨架：${world.endings.map((e) => e.id).join(', ')}`)
  }
  return lines.join('\n')
}

export function stateBlock(state: GameState): string {
  return `当前状态（以 state.json 为准）：\n${JSON.stringify(state, null, 2)}`
}

export function historyBlock(history: { role: string; text: string }[]): string {
  if (!history.length) return ''
  return `最近剧情：\n${history.map((h) => `${h.role === 'player' ? '玩家' : '引擎'}：${h.text}`).join('\n')}`
}

/** 按 spec 顺序组装 messages：契约 → <model>.md / AGENT.md → world → state → 摘要 → 最近历史 → 玩家输入。 */
export function buildMessages(input: PromptInput): ChatMessage[] {
  const system = [
    CONTRACT,
    input.agentMd.trim(),
    worldBlock(input.world),
    stateBlock(input.state),
  ]
    .filter(Boolean)
    .join('\n\n')

  const user = [
    input.memory ? `【更早剧情（摘要 + 索引）】\n${input.memory}` : '',
    historyBlock(input.history),
    `【玩家本回合行动】\n${input.playerInput}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
