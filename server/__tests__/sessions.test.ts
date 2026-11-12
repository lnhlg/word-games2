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
})
