import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  memoryBlock,
  pendingTurns,
  readMemories,
  rememberBatch,
  setMemoryRunner,
  transcriptOf,
  type MemoryRecord,
} from '../lib/memory'

function makeDir(messages: unknown[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wg-memory-'))
  writeFileSync(
    path.join(dir, 'messages.jsonl'),
    messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
    'utf8',
  )
  return dir
}

const directorLine = (turn: number, text: string) => ({
  role: 'director',
  turn,
  at: '2026-11-12T00:00:00.000Z',
  text,
})

const narrativeLine = (turn: number, text: string) => ({
  role: 'narrative',
  turn,
  at: '2026-11-12T00:00:01.000Z',
  text,
})

afterEach(() => {
  setMemoryRunner(null)
})

describe('memory 时机', () => {
  it('不超过最近 8 回合时不记忆', () => {
    expect(pendingTurns([], 8)).toBeNull()
  })

  it('超过 8 回合后从最早一批开始，每批 4 回合', () => {
    expect(pendingTurns([], 9)).toEqual([0, 0])
    expect(pendingTurns([], 12)).toEqual([0, 3])
  })

  it('已有记忆时接着往后排', () => {
    const memories: MemoryRecord[] = [
      { id: 'm0-3', turns: [0, 3], summary: '早先的剧情。', keywords: [], entities: [], createdAt: '' },
    ]
    expect(pendingTurns(memories, 13)).toEqual([4, 4])
  })
})

describe('transcript 与摘要', () => {
  it('transcriptOf 保留导演大纲，情节原文照抄', () => {
    const dir = makeDir([directorLine(0, '推门进去'), narrativeLine(0, '门轴发出一声干涩的呻吟。')])
    const text = transcriptOf(
      [
        { role: 'director', turn: 0, at: '', text: '推门进去' },
        { role: 'narrative', turn: 0, at: '', text: '门轴发出一声干涩的呻吟。' },
      ],
      [0, 0],
    )
    expect(text).toContain('导演：推门进去')
    expect(text).toContain('门轴发出一声干涩的呻吟。')
    expect(dir).toBeTruthy()
  })

  it('rememberBatch 生成摘要与关键词并落盘', async () => {
    const dir = makeDir([directorLine(0, '我推开书房的门'), narrativeLine(0, '门轴响了。')])
    setMemoryRunner(async () => ({
      summary: '沈砚走进书房。',
      keywords: ['书房', '门轴'],
      entities: ['书房'],
    }))
    const record = await rememberBatch(dir, [], 9)
    expect(record?.turns).toEqual([0, 0])
    expect(record?.keywords).toContain('书房')
    expect(readMemories(dir)).toHaveLength(1)
    expect(memoryBlock([record!])).toContain('回合 1–1：沈砚走进书房。')
    expect(memoryBlock([record!])).toContain('关键词：书房、门轴')
  })

  it('没到时机时不写记忆文件', async () => {
    const dir = makeDir([directorLine(0, '第一幕'), narrativeLine(0, '灯亮了。')])
    expect(await rememberBatch(dir, [], 1)).toBeNull()
    expect(readMemories(dir)).toHaveLength(0)
  })
})
