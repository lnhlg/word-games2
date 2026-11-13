import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner, type LlmParams } from '../lib/llm'
import { setOptionsRunner } from '../lib/options'
import { readMeta, sessionDir } from '../lib/session-fs'

let root: string
let sessionId: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-cast-'))
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

async function saveCard(name: string): Promise<string> {
  const res = await app.request(`/api/characters${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ card: { data: { name } } }),
  })
  return ((await res.json()) as { id: string }).id
}

function addCast(body: unknown) {
  return app.request(`/api/sessions/${sessionId}/cast${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const metaOf = () => readMeta(sessionDir(root, sessionId))

describe('会话中追加参演角色', () => {
  it('加一张卡：写进 session.json，重复加不会重复', async () => {
    const shen = await saveCard('沈砚')

    const first = await addCast({ cardId: shen })
    expect(first.status).toBe(200)
    expect(((await first.json()) as { session: { cast: string[] } }).session.cast).toEqual([shen])

    const again = await addCast({ cardId: shen })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { session: { cast: string[] } }).session.cast).toEqual([shen])
    expect(metaOf().cast).toEqual([shen])
  })

  it('加第二张卡时排在已有角色后面', async () => {
    const shen = await saveCard('沈砚')
    const aruo = await saveCard('阿箬')
    await (await addCast({ cardId: shen })).text()
    await (await addCast({ cardId: aruo })).text()
    expect(metaOf().cast).toEqual([shen, aruo])
  })

  it('卡不存在返回 400，演员表不变', async () => {
    const res = await addCast({ cardId: '查无此人' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('查无此人')
    expect(metaOf().cast).toEqual([])
  })

  it('缺 cardId 返回 400', async () => {
    expect((await addCast({})).status).toBe(400)
    expect((await addCast({ cardId: '   ' })).status).toBe(400)
  })

  it('会话不存在返回 404', async () => {
    const res = await app.request(`/api/sessions/does-not-exist/cast${q(root)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId: '沈砚' }),
    })
    expect(res.status).toBe(404)
  })

  it('下一回合的演员表里出现新加入的角色', async () => {
    const seen: LlmParams[] = []
    setLlmRunner(async function* (params: LlmParams) {
      seen.push(params)
      yield { type: 'delta' as const, text: '沈砚抬眼。' }
      yield { type: 'done' as const, finishReason: 'stop' }
    })
    const shen = await saveCard('沈砚')
    await (await addCast({ cardId: shen })).text()

    await (
      await app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: '沈砚抬眼。' }),
      })
    ).text()

    const system = seen.at(-1)?.messages.find((message) => message.role === 'system')?.content ?? ''
    expect(system).toContain('【演员表】')
    expect(system).toContain('## 沈砚')
  })
})
