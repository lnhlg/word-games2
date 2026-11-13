import { getLlmRunner } from './llm'
import type { ChatMessage } from './prompt'

/**
 * 选区改写：导演挑出一小段文字、给一句要求，让模型只重写这一段。
 * 决策与取舍见 docs/adr/0003-selection-rewrite.md。
 */

/** 改写结果超过这个长度就认为跑偏了，不替换。 */
export const REWRITE_MAX_CHARS = 2000

const REWRITE_PROMPT = `你是这场戏的小说家，正在按导演的要求改稿。

导演会给你这一段出自哪一回、这一回合的大纲、这一回合的完整情节，以及上一回合的结尾和下一回合的开头（如果有）。他只挑出了其中一小段，要你重写这一小段。

规则：
- 只输出改写后的那一小段文字本身。不要用引号把整段包起来，不要「改写后：」这类前缀，不要解释你改了什么，不要把整段情节再抄一遍。
- 按导演的要求改：润色、压缩、扩写、换语气、调细节、改事实都可以；他没提到的部分不要顺手改。
- 改完必须与前后文无缝衔接：人名、称谓、人称、时态、节奏、用词习惯都要和原文一致。如果改动会和紧邻的前后文冲突（包括下一回合已经写好的内容），就在这一小段内部把衔接处理掉。
- 保持排版：段与段之间空一行；段首不要加空格或缩进；不要用 Markdown 记号（#、**、-、>、反引号）。`

export interface RewriteContext {
  /** 这一回合的导演大纲。 */
  outline: string
  /** 这一回合的完整情节（要改的那段就在其中）。 */
  passage: string
  /** 上一回合情节的结尾；没有上一回合时为空。 */
  beforePassage?: string
  /** 下一回合的导演大纲；没有下一回合时为空。 */
  afterOutline?: string
  /** 下一回合情节的开头；没有下一回合时为空。 */
  afterPassage?: string
}

export interface RewriteArgs extends RewriteContext {
  /** 导演选中的那一小段。 */
  selected: string
  /** 导演的要求；空串表示只润色。 */
  instruction: string
  model: string
  baseUrl?: string
  apiKey?: string
}

/**
 * 剥掉模型常见的包裹：首尾引号、「改写后：」前缀、Markdown 粗体、零宽字符。
 * 只做这些确定性的清理，不改动正文用词。
 */
export function cleanRewrite(raw: string): string {
  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\uFEFF/g, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .trim()

  text = text.replace(/^(?:改写后|改写结果|修改后|润色后|以下是改写后?的文字?|以下是修改后?的文字?)\s*[:：]\s*/, '')

  text = stripOuterQuotes(text)
  text = text.replace(/\*\*(.+?)\*\*/g, '$1')

  return text.trim()
}

function stripOuterQuotes(text: string): string {
  const pairs: Array<[string, string]> = [
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
    ['"', '"'],
  ]
  for (const [open, close] of pairs) {
    if (text.length <= 2) break
    if (!text.startsWith(open) || !text.endsWith(close)) continue
    const inner = text.slice(open.length, text.length - close.length)
    // 里面还有同样的开引号，说明那对引号本来就是对话，不剥。
    const nested = open === close ? inner.includes(close) : inner.includes(open)
    if (nested) continue
    return inner.trim()
  }
  return text
}

/** 导演没写要求时的默认指令。 */
export const DEFAULT_INSTRUCTION = '把这段润色一遍：改掉别扭的措辞，保持原意。'

export async function generateRewrite(args: RewriteArgs): Promise<string> {
  const parts = [
    `【本回合大纲】\n${args.outline.trim() || '（没有记录）'}`,
    `【本回合完整情节】\n${args.passage}`,
    args.beforePassage?.trim() ? `【上一回合的结尾】\n${args.beforePassage}` : '',
    args.afterOutline?.trim() || args.afterPassage?.trim()
      ? `【下一回合】\n${[
          args.afterOutline?.trim() ? `大纲：${args.afterOutline.trim()}` : '',
          args.afterPassage?.trim() ? `开头：${args.afterPassage}` : '',
        ]
          .filter(Boolean)
          .join('\n')}`
      : '',
    `【要改的这一小段】\n${args.selected}`,
    `【导演的要求】\n${args.instruction.trim() || DEFAULT_INSTRUCTION}`,
  ].filter(Boolean)

  const messages: ChatMessage[] = [
    { role: 'system', content: REWRITE_PROMPT },
    { role: 'user', content: parts.join('\n\n') },
  ]

  let text = ''
  for await (const chunk of getLlmRunner()({
    model: args.model,
    messages,
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
  })) {
    if (chunk.type === 'delta' && chunk.text) text += chunk.text
    if (chunk.type === 'done') break
  }
  return cleanRewrite(text)
}
