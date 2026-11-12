import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readMessages, type MessageRecord } from './session-fs'

/** 一条「更早剧情」的记忆：摘要 + 索引（关键词/人物），对应一段回合区间。 */
export interface MemoryRecord {
  id: string
  /** 0 基，闭区间。 */
  turns: [number, number]
  summary: string
  keywords: string[]
  entities: string[]
  createdAt: string
}

export interface MemoryDigest {
  summary: string
  keywords: string[]
  entities: string[]
}

/** 摘要生成器接缝：默认用启发式，测试可注入固定结果。 */
export type MemoryRunner = (turns: [number, number], transcript: string) => Promise<MemoryDigest>

let memoryRunner: MemoryRunner | null = null

export function setMemoryRunner(runner: MemoryRunner | null): void {
  memoryRunner = runner
}

import { getLlmRunner } from './llm'

export function memoryFile(dir: string): string {
  return path.join(dir, 'memory.jsonl')
}

export function readMemories(dir: string): MemoryRecord[] {
  const file = memoryFile(dir)
  if (!existsSync(file)) return []
  const out: MemoryRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as MemoryRecord)
    } catch {
      // 跳过坏行，不阻塞会话。
    }
  }
  return out.sort((a, b) => a.turns[0] - b.turns[0])
}

function appendMemory(dir: string, record: MemoryRecord): void {
  appendFileSync(memoryFile(dir), JSON.stringify(record) + '\n', 'utf8')
}

/** 已记忆覆盖到第几回合（不含）。 */
export function rememberedUntil(memories: MemoryRecord[]): number {
  return memories.reduce((max, record) => Math.max(max, record.turns[1] + 1), 0)
}

const CHUNK = 4
const KEEP_RECENT = 8

/**
 * 下一批该记忆的回合：从已记忆处开始，最多 CHUNK 回合，
 * 且不能侵入最近 KEEP_RECENT 回合（那些保留原文）。
 */
export function pendingTurns(memories: MemoryRecord[], currentTurn: number): [number, number] | null {
  const start = rememberedUntil(memories)
  if (currentTurn - start <= KEEP_RECENT) return null
  const end = Math.min(start + CHUNK - 1, currentTurn - KEEP_RECENT - 1)
  return start <= end ? [start, end] : null
}

export function transcriptOf(messages: MessageRecord[], turns: [number, number]): string {
  return messages
    .filter(
      (message): message is Exclude<MessageRecord, { role: 'system' }> =>
        message.role !== 'system' && message.turn >= turns[0] && message.turn <= turns[1],
    )
    .map((message) => (message.role === 'director' ? `导演：${message.text}` : message.text))
    .join('\n')
}

function defaultKeywords(transcript: string): string[] {
  return Array.from(new Set(transcript.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [])).slice(0, 8)
}

/** 记忆摘要可以沿用会话模型，但不需要思考强度。 */
export interface MemoryModelOptions {
  model?: string
  baseUrl?: string
  apiKey?: string
}

/** 默认记忆生成器：让模型把一批回合压成摘要 + 索引；失败退化为截断。 */
function llmRunner(model: string, options: { baseUrl?: string; apiKey?: string } = {}): MemoryRunner {
  return async (_turns, transcript) => {
    let text = ''
    try {
      for await (const chunk of getLlmRunner()({
        model,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        messages: [
          {
            role: 'system',
            content: '你是剧情记忆整理器。把给定回合的剧情压成简洁摘要与检索索引，只输出 JSON。',
          },
          {
            role: 'user',
            content: `原文：\n${transcript}\n\n输出 JSON：{"summary":"两句话以内","keywords":["关键词"],"entities":["人物"]}`,
          },
        ],
      })) {
        if (chunk.type === 'delta' && chunk.text) text += chunk.text
        if (chunk.type === 'done') break
      }
    } catch {
      // 退化为截断，不阻塞会话。
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1)) as {
          summary?: unknown
          keywords?: unknown
          entities?: unknown
        }
        return {
          summary: String(parsed.summary ?? transcript.slice(0, 200)),
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : defaultKeywords(transcript),
          entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
        }
      } catch {
        // 落到下面的退化路径。
      }
    }
    return { summary: transcript.slice(0, 300), keywords: defaultKeywords(transcript), entities: [] }
  }
}

/** 把最早的一批未记忆回合压成一条记忆，返回新记录；没到时机返回 null。 */
export async function rememberBatch(
  dir: string,
  memories: MemoryRecord[],
  currentTurn: number,
  options: MemoryModelOptions | string = {},
): Promise<MemoryRecord | null> {
  const turns = pendingTurns(memories, currentTurn)
  if (!turns) return null
  const modelOptions = typeof options === 'string' ? { model: options } : options
  const model = modelOptions.model ?? (process.env.DEFAULT_MODEL || 'deepseek-chat')
  const transcript = transcriptOf(readMessages(dir), turns)
  const runner = memoryRunner ?? llmRunner(model, {
    baseUrl: modelOptions.baseUrl,
    apiKey: modelOptions.apiKey,
  })
  const digest = await runner(turns, transcript)
  const record: MemoryRecord = {
    id: `m${turns[0]}-${turns[1]}`,
    turns,
    summary: digest.summary.trim().slice(0, 500),
    keywords: digest.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 12),
    entities: digest.entities.map((entity) => entity.trim()).filter(Boolean).slice(0, 8),
    createdAt: new Date().toISOString(),
  }
  appendMemory(dir, record)
  return record
}

/** prompt 里的「更早剧情」段：摘要 + 索引签名。 */
export function memoryBlock(memories: MemoryRecord[]): string {
  if (!memories.length) return ''
  return memories
    .map((memory) => {
      const range = `回合 ${memory.turns[0] + 1}–${memory.turns[1] + 1}`
      const keywords = memory.keywords.length ? `（关键词：${memory.keywords.join('、')}）` : ''
      return `${range}：${memory.summary}${keywords}`
    })
    .join('\n')
}

export function excerptTurns(dir: string, turns: [number, number]): string {
  return transcriptOf(readMessages(dir), turns).slice(0, 2000)
}
