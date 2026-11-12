import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner } from '../lib/llm'
import {
  readMessages,
  readMeta,
  readState,
  sessionDir,
  type GameState,
  type MessageRecord,
} from '../lib/session-fs'
import { loadWorld } from '../lib/world'
import { runTurn } from '../lib/turn'

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

  it('rollback 恢复到快照、消息流截断，messages.jsonl 不回写', async () => {
    setLlmRunner(
      fakeLlm([
        { text: '第一回合的叙事。', tools: [{ name: 'end_turn', args: { narrative: '', options: ['甲', '乙'] } }] },
        { text: '第二回合的叙事。', tools: [{ name: 'end_turn', args: { narrative: '', options: ['丙', '丁'] } }] },
      ]),
    )

    await (await postTurn('第一句')).text()
    await (await postTurn('第二句')).text()

    const dir = path.join(root, sessionId)
    const file = path.join(dir, 'messages.jsonl')
    const before = readFileSync(file, 'utf8').trim().split('\n')
    expect(before.some((line) => line.includes('第二句'))).toBe(true)

    const snapshot = JSON.parse(readFileSync(path.join(dir, 'snapshots', '0.json'), 'utf8')) as GameState
    expect(snapshot.turn).toBe(0)

    const res = await app.request(`/api/sessions/${sessionId}/rollback${q(root)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turn: 0 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { meta: { turn: number }; state: GameState; messages: MessageRecord[] }

    expect(body.meta.turn).toBe(1)
    expect(body.state.turn).toBe(1)
    expect(body.state.location).toBe(snapshot.location)
    expect(body.messages.some((m) => m.role === 'player' && m.text === '第二句')).toBe(false)
    expect(body.messages.some((m) => m.role === 'engine' && m.kind === 'text' && m.text.includes('第二回合'))).toBe(false)
    expect(body.messages.some((m) => m.role === 'player' && m.text === '第一句')).toBe(true)

    const after = readFileSync(file, 'utf8').trim().split('\n')
    expect(after.length).toBe(before.length)

    const stateOnDisk = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')) as GameState
    expect(stateOnDisk.turn).toBe(1)
  })

  it('rollback 到不存在的快照返回 404', async () => {
    const res = await app.request(`/api/sessions/${sessionId}/rollback${q(root)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turn: 9 }),
    })
    expect(res.status).toBe(404)
  })

  it('中断：已生成的半截叙事落盘，回合数不前进，留下中断标记', async () => {
    const dir = sessionDir(root, sessionId)
    setLlmRunner(async function* () {
      yield { type: 'delta' as const, text: '门轴发出一声干涩' }
      await new Promise((resolve) => setTimeout(resolve, 50))
      yield { type: 'delta' as const, text: '的呻吟。' }
      yield { type: 'done' as const, finishReason: 'stop' }
    })

    const controller = new AbortController()
    const running = runTurn({
      dir,
      meta: readMeta(dir),
      world: loadWorld(dir),
      state: readState(dir),
      agentMd: '',
      summary: '',
      history: [],
      playerInput: '推门',
      signal: controller.signal,
      emit: () => {},
    })
    setTimeout(() => controller.abort(), 10)
    await running

    const records = readMessages(dir)
    expect(records.some((r) => r.role === 'engine' && r.kind === 'text' && r.text.includes('门轴发出一声干涩'))).toBe(true)
    expect(records.some((r) => r.role === 'engine' && r.kind === 'text' && r.text.includes('的呻吟'))).toBe(false)
    expect(records.some((r) => r.role === 'system' && r.text.includes('已中断'))).toBe(true)
    expect(readMeta(dir).turn).toBe(0)
    expect(readState(dir).turn).toBe(0)
  })

  it('模型失败：写 system/error 条目，回合数不前进', async () => {
    const dir = sessionDir(root, sessionId)
    setLlmRunner(async function* () {
      throw new Error('模型炸了')
    })

    await runTurn({
      dir,
      meta: readMeta(dir),
      world: loadWorld(dir),
      state: readState(dir),
      agentMd: '',
      summary: '',
      history: [],
      playerInput: '推门',
      emit: () => {},
    })

    const records = readMessages(dir)
    expect(records.some((r) => r.role === 'system' && r.text.includes('模型炸了'))).toBe(true)
    expect(readMeta(dir).turn).toBe(0)
  })

  it('改模型后下一回合的 prompt 用对应的 <model>.md', async () => {
    const dir = sessionDir(root, sessionId)
    writeFileSync(path.join(dir, 'fake-model.md'), '【专用设定】只按这个设定叙事。', 'utf8')

    const patched = await app.request(`/api/sessions/${sessionId}${q(root)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model' }),
    })
    expect(patched.status).toBe(200)

    let systemText = ''
    setLlmRunner(async function* (params) {
      systemText = params.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n')
      yield { type: 'delta' as const, text: '嗯。' }
      yield {
        type: 'tool_call' as const,
        toolCall: {
          id: 'call_end',
          name: 'end_turn',
          args: JSON.stringify({ narrative: '', options: ['继续', '后退'] }),
        },
      }
      yield { type: 'done' as const, finishReason: 'stop' }
    })

    const res = await postTurn('往前走')
    await res.text()
    expect(systemText).toContain('【专用设定】')
  })
})
