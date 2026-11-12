import OpenAI from 'openai'
import type { ChatMessage } from './prompt'
import type { Effort, ReasoningParam } from './providers'

export interface LlmChunk {
  type: 'delta' | 'tool_call' | 'done'
  text?: string
  toolCall?: { id: string; name: string; args: string }
  finishReason?: string
}

export interface LlmParams {
  model: string
  messages: ChatMessage[]
  /** 供应商凭据；缺省时回退 .env（旧工作区兼容）。 */
  baseUrl?: string
  apiKey?: string
  /** 已解析的思考强度；null/缺省表示不传 reasoning_effort（关闭时由 supportsReasoning 决定是否发 thinking: disabled）。 */
  reasoningEffort?: Effort | null
  /** 所选模型是否声明了思考强度档位；为 true 时总会发送 thinking 参数。 */
  supportsReasoning?: boolean
  /** 上游参数名；Gemini 系列为 thinking_level，其余 reasoning_effort。 */
  reasoningParam?: ReasoningParam
  /** 工具定义；不传就不向上游声明工具（小说回合不需要工具）。 */
  tools?: unknown[]
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

interface ChatStreamChunk {
  choices: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

const realRunner: LlmRunner = async function* (params) {
  const { model, messages, reasoningEffort, supportsReasoning, tools } = params
  const reasoningParam = params.reasoningParam ?? 'reasoning_effort'
  const apiKey = params.apiKey || process.env.LLM_API_KEY
  if (!apiKey) throw new Error('缺少 API key：请在设置里配置供应商，或在 .env 里配置 LLM_API_KEY')
  const client = new OpenAI({
    apiKey,
    baseURL: params.baseUrl || process.env.LLM_BASE_URL || undefined,
  })

  // DeepSeek 只接受 low/high/max，medium 需折算为 high；Gemini 用 thinking_level 直传。
  const upstreamEffort =
    reasoningParam === 'thinking_level' || !reasoningEffort
      ? reasoningEffort
      : reasoningEffort === 'medium'
        ? 'high'
        : reasoningEffort

  const stream = (await client.chat.completions.create({
    model,
    messages: messages as never,
    ...(tools?.length ? { tools: tools as never } : {}),
    stream: true,
    ...(reasoningParam === 'thinking_level'
      ? upstreamEffort
        ? { thinking_level: upstreamEffort }
        : {}
      : {
          // DeepSeek 思考模式默认开启：声明支持强度的模型必须显式开关，关闭时传 disabled。
          ...(supportsReasoning ? { thinking: { type: upstreamEffort ? 'enabled' : 'disabled' } } : {}),
          ...(upstreamEffort ? { reasoning_effort: upstreamEffort } : {}),
        }),
  } as never)) as unknown as AsyncIterable<ChatStreamChunk>

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
