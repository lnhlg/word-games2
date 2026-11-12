import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner } from '../lib/llm'
import { setOptionsRunner } from '../lib/options'
import { readMessages, readMeta, sessionDir } from '../lib/session-fs'
import { runTurn } from '../lib/turn'

let root: string
let sessionId: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-turn-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  process.env.PROVIDERS_FILE = path.join(root, 'providers.json')
  const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
  sessionId = ((await created.json()) as { session: { id: string } }).session.id
  // 选项生成会再调一次 LLM；这些用例只关心正文，默认关掉。
  setOptionsRunner(async () => [])
})

afterEach(() => {
  setLlmRunner(null)
  setOptionsRunner(null)
  delete process.env.PROVIDERS_FILE
  delete process.env.DEFAULT_MODEL
})

/** 可编程假 LLM：每次调用消费脚本里的一步。 */
function fakeLlm(script: Array<{ text?: string; fail?: string }>) {
  let step = 0
  return async function* () {
    const current = script[step] ?? { text: '（脚本结束）' }
    step += 1
    if (current.text) yield { type: 'delta' as const, text: current.text }
    if (current.fail) throw new Error(current.fail)
    yield { type: 'done' as const, finishReason: 'stop' }
  }
}

function parseSse(text: string): Array<{ type: string; [key: string]: unknown }> {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.replace(/^data:\s*/, '')) as { type: string })
}

async function postTurn(input: string, retry = false) {
  return app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(retry ? { input, retry: true } : { input }),
  })
}

describe('POST /turns：假 LLM 驱动', () => {
  it('一条大纲 → 一次调用 → 一段情节，事件与落盘都对', async () => {
    setLlmRunner(fakeLlm([{ text: '门轴发出一声干涩的呻吟。' }]))
    const res = await postTurn('有人敲门。')
    expect(res.status).toBe(200)

    const events = parseSse(await res.text())
    expect(events.map((event) => event.type)).toEqual(['turn_start', 'delta', 'done'])
    expect(events[0].turn).toBe(0)
    expect(events[1].text).toBe('门轴发出一声干涩的呻吟。')
    expect(events[2].turn).toBe(1)

    const dir = sessionDir(root, sessionId)
    const messages = readMessages(dir)
    expect(messages[0]).toMatchObject({ role: 'director', turn: 0, text: '有人敲门。' })
    expect(messages[1]).toMatchObject({ role: 'narrative', turn: 0, text: '门轴发出一声干涩的呻吟。' })
    expect(readMeta(dir).turn).toBe(1)
  })

  it('模型报错时落一条 system error，回合号不变', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }]))
    const res = await postTurn('有人敲门。')
    const events = parseSse(await res.text())
    expect(events.some((event) => event.type === 'error')).toBe(true)

    const dir = sessionDir(root, sessionId)
    const messages = readMessages(dir)
    expect(messages.at(-1)).toMatchObject({ role: 'system', kind: 'error', text: '上游 500' })
    expect(readMeta(dir).turn).toBe(0)
  })

  it('retry 复用已落盘的导演消息，不再追加一条', async () => {
    setLlmRunner(fakeLlm([{ text: '第一次写成。' }, { text: '第二次写成。' }]))
    await (await postTurn('有人敲门。')).text()
    await (await postTurn('有人敲门。', true)).text()

    const dir = sessionDir(root, sessionId)
    const messages = readMessages(dir)
    const directors = messages.filter((message) => message.role === 'director')
    const narratives = messages.filter((message) => message.role === 'narrative')
    expect(directors).toHaveLength(1)
    expect(narratives).toHaveLength(2)
    expect(readMeta(dir).turn).toBe(2)
  })

  it('空大纲返回 400', async () => {
    setLlmRunner(fakeLlm([{ text: '不该被调用' }]))
    expect((await postTurn('   ')).status).toBe(400)
  })

  it('中断时保留半截情节并标记 interrupted', async () => {
    const dir = sessionDir(root, sessionId)
    const meta = readMeta(dir)
    const controller = new AbortController()
    setLlmRunner(async function* () {
      yield { type: 'delta' as const, text: '门轴发出一声' }
      controller.abort()
      yield { type: 'done' as const }
    })

    await runTurn({
      dir,
      meta,
      agentMd: '',
      cast: [],
      memories: [],
      history: [],
      outline: '有人敲门。',
      signal: controller.signal,
      emit: () => {},
    })

    const messages = readMessages(dir)
    expect(messages.at(-1)).toMatchObject({
      role: 'narrative',
      turn: 0,
      interrupted: true,
      text: '门轴发出一声',
    })
    expect(readMeta(dir).turn).toBe(1)
  })
})
