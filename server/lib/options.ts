import { getLlmRunner } from './llm'
import type { ChatMessage } from './prompt'
import { MAX_STATUS_ITEMS, type AiStatusInput } from './status'
import type { StatusItem } from './session-fs'

/**
 * 正文写完后的一次轻量调用，同时产出两样东西：
 * 3 条后续剧情选项 + 角色状态更新。
 * 合并的理由与降级策略见 docs/adr/0002-character-status.md。
 */
export interface TurnExtras {
  options: string[]
  status: AiStatusInput
}

export type ExtrasRunner = (args: { recent: string; statusLines: string }) => Promise<TurnExtras>

let override: ExtrasRunner | null = null

/** 测试接缝：注入确定的选项与状态，或注入空结果关闭生成。 */
export function setTurnExtrasRunner(fn: ExtrasRunner | null): void {
  override = fn
}

/** 旧接缝：只关心选项的测试可以继续用它。 */
export function setOptionsRunner(fn: ((recent: string) => Promise<string[]>) | null): void {
  override = fn ? async ({ recent }) => ({ options: await fn(recent), status: {} }) : null
}

/** 一场戏之后最多给三条候选。 */
export const OPTION_COUNT = 3

function sliceJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : null
}

/** 从模型输出里抠出 options 数组；格式不对就当没生成。 */
export function parseOptions(text: string): string[] {
  const json = sliceJson(text)
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as { options?: unknown }
    if (!Array.isArray(parsed.options)) return []
    return parsed.options
      .map((option) => String(option).trim())
      .filter((option) => option.length > 0)
      .slice(0, OPTION_COUNT)
  } catch {
    return []
  }
}

type RawEntry = Record<string, unknown>

function entriesOf(value: unknown): RawEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is RawEntry => typeof entry === 'object' && entry !== null)
}

function pickStatus(value: unknown): AiStatusInput {
  const status: AiStatusInput = {}
  const changes = entriesOf(value)
    .map((entry) => ({
      character: String(entry.character ?? '').trim(),
      item: String(entry.item ?? '').trim(),
      value: String(entry.value ?? '').trim(),
      basis: String(entry.basis ?? '').trim(),
    }))
    .filter((entry) => entry.character && entry.item && entry.value)
  if (changes.length) status.changes = changes
  return status
}

function pickNewItems(value: unknown): AiStatusInput['newItems'] {
  if (!Array.isArray(value)) return undefined
  const items = entriesOf(value)
    .map((entry) => ({
      character: String(entry.character ?? '').trim(),
      item: String(entry.item ?? '').trim(),
      value: String(entry.value ?? '').trim(),
      note: String(entry.note ?? '').trim(),
      basis: String(entry.basis ?? '').trim(),
    }))
    .filter((entry) => entry.character && entry.item && entry.value)
  return items.length ? items : undefined
}

/**
 * 按字段降级：整体 JSON 解析失败就两者都不要；
 * 解析成功但某个字段类型不对，只丢那一个字段。
 */
export function parseTurnExtras(text: string): TurnExtras {
  const json = sliceJson(text)
  if (!json) return { options: [], status: {} }
  let parsed: { options?: unknown; status?: unknown; newItems?: unknown }
  try {
    parsed = JSON.parse(json) as typeof parsed
  } catch {
    return { options: [], status: {} }
  }
  const status: AiStatusInput = {
    ...pickStatus(parsed.status),
  }
  const newItems = pickNewItems(parsed.newItems)
  if (newItems) status.newItems = newItems

  const options = Array.isArray(parsed.options)
    ? parsed.options
        .map((option) => String(option).trim())
        .filter((option) => option.length > 0)
        .slice(0, OPTION_COUNT)
    : []
  return { options, status }
}

const EXTRAS_PROMPT = `你是这场戏的分场编剧兼场记。读最近一段剧情，做两件事。

一、替导演想三条接下来可以怎么演的候选大纲：每条是导演口吻的一句指令，10~30 字，方向彼此不同（冲突升级、新信息、关系变化等），不写正文，不解释。

二、更新每个角色的状态值（【当前状态】会给出每个人有哪些条目、现在是多少）：
- status 只能改已经列出的条目名；剧情里冒出新的维度时放进 newItems，并给出此刻的取值与一句说明。
- 值用几个字的短词，不要长句、不要在值里写解释。
- 每一项变化都要给一句依据，说明剧情里哪一处让它变了；没有依据的不要改。
- 状态没变就返回空数组，不要为了填满而编造变化。

只输出 JSON：
{"options":["第一条","第二条","第三条"],"status":[{"character":"角色名","item":"条目名","value":"新值","basis":"一句依据"}],"newItems":[{"character":"角色名","item":"条目名","value":"此刻的取值","note":"这一项看什么","basis":"一句依据"}]}`

