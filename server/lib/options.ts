import { getLlmRunner } from './llm'
import type { ChatMessage } from './prompt'
import { MAX_STATUS_ITEMS, type AiStatusInput, type StatusValue } from './status'
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

/**
 * 状态行给选项/状态那次调用看：`沈砚：好感度（35）、被怀疑（是）`。
 * 自动 extras 与单独重生成选项共用同一份措辞。
 */
export function statusLinesOf(byName: Record<string, StatusValue[]>): string {
  return Object.entries(byName)
    .filter(([, values]) => values.length > 0)
    .map(
      ([name, values]) =>
        `${name}：${values.map((value) => `${value.name}（${value.value || '未定'}）`).join('、')}`,
    )
    .join('\n')
}

function sliceJson(text: string): string | null {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start =
    objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart
  if (start < 0) return null
  const end = text.lastIndexOf(text[start] === '{' ? '}' : ']')
  return end > start ? text.slice(start, end + 1) : null
}

/** 去掉选项首尾的引号/书名号；只在成对时剥，避免误伤正文里的对话。 */
function stripOuterQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
    ["'", "'"],
  ]
  for (const [open, close] of pairs) {
    if (value.length > 2 && value.startsWith(open) && value.endsWith(close)) {
      return value.slice(open.length, value.length - close.length).trim()
    }
  }
  return value
}

function cleanOption(value: unknown): string {
  return stripOuterQuotes(String(value).trim())
}

/** 模型按 JSON 输出时的解析：`{"options":[...]}` 与裸数组都认。 */
function parseOptionsFromJson(text: string): string[] {
  const json = sliceJson(text)
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    const raw = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null
        ? (parsed as { options?: unknown }).options
        : null
    if (!Array.isArray(raw)) return []
    return raw
      .map(cleanOption)
      .filter((option) => option.length > 0)
      .slice(0, OPTION_COUNT)
  } catch {
    return []
  }
}

const LINE_PREFIX = /^(?:[-*•·]|\d+[.、)）]|第[一二三]条[:：]?)\s*/

/** 像一条选项的短句：太短是标题、太长是解释段落。 */
function isPlausible(value: string): boolean {
  return value.length >= 6 && value.length <= 80
}

/**
 * 模型没按 JSON 输出时的兜底：优先收带编号/项目符号的行；
 * 没有前缀时，只有整段恰好是几行并列短句才认，宁缺毋滥。
 */
function parseOptionsFromLines(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('```'))

  const prefixed = lines
    .map((line) => (LINE_PREFIX.test(line) ? cleanOption(line.replace(LINE_PREFIX, '')) : ''))
    .filter(isPlausible)
  if (prefixed.length >= 2) return prefixed.slice(0, OPTION_COUNT)

  const plain = lines
    .filter((line) => !line.endsWith('：') && !line.endsWith(':'))
    .map(cleanOption)
    .filter(isPlausible)
  return plain.length >= 3 ? plain.slice(0, OPTION_COUNT) : []
}

/**
 * 从模型输出里抠出 options 数组；先按 JSON 解析，失败再按行兜底。
 * JSON 可能被代码块或解释文字包住，也可能被截断。
 */
export function parseOptions(text: string): string[] {
  const fromJson = parseOptionsFromJson(text)
  if (fromJson.length) return fromJson
  return parseOptionsFromLines(text)
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

// —— 单独重生成后续选项：不写正文、不动状态，只换这一回合末尾的三条候选 ——

const OPTIONS_PROMPT = `你是这场戏的分场编剧。读最后一回合的大纲、情节与角色此刻的状态，替导演想三条「接下来可以怎么演」的候选大纲。

要求：
- 每条是导演口吻的一句指令，10~30 字；必须从这一回合情节的结尾接着往下写，第一条尤其要贴着最后那个动作、那句话或那个悬念走，不要重写已经发生的事。
- 三条方向彼此不同（冲突升级、新信息、关系变化、视角切换等）；不要写成同一件事的三种说法。
- 若给出【导演的想法】，三条都朝这个想法展开；但不要违背已经发生的情节，也不要在一条选项里塞进太多转折。
- 不写正文、不解释、不要编号前缀。
- 只输出 JSON（不要用代码块或反引号包住，不要任何前后说明）：{"options":["第一条","第二条","第三条"]}`

export interface NextOptionsArgs {
  /** 最后一回合的导演大纲。 */
  outline: string
  /** 最后一回合的情节；用结尾一段，保证选项接得上。 */
  passage: string
  /** 每角色一行当前状态；空串表示这场戏没启用角色状态。 */
  statusLines: string
  /** 本场的叙述视角。 */
  perspective: string
  /** 这一回合已有的一批选项；重新生成时给模型看，要求换个方向。 */
  previous?: string[]
  /** 导演这次想往哪个方向走；空表示不限定。 */
  idea?: string
  model: string
  baseUrl?: string
  apiKey?: string
}

/** 只读末尾这么长，足够模型接住结尾，又不会把整回合塞进去。 */
const OPTIONS_PASSAGE_CHARS = 1200

/**
 * 为最后一回合单独生成三条后续选项。
 * 测试接缝复用 setTurnExtrasRunner / setOptionsRunner（只取其中的 options）。
 * 失败或模型没给出可用结果时返回空数组，由路由决定报错。
 */
export async function generateNextOptions(args: NextOptionsArgs): Promise<string[]> {
  if (override) {
    const result = await override({ recent: args.passage, statusLines: args.statusLines })
    return result.options
  }

  const previous = (args.previous ?? []).filter((option) => option.trim())
  const idea = args.idea?.trim()
  const user = [
    `【本场视角】\n${args.perspective.trim() || '第三人称限知'}`,
    `【最后一回合的大纲】\n${args.outline.trim() || '（没有记录）'}`,
    `【最后一回合的情节（结尾）】\n${args.passage.slice(-OPTIONS_PASSAGE_CHARS)}`,
    idea ? `【导演的想法】\n${idea}` : '',
    args.statusLines ? `【角色此刻的状态】\n${args.statusLines}` : '',
    previous.length
      ? `【上一批选项（已经给过导演，这次换不同的方向）】\n${previous
          .map((option, index) => `${index + 1}. ${option}`)
          .join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: OPTIONS_PROMPT },
    { role: 'user', content: user },
  ]

  // 模型偶尔漏 JSON、或先写一段解释：换一次再试，比让导演直接看到失败强。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 第二次把纠正话放在末尾，比原样重发更容易让模型照格式输出。
    const attemptMessages =
      attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: 'user' as const,
              content:
                '上一遍没有给出能解析的选项。这次只输出 JSON，不要解释、不要代码块：{"options":["第一条","第二条","第三条"]}',
            },
          ]
    let text = ''
    try {
      text = await runOptionsModel(args, attemptMessages)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[options] 生成选项失败（第 ${attempt + 1} 次）：${message}`)
      continue
    }
    const options = parseOptions(text)
    if (options.length) return options
    console.warn(
      `[options] 没解析出选项（第 ${attempt + 1} 次），原始输出：${text.slice(0, 400) || '（空）'}`,
    )
  }
  return []
}

async function runOptionsModel(args: NextOptionsArgs, messages: ChatMessage[]): Promise<string> {
  let text = ''
  for await (const chunk of getLlmRunner()({
    model: args.model,
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    messages,
  })) {
    if (chunk.type === 'delta' && chunk.text) text += chunk.text
    if (chunk.type === 'done') break
  }
  return text
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
