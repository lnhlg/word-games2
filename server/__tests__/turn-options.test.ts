import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner, type LlmParams } from '../lib/llm'
import { setOptionsRunner } from '../lib/options'
import { readMessages, readMeta, sessionDir } from '../lib/session-fs'
import { readStatusRecords } from '../lib/status'

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

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-options-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  process.env.PROVIDERS_FILE = path.join(root, 'providers.json')
  const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
  sessionId = ((await created.json()) as { session: { id: string } }).session.id
  // 默认关掉自动 extras，正文用例不会多调一次 LLM。
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

function postOptions(turn: number, body?: unknown) {
  return app.request(`/api/sessions/${sessionId}/turns/${turn}/options${q(root)}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('单独生成后续剧情选项', () => {
  it('覆盖该回合的 nextOptions，不写正文、不动状态', async () => {
    setLlmRunner(fakeLlm([{ text: '门开了。' }]))
    await (await postTurn('有人敲门。')).text()

    setOptionsRunner(async () => ['追出去', '按兵不动', '点灯'])
    const res = await postOptions(0)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      options: string[]
      messages: Array<{ role: string; turn?: number; text?: string; nextOptions?: string[] }>
    }
    expect(body.options).toEqual(['追出去', '按兵不动', '点灯'])
    expect(body.messages.find((message) => message.role === 'narrative')).toMatchObject({
      turn: 0,
      text: '门开了。',
      nextOptions: ['追出去', '按兵不动', '点灯'],
    })

    const narrative = readMessages(dirOf()).find((message) => message.role === 'narrative')
    expect(narrative).toMatchObject({ text: '门开了。', nextOptions: ['追出去', '按兵不动', '点灯'] })
    // 只换选项，不产生状态变更记录。
    expect(readStatusRecords(dirOf())).toHaveLength(0)
    expect(readMeta(dirOf()).turn).toBe(1)
  })

  it('只接受最后一回合', async () => {
    setLlmRunner(fakeLlm([{ text: '第一段。' }, { text: '第二段。' }]))
    await (await postTurn('第一幕')).text()
    await (await postTurn('第二幕')).text()

    setOptionsRunner(async () => ['接着追', '转身走', '留在原地'])
    expect((await postOptions(0)).status).toBe(400)
    expect((await postOptions(1)).status).toBe(200)
  })

  it('这一回合只有大纲、没有情节时返回 400', async () => {
    setLlmRunner(fakeLlm([{ fail: '上游 500' }]))
    await (await postTurn('开场')).text()
    expect(readMeta(dirOf()).turn).toBe(0)

    expect((await postOptions(0)).status).toBe(400)
  })

  it('模型没给出选项时返回 502，不覆盖已有选项', async () => {
    setLlmRunner(fakeLlm([{ text: '门开了。' }]))
    await (await postTurn('有人敲门。')).text()

    setOptionsRunner(async () => ['旧的一', '旧的二'])
    await (await postOptions(0)).text()

    setOptionsRunner(async () => [])
    expect((await postOptions(0)).status).toBe(502)
    expect(readMessages(dirOf()).find((message) => message.role === 'narrative')).toMatchObject({
      nextOptions: ['旧的一', '旧的二'],
    })
  })

  it('prompt 接住最后一回合的结尾，并带上上一批选项', async () => {
    const seen: LlmParams[] = []
    setLlmRunner(
      fakeLlm(
        [
          { text: '门开了。' },
          { text: '{"options":["追出去","锁上门","问她从哪来"]}' },
          { text: '{"options":["后退一步","抓住门框","叫她的名字"]}' },
        ],
        seen,
      ),
    )
    await (await postTurn('有人敲门。')).text()

    // 让单独生成走真实 LLM 路径，才能看到组装的 prompt。
    setOptionsRunner(null)

    const first = await postOptions(0)
    expect(first.status).toBe(200)
    await first.text()

    const firstUser = seen[1]?.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(firstUser).toContain('【最后一回合的大纲】\n有人敲门。')
    expect(firstUser).toContain('【最后一回合的情节（结尾）】')
    expect(firstUser).toContain('门开了。')
    expect(firstUser).not.toContain('【导演的想法】')
    expect(firstUser).not.toContain('【上一批选项')

    const second = await postOptions(0)
    expect(second.status).toBe(200)
    await second.text()

    const secondUser = seen[2]?.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(secondUser).toContain('【上一批选项（已经给过导演，这次换不同的方向）】')
    expect(secondUser).toContain('追出去')
  })

  it('可以带一句想法，控制这一批选项的方向', async () => {
    const seen: LlmParams[] = []
    setLlmRunner(
      fakeLlm(
        [
          { text: '门开了。' },
          { text: '{"options":["阿箬盯着门缝","阿箬后退半步","阿箬开口问"]}' },
        ],
        seen,
      ),
    )
    await (await postTurn('有人敲门。')).text()
    // 让手动生成走真实 LLM 路径，才能看到组装的 prompt。
    setOptionsRunner(null)

    const res = await postOptions(0, { idea: '让阿箬主动试探沈砚' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { options: string[] }
    expect(body.options).toEqual(['阿箬盯着门缝', '阿箬后退半步', '阿箬开口问'])

    const user = seen[1]?.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(user).toContain('【导演的想法】\n让阿箬主动试探沈砚')
    // 想法排在情节结尾之后，模型先读到结尾，再读到导演要去哪儿。
    expect(user.indexOf('【导演的想法】')).toBeGreaterThan(
      user.indexOf('【最后一回合的情节（结尾）】'),
    )
  })

  it('想法太长返回 400，旧选项不动', async () => {
    setLlmRunner(fakeLlm([{ text: '门开了。' }]))
    await (await postTurn('有人敲门。')).text()

    setOptionsRunner(async () => ['旧的一', '旧的二'])
    await (await postOptions(0)).text()

    expect((await postOptions(0, { idea: '很'.repeat(301) })).status).toBe(400)
    expect(readMessages(dirOf()).find((message) => message.role === 'narrative')).toMatchObject({
      nextOptions: ['旧的一', '旧的二'],
    })
  })

  it('模型第一次只回了文字、没给 JSON 时会再试一次', async () => {
    const seen: LlmParams[] = []
    setLlmRunner(
      fakeLlm(
        [
          { text: '门开了。' },
          { text: '好的，我想想接下来可以怎么演：' },
          { text: '{"options":["追出去","锁上门","问她从哪来"]}' },
        ],
        seen,
      ),
    )
    await (await postTurn('有人敲门。')).text()
    setOptionsRunner(null)

    const res = await postOptions(0)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { options: string[] }).options).toEqual([
      '追出去',
      '锁上门',
      '问她从哪来',
    ])
    expect(seen).toHaveLength(3)
  })

  it('两次都没给出可用选项时返回 502', async () => {
    setLlmRunner(
      fakeLlm([
        { text: '门开了。' },
        { text: '好的，我想想接下来可以怎么演：' },
        { text: '抱歉，我这边出错了。' },
      ]),
    )
    await (await postTurn('有人敲门。')).text()
    setOptionsRunner(null)

    expect((await postOptions(0)).status).toBe(502)
  })
})
