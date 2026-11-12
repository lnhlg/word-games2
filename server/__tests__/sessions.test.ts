import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../app'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-test-'))
  process.env.SESSIONS_DIR = root
})

describe('sessions API', () => {
  it('POST /api/sessions 建会话，GET 能看到它', async () => {
    const created = await app.request('/api/sessions', { method: 'POST' })
    expect(created.status).toBe(201)

    const body = (await created.json()) as { session: { id: string } }
    expect(body.session.id).toBeTruthy()

    const listed = await app.request('/api/sessions')
    expect(listed.status).toBe(200)

    const listBody = (await listed.json()) as { sessions: { id: string }[] }
    expect(listBody.sessions.map((s) => s.id)).toContain(body.session.id)
  })

  it('新建会话在磁盘上生成自包含文件夹', async () => {
    const created = await app.request('/api/sessions', { method: 'POST' })
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

  it('GET 不存在的会话返回 404', async () => {
    const res = await app.request('/api/sessions/does-not-exist')
    expect(res.status).toBe(404)
  })
})
