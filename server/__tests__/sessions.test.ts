import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../app'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-ws-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
})

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

describe('workspaces + sessions API', () => {
  it('先打开工作区，再在其中建会话并列出', async () => {
    const opened = await app.request('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: root }),
    })
    expect(opened.status).toBe(200)
    const openedBody = (await opened.json()) as { current: string }
    expect(openedBody.current).toBe(root)

    const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { session: { id: string } }
    expect(body.session.id).toBeTruthy()

    const listed = await app.request(`/api/sessions${q(root)}`)
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as { sessions: { id: string }[] }
    expect(listBody.sessions.map((s) => s.id)).toContain(body.session.id)
  })

  it('新建会话直接落在工作区目录下，生成自包含文件夹', async () => {
    const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
    const body = (await created.json()) as { session: { id: string } }

    const files = readdirSync(path.join(root, body.session.id))
    expect(files).toHaveLength(6)
    expect(files).toEqual(
      expect.arrayContaining([
        'AGENT.md',
        'messages.jsonl',
        'session.json',
        'snapshots',
        'state.json',
        'world.yaml',
      ]),
    )
  })

  it('没有工作区时拒绝建会话', async () => {
    const res = await app.request('/api/sessions', { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('GET 不存在的会话返回 404', async () => {
    const res = await app.request(`/api/sessions/does-not-exist${q(root)}`)
    expect(res.status).toBe(404)
  })

  it('PATCH 改标题后列表可见', async () => {
    const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
    const { session } = (await created.json()) as { session: { id: string } }

    const patched = await app.request(`/api/sessions/${session.id}${q(root)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '雾港新篇' }),
    })
    expect(patched.status).toBe(200)

    const listed = await app.request(`/api/sessions${q(root)}`)
    const body = (await listed.json()) as { sessions: { id: string; title: string }[] }
    expect(body.sessions.find((s) => s.id === session.id)?.title).toBe('雾港新篇')
  })

  it('PATCH 改模型后列表与详情都更新', async () => {
    const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
    const { session } = (await created.json()) as { session: { id: string; model: string } }
    const original = session.model

    const patched = await app.request(`/api/sessions/${session.id}${q(root)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'another-model' }),
    })
    expect(patched.status).toBe(200)
    const patchedBody = (await patched.json()) as { session: { model: string } }
    expect(patchedBody.session.model).toBe('another-model')

    const detail = await app.request(`/api/sessions/${session.id}${q(root)}`)
    const detailBody = (await detail.json()) as { meta: { model: string } }
    expect(detailBody.meta.model).toBe('another-model')
    expect(original).not.toBe('another-model')
  })

  it('DELETE 移除整个会话文件夹', async () => {
    const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
    const { session } = (await created.json()) as { session: { id: string } }

    const removed = await app.request(`/api/sessions/${session.id}${q(root)}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)

    const listed = await app.request(`/api/sessions${q(root)}`)
    const body = (await listed.json()) as { sessions: { id: string }[] }
    expect(body.sessions).toHaveLength(0)
  })

  it('导出 Markdown 含标题与状态', async () => {
    const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
    const { session } = (await created.json()) as { session: { id: string; title: string } }

    const exported = await app.request(`/api/sessions/${session.id}/export${q(root)}`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/markdown')
    const text = await exported.text()
    expect(text).toContain(session.title)
  })
})
