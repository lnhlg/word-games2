import type { CharacterCard } from './character-card'
import type { StatusValue } from './status'

/**
 * 代码注入、用户不可编辑的剧场契约。
 * 这是整场戏的最终约束：卡的 system_prompt 与 AGENT.md 都排在它后面。
 */
export const CONTRACT = `你是这场戏的小说家（novelist）。
每一回合，导演给你一段大纲，你把它写成一段连贯的小说正文——有场景、有动作、有对话，像长篇小说里的一个章节片段。

输出规则：
- 只输出小说正文。不要标题、不要列表、不要小节标题、不要写作说明、不要反问导演、不要解释你在做什么。
- 只写【演员表】里的角色。不要引入没交代过的人物，不要替角色做导演和大纲没有交代的重大决定，不要提前泄露后面才该发生的事。
- 谁开口、谁沉默、谁先动，由情节自然决定；不要为了覆盖所有角色而轮流发言。
- 保持【视角】指定的叙述人称与信息边界。
- 若【演员表】里给出某人的当前状态，那是他此刻的处境：正文里不要直接报出条目名或数值，只写它在言行、神态上的表现。
- 排版：自然段之间空一行；段首顶格，不要自己加空格或缩进（缩进由界面统一给）；不要用 Markdown 记号（#、**、-、>、反引号）。`

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
  /** 会话里的 AGENT.md（或 <模型名>.md）。 */
  agentMd: string
  /** 参演角色卡；缺卡时由调用方跳过。 */
  cast: CharacterCard[]
  /** 每个角色此刻的状态，键是角色名；接在该角色段的末尾。 */
  castStatus?: Record<string, StatusValue[]>
  perspective: string
  /** 更早情节的摘要（memory.jsonl）。 */
  memory: string
  /** 最近若干回合的原始记录。 */
  history: { role: 'director' | 'narrative'; text: string }[]
  /** 本回合的导演大纲。 */
  outline: string
}

/** 演员表：每张卡只取对写小说有用的字段；空字段整段略过。 */
export function castBlock(
  cast: CharacterCard[],
  castStatus: Record<string, StatusValue[]> = {},
): string {
  if (!cast.length) return '【演员表】\n（这场戏没有角色卡。按大纲写一个没有固定角色的片段。）'
  return [
    '【演员表】',
    ...cast.map((card) => {
      const d = card.data
      const lines = [`## ${d.name}`]
      if (d.description.trim()) lines.push(`人物设定：${d.description.trim()}`)
      if (d.personality.trim()) lines.push(`性格：${d.personality.trim()}`)
      if (d.scenario.trim()) lines.push(`处境：${d.scenario.trim()}`)
      if (d.system_prompt.trim()) lines.push(`角色自带指令：${d.system_prompt.trim()}`)
      if (d.first_mes.trim()) lines.push(`首次登场的语气参考（不要照抄）：${d.first_mes.trim()}`)
      if (d.mes_example.trim()) lines.push(`对话样例：\n${d.mes_example.trim()}`)
      const status = castStatus[d.name] ?? []
      if (status.length) {
        lines.push(`当前状态：${status.map((value) => `${value.name} ${value.value || '未定'}`).join('；')}`)
      }
      return lines.join('\n')
    }),
  ].join('\n\n')
}

function historyBlock(history: { role: 'director' | 'narrative'; text: string }[]): string {
  if (!history.length) return ''
  const lines = history.map((h) => (h.role === 'director' ? `导演：${h.text}` : h.text))
  return `【最近情节】\n${lines.join('\n\n')}`
}

/** 角色附注：post_history_instructions 排在情节之后、本轮大纲之前。 */
function notesBlock(cast: CharacterCard[]): string {
  const notes = cast
    .map((card) => ({ name: card.data.name, text: card.data.post_history_instructions.trim() }))
    .filter((note) => note.text)
  if (!notes.length) return ''
  return `【角色附注】\n${notes.map((note) => `${note.name}：${note.text}`).join('\n')}`
}

/**
 * 按 SPEC 组装 messages：
 * system = 剧场契约 → AGENT.md → 演员表 → 视角；
 * user = 更早情节摘要 → 最近情节 → 角色附注 → 本回合大纲。
 */
export function buildMessages(input: PromptInput): ChatMessage[] {
  const system = [
    CONTRACT,
    input.agentMd.trim(),
    castBlock(input.cast, input.castStatus ?? {}),
    `【视角】\n${input.perspective.trim() || '第三人称限知'}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const user = [
    input.memory ? `【更早情节（摘要）】\n${input.memory}` : '',
    historyBlock(input.history),
    notesBlock(input.cast),
    `【本回合大纲】\n${input.outline.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
