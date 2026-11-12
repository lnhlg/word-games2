import OpenAI from 'openai'
import type { ChatMessage } from './prompt'
import { TOOL_SCHEMAS } from './tools'

export interface LlmChunk {
  type: 'delta' | 'tool_call' | 'done'
  text?: string
  toolCall?: { id: string; name: string; args: string }
  finishReason?: string
}

export interface LlmParams {
  model: string
  messages: ChatMessage[]
}

export type LlmRunner = (params: LlmParams) => AsyncGenerator<LlmChunk>

let override: LlmRunner | null = null

/** 测试接缝：用可编程假驱动替换真实模型。 */
export function setLlmRunner(fn: LlmRunner | null): void {
  override = fn
}

export function getLlmRunner(): LlmRunner {
  return override ?? realRunner
}

const realRunner: LlmRunner = async function* ({ model, messages }) {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) throw new Error('缺少 LLM_API_KEY，请在 .env 里配置')
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.LLM_BASE_URL || undefined,
  })

  const stream = await client.chat.completions.create({
    model,
    messages: messages as never,
    tools: TOOL_SCHEMAS as never,
    stream: true,
  })

  const pending: Record<number, { id: string; name: string; args: string }> = {}

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (!choice) continue
    const delta = choice.delta

    if (delta?.content) {
      yield { type: 'delta', text: delta.content }
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const index = tc.index ?? 0
        const slot = (pending[index] ??= { id: '', name: '', args: '' })
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name += tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
      }
    }

    if (choice.finish_reason) {
      for (const [index, slot] of Object.entries(pending)) {
        yield {
          type: 'tool_call',
          toolCall: { id: slot.id || `call_${index}`, name: slot.name, args: slot.args },
        }
      }
      yield { type: 'done', finishReason: choice.finish_reason }
      return
    }
  }

  yield { type: 'done', finishReason: 'stop' }
}
