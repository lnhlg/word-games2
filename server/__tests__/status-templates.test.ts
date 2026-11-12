import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'

let root: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

function templateOf(name: string, items: string[]) {
  return { name, note: '', items: items.map((item) => ({ name: item, note: '' })) }
}

async function create(template: unknown, overwrite = false) {
  return app.request(`/api/status-templates${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template, overwrite }),
  })
}

async function list() {
  const res = await app.request(`/api/status-templates${q(root)}`)
  return ((await res.json()) as { templates: Array<{ id: string; name: string; itemCount: number }> })
    .templates
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-templates-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
})

afterEach(() => {
  delete process.env.DEFAULT_MODEL
})

describe('状态模板库：CRUD', () => {
  it('建一份模板落成 status-templates/<id>.json，列表能读到', async () => {
    const res = await create(templateOf('毒医验伤', ['毒性', '伤势']))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; template: { items: unknown[] } }
    expect(body.id).toBe('毒医验伤')
    expect(body.template.items).toHaveLength(2)
    expect(existsSync(path.join(root, 'status-templates', '毒医验伤.json'))).toBe(true)

    const templates = await list()
    expect(templates).toEqual([{ id: '毒医验伤', name: '毒医验伤', note: '', itemCount: 2, updatedAt: expect.any(String) }])
  })

  it('缺 name 时 400', async () => {
    expect((await create({ items: [] })).status).toBe(400)
    expect((await create({ name: '   ' })).status).toBe(400)
  })

  it('同名再建 409，overwrite 才覆盖', async () => {
    await create(templateOf('毒医验伤', ['毒性']))
    expect((await create(templateOf('毒医验伤', ['好感度']))).status).toBe(409)
    expect((await create(templateOf('毒医验伤', ['好感度']), true)).status).toBe(201)
    const templates = await list()
    expect(templates[0].itemCount).toBe(1)
  })

  it('更新只改内容，文件名不变', async () => {
    const created = (await (await create(templateOf('毒医验伤', ['毒性']))).json()) as { id: string }
    const res = await app.request(`/api/status-templates/${encodeURIComponent(created.id)}${q(root)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template: {
          name: '毒医验伤（改）',
          items: ['毒性', '伤势'].map((item) => ({ name: item, note: '' })),
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; template: { name: string; items: unknown[] } }
    expect(body.id).toBe('毒医验伤')
    expect(body.template.name).toBe('毒医验伤（改）')
    expect(body.template.items).toHaveLength(2)
  })

  it('每份模板最多 8 项', async () => {
    const many = Array.from({ length: 11 }, (_, index) => `项${index}`)
    await create(templateOf('超长', many))
    expect((await list())[0].itemCount).toBe(8)
  })

  it('删掉之后列表为空，再删 404', async () => {
    await create(templateOf('毒医验伤', ['毒性']))
    const id = encodeURIComponent('毒医验伤')
    expect((await app.request(`/api/status-templates/${id}${q(root)}`, { method: 'DELETE' })).status).toBe(200)
    expect(await list()).toEqual([])
    expect((await app.request(`/api/status-templates/${id}${q(root)}`, { method: 'DELETE' })).status).toBe(404)
  })
})
