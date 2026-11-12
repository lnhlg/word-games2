import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner } from '../lib/llm'
import type { GameState, MessageRecord } from '../lib/session-fs'

let root: string
let sessionId: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-turn-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
  const body = (await created.json()) as { session: { id: string } }
  sessionId = body.session.id
})

afterEach(() => {
  setLlmRunner(null)
})

interface ScriptStep {
  text?: string
  tools?: { name: string; args: unknown }[]
}

/** 可编程假 LLM：按顺序消费脚本，每次调用产出一步。 */
function fakeLlm(script: ScriptStep[]) {
  let step = 0
  return async function* () {
    const current = script[step] ?? { text: '（脚本结束）', tools: [] }
    step += 1
    if (current.text) yield { type: 'delta' as const, text: current.text }
    for (const [index, tool] of (current.tools ?? []).entries()) {
      yield {
        type: 'tool_call' as const,
        toolCall: { id: `call_${step}_${index}`, name: tool.name, args: JSON.stringify(tool.args) },
      }
    }
    yield { type: 'done' as const, finishReason: 'stop' }
  }
}

function parseSse(text: string): { type: string; [key: string]: unknown }[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.replace(/^data:\s*/, '')) as { type: string })
}

async function postTurn(input: string) {
  return app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  })
}

describe('POST /turns，假 LLM 驱动', () => {
  it('工具调用 + end_turn 产生完整事件序列，并落盘消息与快照', async () => {
    setLlmRunner(
      fakeLlm([
        { tools: [{ name: 'roll_check', args: { attribute: '洞察', dc: 10 } }] },
        {
          text: '门轴发出一声干涩的呻吟。',
          tools: [{ name: 'end_turn', args: { narrative: '', options: ['继续往里走', '退回门厅'] } }],
        },
      ]),
    )

    const res = await postTurn('我推开书房的门')
    expect(res.status).toBe(200)

    const events = parseSse(await res.text())
    const types = events.map((e) => e.type)
    expect(types).toContain('turn_start')
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(types).toContain('delta')
    expect(types).toContain('options')
    expect(types).toContain('state')
    expect(types).toContain('done')

    const optionsEvent = events.find((e) => e.type === 'options') as unknown as { options: string[] }
    expect(optionsEvent.options).toEqual(['继续往里走', '退回门厅'])

    const dir = path.join(root, sessionId)
    const records = readFileSync(path.join(dir, 'messages.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as MessageRecord)

    expect(records[0]).toMatchObject({ role: 'player', text: '我推开书房的门' })
    expect(records.some((r) => r.role === 'engine' && r.kind === 'tool_call' && r.name === 'roll_check')).toBe(true)
    expect(records.some((r) => r.role === 'tool' && r.name === 'roll_check' && r.ok)).toBe(true)
    expect(records.some((r) => r.role === 'engine' && r.kind === 'options')).toBe(true)

    expect(existsSync(path.join(dir, 'snapshots', '0.json'))).toBe(true)

    const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as GameState
    expect(state.turn).toBe(1)
    expect(state.lastCheck?.attribute).toBe('洞察')

    const meta = JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')) as { turn: number }
    expect(meta.turn).toBe(1)
  })

  it('move_to 更新 state.json 的位置，工具结果写进 messages.jsonl', async () => {
    setLlmRunner(
      fakeLlm([
        { tools: [{ name: 'move_to', args: { scene: 'study' } }] },
        {
          text: '书房里一股旧纸的味道。',
          tools: [{ name: 'end_turn', args: { narrative: '', options: ['翻抽屉', '回门厅'] } }],
        },
      ]),
    )

    const res = await postTurn('走进书房')
    expect(res.status).toBe(200)
    // 必须消费 SSE 流，等 runTurn 写完 state.json 再断言
    await res.text()

    const dir = path.join(root, sessionId)
    const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as GameState
    expect(state.location).toBe('study')
    expect(state.scene).toBe('旧书房')

    const records = readFileSync(path.join(dir, 'messages.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as MessageRecord)
    const moveCall = records.find((r) => r.role === 'engine' && r.kind === 'tool_call' && r.name === 'move_to')
    expect(moveCall).toMatchObject({ args: { scene: 'study' } })
  })
})
