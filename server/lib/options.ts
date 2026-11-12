import { getLlmRunner } from './llm'
import type { ChatMessage } from './prompt'

/**
 * 正文写完后单独调一次模型，给导演三条下一步的候选。
 * 这是独立于正文的轻量调用：不带思考强度，失败就当没生成，不影响正文。
 */
export type OptionsRunner = (recent: string) => Promise<string[]>

let override: OptionsRunner | null = null

/** 测试接缝：注入确定的候选，或注入 () => [] 关闭生成。 */
export function setOptionsRunner(fn: OptionsRunner | null): void {
  override = fn
}

/** 一场戏之后最多给三条候选。 */
export const OPTION_COUNT = 3

/** 从模型输出里抠出 options 数组；格式不对就当没生成。 */
export function parseOptions(text: string): string[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { options?: unknown }
    if (!Array.isArray(parsed.options)) return []
    return parsed.options
      .map((option) => String(option).trim())
      .filter((option) => option.length > 0)
      .slice(0, OPTION_COUNT)
  } catch {
    return []
  }
}

const OPTIONS_PROMPT = `你是这场戏的分场编剧。读最近一段剧情，替导演想三条接下来可以怎么演的候选大纲。

要求：
- 每条是导演口吻的一句指令，10~30 字，彼此方向不同（冲突升级、新信息、关系变化等）。
- 只写指令，不写正文，不解释。
- 只输出 JSON：{"options":["第一条","第二条","第三条"]}`

export interface GenerateOptionsArgs {
  recent: string
  model: string
  baseUrl?: string
  apiKey?: string
}

/** 生成后续剧情选项；任何失败都返回空数组。 */
export async function generateNextOptions(args: GenerateOptionsArgs): Promise<string[]> {
  if (override) return override(args.recent)
  const messages: ChatMessage[] = [
    { role: 'system', content: OPTIONS_PROMPT },
    { role: 'user', content: `最近剧情：\n${args.recent.slice(0, 2400)}` },
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
  return parseOptions(text)
}
