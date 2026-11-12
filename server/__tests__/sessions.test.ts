import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-ws-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  process.env.PROVIDERS_FILE = path.join(root, 'providers.json')
})

afterEach(() => {
  delete process.env.PROVIDERS_FILE
  delete process.env.DEFAULT_MODEL
})

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

function post(url: string, body?: unknown) {
  return app.request(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function patch(url: string, body: unknown) {
  return app.request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function saveCard(name: string) {
  return post(`/api/characters${q(root)}`, { card: { data: { name } } })
}

type Meta = {
  id: string
  title: string
  model: string
  providerId?: string
  reasoningEffort?: string | null
  cast: string[]
  perspective: string
  turn: number
  status: string
}

describe('会话 API', () => {
  it('新建一场戏生成 session.json / AGENT.md / messages.jsonl 三个文件', async () => {
    const res = await post(`/api/sessions${q(root)}`)
    expect(res.status).toBe(201)
    const { session } = (await res.json()) as { session: Meta }
    const files = readdirSync(path.join(root, session.id))
    expect(files).toEqual(expect.arrayContaining(['AGENT.md', 'messages.jsonl', 'session.json']))
    expect(files).toHaveLength(3)
    expect(files).not.toContain('state.json')
    expect(files).not.toContain('world.yaml')
  })

  it('新建时写入标题、视角、参演角色，默认第三人称限知', async () => {
    await saveCard('沈砚')
    const res = await post(`/api/sessions${q(root)}`, { title: '雨夜', cast: ['沈砚'] })
    const { session } = (await res.json()) as { session: Meta }
    expect(session.title).toBe('雨夜')
    expect(session.cast).toEqual(['沈砚'])
    expect(session.perspective).toBe('第三人称限知')
    expect(session.status).toBe('active')
    expect(session.turn).toBe(0)
  })

  it('不传标题时给默认标题', async () => {
    const res = await post(`/api/sessions${q(root)}`)
    const { session } = (await res.json()) as { session: Meta }
    expect(session.title).toBe('未命名的一场戏')
  })

  it('参演角色里有不存在的卡时返回 400', async () => {
    const res = await post(`/api/sessions${q(root)}`, { cast: ['查无此人'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('查无此人')
  })

  it('没有工作区时拒绝建会话', async () => {
    expect((await post('/api/sessions')).status).toBe(400)
  })

  it('GET 不存在的会话返回 404', async () => {
    const res = await app.request(`/api/sessions/does-not-exist${q(root)}`)
    expect(res.status).toBe(404)
  })

  it('PATCH 改标题后列表可见', async () => {
    const created = await post(`/api/sessions${q(root)}`)
    const { session } = (await created.json()) as { session: Meta }

    const patched = await patch(`/api/sessions/${session.id}${q(root)}`, { title: '雾港新篇' })
    expect(patched.status).toBe(200)

    const listed = await app.request(`/api/sessions${q(root)}`)
    const body = (await listed.json()) as { sessions: Meta[] }
    expect(body.sessions.find((item) => item.id === session.id)?.title).toBe('雾港新篇')
  })

  it('PATCH 改视角与状态', async () => {
    const created = await post(`/api/sessions${q(root)}`)
    const { session } = (await created.json()) as { session: Meta }

    const patched = await patch(`/api/sessions/${session.id}${q(root)}`, {
      perspective: '第一人称',
      status: 'ended',
    })
    const body = (await patched.json()) as { session: Meta }
    expect(body.session.perspective).toBe('第一人称')
    expect(body.session.status).toBe('ended')
  })

  it('PATCH 空 body 返回 400，非法 reasoningEffort 返回 400', async () => {
    const created = await post(`/api/sessions${q(root)}`)
    const { session } = (await created.json()) as { session: Meta }
    expect((await patch(`/api/sessions/${session.id}${q(root)}`, {})).status).toBe(400)
    expect(
      (await patch(`/api/sessions/${session.id}${q(root)}`, { reasoningEffort: 'extreme' })).status,
    ).toBe(400)
  })

  it('旧格式会话（有 state.json）不出现在列表里，GET 也取不到', async () => {
    const legacyDir = path.join(root, 'legacy-1')
    mkdirSync(legacyDir)
    writeFileSync(
      path.join(legacyDir, 'session.json'),
      JSON.stringify({
        id: 'legacy-1',
        title: '旧的一局',
        model: 'legacy-model',
        createdAt: '',
        updatedAt: '',
        turn: 3,
        status: 'active',
      }),
      'utf8',
    )
    writeFileSync(path.join(legacyDir, 'state.json'), '{}', 'utf8')

    const listed = await app.request(`/api/sessions${q(root)}`)
    expect(((await listed.json()) as { sessions: Meta[] }).sessions).toHaveLength(0)
    expect((await app.request(`/api/sessions/legacy-1${q(root)}`)).status).toBe(404)
  })

  it('DELETE 移除整个会话文件夹', async () => {
    const created = await post(`/api/sessions${q(root)}`)
    const { session } = (await created.json()) as { session: Meta }

    expect((await app.request(`/api/sessions/${session.id}${q(root)}`, { method: 'DELETE' })).status).toBe(200)
    const listed = await app.request(`/api/sessions${q(root)}`)
    expect(((await listed.json()) as { sessions: Meta[] }).sessions).toHaveLength(0)
  })

  it('导出为 Markdown 小说：含标题、状态与导演引用', async () => {
    const created = await post(`/api/sessions${q(root)}`, { title: '雨夜' })
    const { session } = (await created.json()) as { session: Meta }
    writeFileSync(
      path.join(root, session.id, 'messages.jsonl'),
      [
        JSON.stringify({ role: 'director', turn: 0, at: '2026-11-12T00:00:00.000Z', text: '沈砚听见敲门声。' }),
        JSON.stringify({
          role: 'narrative',
          turn: 0,
          at: '2026-11-12T00:00:05.000Z',
          text: '门轴发出一声干涩的呻吟。',
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const exported = await app.request(`/api/sessions/${session.id}/export${q(root)}`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/markdown')
    const text = await exported.text()
    expect(text).toContain('# 雨夜')
    expect(text).toContain('进行中')
    expect(text).toContain('导演')
    expect(text).toContain('门轴发出一声干涩的呻吟。')
  })
})
