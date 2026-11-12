import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveAgentMd } from '../lib/agent-md'
import { buildMessages, CONTRACT } from '../lib/prompt'
import type { GameState } from '../lib/session-fs'
import type { World } from '../lib/world'

const world: World = {
  engine: { name: '雾港引擎', tone: '冷峻克制', boundaries: ['不替玩家做决定', '不剧透结局'] },
  opening: '雾港的雨下了三天。',
  scenes: [
    { id: 'hallway', name: '门厅', exits: ['study', 'parlor'] },
    { id: 'study', name: '旧书房', exits: ['hallway'] },
  ],
  endings: [{ id: 'ending_truth' }],
  raw: '',
}

const state: GameState = {
  turn: 2,
  scene: 'hallway',
  location: 'hallway',
  stats: { 洞察: 2, 胆识: 2, 共情: 2 },
  inventory: ['铜钥匙'],
  flags: { met_landlady: true },
  lastCheck: { attribute: '洞察', roll: 5, total: 7, dc: 8, success: false },
  ending: null,
}

describe('buildMessages 组装顺序', () => {
  it('system：契约 → agent.md → 世界 → 状态，顺序固定', () => {
    const messages = buildMessages({
      agentMd: '【AGENT】按门规行事。',
      world,
      state,
      summary: '',
      history: [],
      playerInput: '推门',
    })
    expect(messages[0].role).toBe('system')
    const text = messages[0].content ?? ''
    expect(text.startsWith(CONTRACT)).toBe(true)

    const order = ['【AGENT】按门规行事。', '引擎身份：雾港引擎', '当前状态（以 state.json 为准）']
    const positions = order.map((part) => text.indexOf(part))
    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('user：摘要 → 最近剧情 → 玩家输入', () => {
    const messages = buildMessages({
      agentMd: '',
      world,
      state,
      summary: '你曾在码头见过一只黑猫。',
      history: [
        { role: 'player', text: '我走进门厅' },
        { role: 'engine', text: '门轴响了。' },
      ],
      playerInput: '我推开书房的门',
    })
    const user = messages[1].content ?? ''
    expect(user.indexOf('【更早剧情摘要】')).toBe(0)
    expect(user.indexOf('最近剧情')).toBeGreaterThan(user.indexOf('【更早剧情摘要】'))
    expect(user.lastIndexOf('【玩家本回合行动】')).toBeGreaterThan(user.indexOf('最近剧情'))
  })

  it('没有 agentMd 时 system 只有契约、世界、状态', () => {
    const messages = buildMessages({
      agentMd: '',
      world,
      state,
      summary: '',
      history: [],
      playerInput: '看',
    })
    const text = messages[0].content ?? ''
    expect(text.startsWith(CONTRACT)).toBe(true)
    expect(text).toContain('引擎身份：雾港引擎')
    expect(text).not.toContain('【AGENT】')
  })
})

describe('resolveAgentMd 优先级', () => {
  it('<model>.md 存在时优先于 AGENT.md', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wg-agent-'))
    writeFileSync(path.join(dir, 'AGENT.md'), '通用设定', 'utf8')
    writeFileSync(path.join(dir, 'deepseek-chat.md'), '模型专属设定', 'utf8')
    expect(resolveAgentMd(dir, 'deepseek-chat')).toBe('模型专属设定')
    rmSync(dir, { recursive: true, force: true })
  })

  it('没有 <model>.md 时用 AGENT.md', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wg-agent-'))
    writeFileSync(path.join(dir, 'AGENT.md'), '通用设定', 'utf8')
    expect(resolveAgentMd(dir, 'other-model')).toBe('通用设定')
    rmSync(dir, { recursive: true, force: true })
  })

  it('两个都不存在时返回空串', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'wg-agent-'))
    expect(resolveAgentMd(dir, 'any-model')).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})
