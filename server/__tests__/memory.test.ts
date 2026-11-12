import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  memoryBlock,
  pendingTurns,
  readMemories,
  rememberBatch,
  searchMemories,
  setMemoryRunner,
  type MemoryRecord,
} from '../lib/memory'
import { executeTool } from '../lib/tools'
import type { GameState } from '../lib/session-fs'
import type { World } from '../lib/world'

function makeDir(messages: unknown[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'wg-memory-'))
  writeFileSync(
    path.join(dir, 'messages.jsonl'),
    messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
    'utf8',
  )
  return dir
}

const playerLine = (turn: number, text: string) => ({
  role: 'player',
  turn,
  at: '2026-11-12T00:00:00.000Z',
  text,
})

const engineLine = (turn: number, text: string) => ({
  role: 'engine',
  turn,
  at: '2026-11-12T00:00:01.000Z',
  kind: 'text',
  text,
})

const world: World = {
  engine: { name: '测试引擎', tone: '克制', boundaries: [] },
  opening: '',
  scenes: [],
  endings: [],
  raw: '',
}

const state: GameState = {
  turn: 0,
  scene: 'hallway',
  location: 'hallway',
  stats: { 洞察: 2, 胆识: 2, 共情: 2 },
  inventory: [],
  flags: {},
  lastCheck: null,
  ending: null,
}

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

describe('摘要 + 索引', () => {
  it('rememberBatch 生成摘要与关键词并落盘', async () => {
    const dir = makeDir([playerLine(0, '我推开书房的门'), engineLine(0, '门轴响了。')])
    setMemoryRunner(async () => ({
      summary: '玩家进入书房。',
      keywords: ['书房', '门轴'],
      entities: ['书房'],
    }))
    const record = await rememberBatch(dir, [], 9)
    expect(record?.turns).toEqual([0, 0])
    expect(record?.keywords).toContain('书房')
    expect(readMemories(dir)).toHaveLength(1)
    expect(memoryBlock([record!])).toContain('回合 1–1：玩家进入书房。')
    expect(memoryBlock([record!])).toContain('关键词：书房、门轴')
  })

  it('searchMemories 命中索引后取回对应原文', () => {
    const dir = makeDir([playerLine(0, '我推开书房的门'), engineLine(0, '门轴发出一声干涩的呻吟。')])
    const memories: MemoryRecord[] = [
      { id: 'm0-0', turns: [0, 0], summary: '玩家进入书房。', keywords: ['书房'], entities: [], createdAt: '' },
    ]
    const hits = searchMemories(dir, memories, '书房')
    expect(hits).toHaveLength(1)
    expect(hits[0].excerpt).toContain('门轴发出一声干涩的呻吟')
  })
})

describe('recall 工具', () => {
  const memories: MemoryRecord[] = [
    { id: 'm0-0', turns: [0, 0], summary: '玩家进入书房。', keywords: ['书房'], entities: ['沈砚'], createdAt: '' },
  ]

  it('按关键词命中', () => {
    const dir = makeDir([playerLine(0, '我推开书房的门'), engineLine(0, '门轴发出一声干涩的呻吟。')])
    const outcome = executeTool('recall', { query: '书房' }, { world, state, dir, memories })
    expect(outcome.ok).toBe(true)
    expect(JSON.stringify(outcome.result)).toContain('门轴')
  })

  it('按回合范围直接取原文', () => {
    const dir = makeDir([playerLine(0, '我推开书房的门'), engineLine(0, '门轴发出一声干涩的呻吟。')])
    const outcome = executeTool('recall', { turns: [0, 0] }, { world, state, dir, memories })
    expect(outcome.ok).toBe(true)
    expect(JSON.stringify(outcome.result)).toContain('门轴')
  })

  it('没有参数时失败', () => {
    const outcome = executeTool('recall', {}, { world, state, dir: makeDir([]), memories })
    expect(outcome.ok).toBe(false)
  })
})
