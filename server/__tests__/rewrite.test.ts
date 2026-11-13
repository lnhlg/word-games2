import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner, type LlmParams } from '../lib/llm'
import { memoryFile } from '../lib/memory'
import { setOptionsRunner } from '../lib/options'
import { readMessages, readMeta, sessionDir } from '../lib/session-fs'
import { runTurn } from '../lib/turn'

let root: string
let sessionId: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

function fakeLlm(script: Array<{ text?: string; fail?: string }>, seen?: LlmParams[]) {
  let step = 0
  return async function* (params: LlmParams) {
    seen?.push(params)
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

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-rewrite-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  process.env.PROVIDERS_FILE = path.join(root, 'providers.json')
  const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
  sessionId = ((await created.json()) as { session: { id: string } }).session.id
  setOptionsRunner(async () => [])
})

afterEach(() => {
  setLlmRunner(null)
  setOptionsRunner(null)
  delete process.env.PROVIDERS_FILE
  delete process.env.DEFAULT_MODEL
})

const dirOf = () => sessionDir(root, sessionId)

async function postTurn(input: string) {
  return app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  })
}

async function patchTurn(turn: number, text: string) {
  return app.request(`/api/sessions/${sessionId}/turns/${turn}${q(root)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

async function deleteTurn(turn: number) {
  return app.request(`/api/sessions/${sessionId}/turns/${turn}${q(root)}`, { method: 'DELETE' })
}

async function regenerate(instruction?: string) {
  return app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: instruction === undefined ? undefined : JSON.stringify({ instruction }),
  })
}

describe('回合管理：删除 / 编辑 / 重新生成', () => {
  it('删除最后一回合：删掉导演与情节，回合号回退', async () => {
    setLlmRunner(fakeLlm([{ text: '第一段。' }, { text: '第二段。' }]))
    await (await postTurn('第一幕')).text()
    await (await postTurn('第二幕')).text()
    expect(readMeta(dirOf()).turn).toBe(2)

    const res = await deleteTurn(1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { meta: { turn: number } }
    expect(body.meta.turn).toBe(1)

    const messages = readMessages(dirOf())
    expect(messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, turn: m.turn }))).toEqual([
      { role: 'director', turn: 0 },
      { role: 'narrative', turn: 0 },
    ])
  })

  it('只允许删除最后一回合', async () => {
    setLlmRunner(fakeLlm([{ text: '第一段。' }, { text: '第二段。' }]))
    await (await postTurn('第一幕')).text()
    await (await postTurn('第二幕')).text()

    expect((await deleteTurn(0)).status).toBe(400)
    expect(readMeta(dirOf()).turn).toBe(2)
    expect(readMessages(dirOf())).toHaveLength(4)
  })

  it('编辑改写原文、标 edited 并作废该回合选项', async () => {
    setOptionsRunner(async () => ['追出去', '按兵不动', '点灯'])
    setLlmRunner(fakeLlm([{ text: '原稿。' }]))
    await (await postTurn('开场')).text()

    const res = await patchTurn(0, '改过的稿子。')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      memoryStale: boolean
      messages: Array<{ role: string; text?: string; edited?: boolean; nextOptions?: string[] }>
    }
    expect(body.memoryStale).toBe(false)
    const narrative = body.messages.find((message) => message.role === 'narrative')
    expect(narrative).toMatchObject({ text: '改过的稿子。', edited: true })
    expect(narrative?.nextOptions).toBeUndefined()
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('编辑已压进摘要的回合带 memoryStale 提示', async () => {
    setLlmRunner(fakeLlm([{ text: '原稿。' }]))
    await (await postTurn('开场')).text()
    writeFileSync(
      memoryFile(dirOf()),
      JSON.stringify({
        id: 'm0',
        turns: [0, 0],
        summary: '有人敲门。',
        keywords: [],
        entities: [],
        createdAt: new Date().toISOString(),
      }) + '\n',
      'utf8',
    )

    const res = await patchTurn(0, '改过的稿子。')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { memoryStale: boolean }).memoryStale).toBe(true)
  })

  it('重新生成：复用同一大纲，覆盖旧稿，回合号不变', async () => {
    setOptionsRunner(async () => ['新方向一', '新方向二'])
    setLlmRunner(fakeLlm([{ text: '旧稿。' }, { text: '新稿。' }]))
    await (await postTurn('开场')).text()

    const res = await app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, { method: 'POST' })
    expect(res.status).toBe(200)
    const events = parseSse(await res.text())
    expect(events.map((event) => event.type)).toEqual(['turn_start', 'delta', 'done', 'next_options'])
    expect(events.find((event) => event.type === 'next_options')?.options).toEqual(['新方向一', '新方向二'])

    const messages = readMessages(dirOf())
    const narratives = messages.filter((message) => message.role === 'narrative')
    expect(narratives).toHaveLength(1)
    expect(narratives[0]).toMatchObject({
      turn: 0,
      text: '新稿。',
      nextOptions: ['新方向一', '新方向二'],
    })
    expect(messages.filter((message) => message.role === 'director')).toHaveLength(1)
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('重新生成带一句要求：要求进 prompt，并落进情节记录', async () => {
    const seen: LlmParams[] = []
    setLlmRunner(fakeLlm([{ text: '旧稿。' }, { text: '新稿。' }], seen))
    await (await postTurn('开场')).text()

    const res = await regenerate('写得更紧张些，少解释、多动作。')
    expect(res.status).toBe(200)
    expect(parseSse(await res.text()).map((event) => event.type)).toEqual(['turn_start', 'delta', 'done'])

    const request = seen.at(-1)
    const user = request?.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(user).toContain('【重写要求】')
    expect(user).toContain('写得更紧张些，少解释、多动作。')
    // 重写要求排在本回合大纲之后，是模型最后看到的一段。
    expect(user.indexOf('【重写要求】')).toBeGreaterThan(user.indexOf('【本回合大纲】'))

    expect(readMessages(dirOf()).find((message) => message.role === 'narrative')).toMatchObject({
      turn: 0,
      text: '新稿。',
      instruction: '写得更紧张些，少解释、多动作。',
    })
  })

  it('不带要求重写：prompt 里没有要求段，记录里也不留字段', async () => {
    const seen: LlmParams[] = []
    setLlmRunner(fakeLlm([{ text: '旧稿。' }, { text: '新稿。' }], seen))
    await (await postTurn('开场')).text()

    const res = await regenerate()
    expect(res.status).toBe(200)
    await res.text()

    const user = seen.at(-1)?.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(user).not.toContain('【重写要求】')
    expect(readMessages(dirOf()).find((message) => message.role === 'narrative')).not.toHaveProperty(
      'instruction',
    )
  })

  it('重写要求过长返回 400，旧稿留在原地', async () => {
    setLlmRunner(fakeLlm([{ text: '旧稿。' }]))
    await (await postTurn('开场')).text()

    const res = await regenerate('很'.repeat(501))
    expect(res.status).toBe(400)
    expect(readMessages(dirOf()).find((message) => message.role === 'narrative')).toMatchObject({
      turn: 0,
      text: '旧稿。',
    })
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('重新生成失败时不写 instruction，失败的那条大纲仍可再试', async () => {
    setLlmRunner(fakeLlm([{ text: '旧稿。' }, { fail: '上游 500' }]))
    await (await postTurn('开场')).text()

    const res = await regenerate('再来一次')
    expect(res.status).toBe(200)
    await res.text()

    const narratives = readMessages(dirOf()).filter((message) => message.role === 'narrative')
    expect(narratives).toHaveLength(0)
    // 回合号本来就已经前进过，失败的重写不该再动它。
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('还没有回合时不能重新生成', async () => {
    setLlmRunner(fakeLlm([{ text: '不该被调用' }]))
    const res = await app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('正文写完后把后续选项落盘并推给客户端', async () => {
    setOptionsRunner(async () => ['追出去', '按兵不动', '点灯'])
    setLlmRunner(fakeLlm([{ text: '门开了。' }]))

    const events = parseSse(await (await postTurn('有人敲门。')).text())
    expect(events.map((event) => event.type)).toEqual(['turn_start', 'delta', 'done', 'next_options'])

    const narrative = readMessages(dirOf()).find((message) => message.role === 'narrative')
    expect(narrative).toMatchObject({ nextOptions: ['追出去', '按兵不动', '点灯'] })
  })

  it('生成失败后，失败的那条大纲可以重新生成', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }, { text: '补出来的正文。' }]))
    await (await postTurn('开场')).text()
    // 失败时不占回合号，只留下大纲。
    expect(readMeta(dirOf()).turn).toBe(0)

    const res = await app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(parseSse(await res.text()).map((event) => event.type)).toEqual(['turn_start', 'delta', 'done'])

    const messages = readMessages(dirOf())
    expect(
      messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, turn: message.turn, text: message.text })),
    ).toEqual([
      { role: 'director', turn: 0, text: '开场' },
      { role: 'narrative', turn: 0, text: '补出来的正文。' },
    ])
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('生成失败后，失败的那条大纲可以删除，回合号不后退', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }]))
    await (await postTurn('开场')).text()

    const res = await deleteTurn(0)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { meta: { turn: number } }).meta.turn).toBe(0)
    expect(readMessages(dirOf()).filter((message) => message.role !== 'system')).toHaveLength(0)
  })

  it('第二回合失败后，重新生成写回第二回合，不动第一回合', async () => {
    setLlmRunner(fakeLlm([{ text: '第一段。' }, { fail: '上游 500' }, { text: '第二段。' }]))
    await (await postTurn('第一幕')).text()
    await (await postTurn('第二幕')).text()
    expect(readMeta(dirOf()).turn).toBe(1)

    const res = await app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(parseSse(await res.text()).map((event) => event.type)).toEqual(['turn_start', 'delta', 'done'])

    const messages = readMessages(dirOf())
    expect(
      messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, turn: message.turn, text: message.text })),
    ).toEqual([
      { role: 'director', turn: 0, text: '第一幕' },
      { role: 'narrative', turn: 0, text: '第一段。' },
      { role: 'director', turn: 1, text: '第二幕' },
      { role: 'narrative', turn: 1, text: '第二段。' },
    ])
    expect(readMeta(dirOf()).turn).toBe(2)
  })

  it('第二回合失败后删掉那条大纲，第一回合不受影响', async () => {
    setLlmRunner(fakeLlm([{ text: '第一段。' }, { fail: '上游 500' }]))
    await (await postTurn('第一幕')).text()
    await (await postTurn('第二幕')).text()
    expect(readMeta(dirOf()).turn).toBe(1)

    expect((await deleteTurn(0)).status).toBe(400)
    expect((await deleteTurn(1)).status).toBe(200)
    expect(readMeta(dirOf()).turn).toBe(1)

    const messages = readMessages(dirOf()).filter((message) => message.role !== 'system')
    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({ role: 'narrative', turn: 0, text: '第一段。' })
  })

  it('失败后改发另一条大纲：顶替旧大纲，不留两条同号大纲', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }, { text: '第二版。' }]))
    await (await postTurn('第一版大纲')).text()
    await (await postTurn('第二版大纲')).text()

    const messages = readMessages(dirOf())
    const directors = messages.filter((message) => message.role === 'director')
    expect(directors).toHaveLength(1)
    expect(directors[0]).toMatchObject({ turn: 0, text: '第二版大纲' })
    expect(messages.find((message) => message.role === 'narrative')).toMatchObject({
      turn: 0,
      text: '第二版。',
    })
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('失败后按同一大纲重试：复用那条大纲，不再追加', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }, { text: '这次成了。' }]))
    await (await postTurn('有人敲门。')).text()
    await (
      await app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: '有人敲门。', retry: true }),
      })
    ).text()

    const messages = readMessages(dirOf())
    expect(messages.filter((message) => message.role === 'director')).toHaveLength(1)
    expect(messages.find((message) => message.role === 'narrative')).toMatchObject({ turn: 0 })
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('重新生成又失败时，大纲仍在，可以再重生成或删除', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }, { fail: '上游 503' }]))
    await (await postTurn('开场')).text()

    const res = await app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(parseSse(await res.text()).some((event) => event.type === 'error')).toBe(true)

    const directors = readMessages(dirOf()).filter((message) => message.role === 'director')
    expect(directors).toHaveLength(1)
    expect(readMeta(dirOf()).turn).toBe(0)

    expect((await deleteTurn(0)).status).toBe(200)
    expect(readMeta(dirOf()).turn).toBe(0)
  })

  it('中断时一个字都没收到，那一回合也能删除，回合号回退', async () => {
    const dir = dirOf()
    const controller = new AbortController()
    setLlmRunner(async function* () {
      controller.abort()
      yield { type: 'delta' as const, text: '半截' }
      yield { type: 'done' as const }
    })
    await runTurn({
      dir,
      meta: readMeta(dir),
      agentMd: '',
      cast: [],
      memories: [],
      history: [],
      outline: '有人敲门。',
      signal: controller.signal,
      emit: () => {},
    })
    // 中断占掉一个回合号，但没有正文落盘。
    expect(readMeta(dir).turn).toBe(1)

    expect((await deleteTurn(0)).status).toBe(200)
    expect(readMeta(dir).turn).toBe(0)
    expect(readMessages(dir).filter((message) => message.role !== 'system')).toHaveLength(0)
  })
})