export interface GenerateExtrasArgs {
  recent: string
  /** 每角色一行：`名字：条目（值）、条目（值）`；空串表示这场戏没启用角色状态。 */
  statusLines: string
  model: string
  baseUrl?: string
  apiKey?: string
}

/** 生成选项与状态更新；任何失败都返回空结果，不影响正文。 */
export async function generateTurnExtras(args: GenerateExtrasArgs): Promise<TurnExtras> {
  if (override) return override({ recent: args.recent, statusLines: args.statusLines })
  const user = [
    `【最近剧情】\n${args.recent.slice(0, 2400)}`,
    args.statusLines ? `【当前状态】\n${args.statusLines}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: EXTRAS_PROMPT },
    { role: 'user', content: user },
  ]
  let text = ''
  try {
    for await (const chunk of getLlmRunner()({
      model: args.model,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      messages,
    })) {
      if (chunk.type === 'delta' && chunk.text) text += chunk.text
      if (chunk.type === 'done') break
    }
  } catch {
    return { options: [], status: {} }
  }
  return parseTurnExtras(text)
}

// —— 让 AI 为某个角色设计状态项（只给名称与说明，不给具体值）——

const SUGGEST_PROMPT = `你是角色状态设计助手。根据导演的描述和这张角色卡，为这个角色设计「状态项」——这一场戏里值得持续跟踪的处境维度（例如好感度、伤势、怀疑程度、毒性积累）。

要求：
- 只给条目名称与一句说明（这一项看的是什么），不要给具体数值，不要写这个角色现在是多少。
- 名称 2~6 个字；说明一句话。
- 不超过 8 条，挑真正会随剧情变化、又需要被记住的；琐碎的一次性信息不要。
- 只输出 JSON：{"items":[{"name":"好感度","note":"对沈砚的信任与亲近程度"}]}`

export interface SuggestItemsArgs {
  /** 导演那句话，例如「他是毒医，身上带着慢性毒」。 */
  prompt: string
  /** 可选的角色卡上下文；不绑卡时生成的是通用模板。 */
  name?: string
  description?: string
  personality?: string
  model: string
  baseUrl?: string
  apiKey?: string
}

/** 从模型输出里读出状态项清单；格式不对就当没生成。 */
export function parseSuggestedItems(text: string): StatusItem[] {
  const json = sliceJson(text)
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as { items?: unknown }
    if (!Array.isArray(parsed.items)) return []
    const out: StatusItem[] = []
    for (const entry of entriesOf(parsed.items)) {
      const name = String(entry.name ?? '').trim().slice(0, 12)
      const note = String(entry.note ?? '').trim().slice(0, 60)
      if (!name || out.some((item) => item.name === name) || out.length >= MAX_STATUS_ITEMS) continue
      out.push({ name, note })
    }
    return out
  } catch {
    return []
  }
}

/** 为某个角色（或通用场景）生成一组状态项；失败返回空数组，由界面提示再试。 */
export async function suggestStatusItems(args: SuggestItemsArgs): Promise<StatusItem[]> {
  const brief = [
    args.name?.trim() ? `角色名：${args.name.trim()}` : '',
    args.description?.trim() ? `人物设定：${args.description.trim().slice(0, 800)}` : '',
    args.personality?.trim() ? `性格：${args.personality.trim().slice(0, 400)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const user = [brief, `导演的描述：${args.prompt}`].filter(Boolean).join('\n\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: SUGGEST_PROMPT },
    { role: 'user', content: user },
  ]
  let text = ''
  try {
    for await (const chunk of getLlmRunner()({
      model: args.model,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      messages,
    })) {
      if (chunk.type === 'delta' && chunk.text) text += chunk.text
      if (chunk.type === 'done') break
    }
  } catch {
    return []
  }
  return parseSuggestedItems(text)
}
