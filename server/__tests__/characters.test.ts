import { mkdtempSync, readFileSync } from 'node:fs'
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

const cardPath = (id: string) => `/api/characters/${encodeURIComponent(id)}${q(root)}`

const sampleCard = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '沈砚',
    description: '旧书店老板，读过很多书，话不多。',
    personality: '嘴硬心软',
    tags: ['民国', '克制'],
  },
}

function postJson(url: string, body: unknown) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, data, Buffer.alloc(4)])
}

function pngWithChara(json: string): Buffer {
  const text = Buffer.from('chara\0' + Buffer.from(json, 'utf8').toString('base64'), 'latin1')
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', text)])
}

describe('角色卡库 API', () => {
  it('POST 保存一张卡，落盘为 characters/<id>.json', async () => {
    const res = await postJson(`/api/characters${q(root)}`, { card: sampleCard })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; card: { data: { name: string } } }
    expect(body.id).toBe('沈砚')
    expect(body.card.data.name).toBe('沈砚')

    const saved = JSON.parse(readFileSync(path.join(root, 'characters', '沈砚.json'), 'utf8'))
    expect(saved.data.description).toContain('旧书店老板')
    expect(saved.spec).toBe('chara_card_v2')
  })

  it('同名卡再加一次返回 409，显式 overwrite 才覆盖', async () => {
    await postJson(`/api/characters${q(root)}`, { card: sampleCard })
    const again = await postJson(`/api/characters${q(root)}`, { card: sampleCard })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { exists: string }).exists).toBe('沈砚')

    const overwritten = await postJson(`/api/characters${q(root)}`, {
      card: { ...sampleCard, data: { ...sampleCard.data, personality: '其实很话痨' } },
      overwrite: true,
    })
    expect(overwritten.status).toBe(201)
    const card = (await overwritten.json()) as { card: { data: { personality: string } } }
    expect(card.card.data.personality).toBe('其实很话痨')
  })

  it('GET 列出卡库与单张卡', async () => {
    await postJson(`/api/characters${q(root)}`, { card: sampleCard })
    const list = await app.request(`/api/characters${q(root)}`)
    const listBody = (await list.json()) as { cards: { id: string; name: string }[] }
    expect(listBody.cards.map((item) => item.id)).toEqual(['沈砚'])

    const one = await app.request(cardPath('沈砚'))
    expect(one.status).toBe(200)
    expect(((await one.json()) as { card: { data: { name: string } } }).card.data.name).toBe('沈砚')
  })

  it('导入 JSON 文件', async () => {
    const form = new FormData()
    form.append('file', new File([JSON.stringify(sampleCard)], 'card.json', { type: 'application/json' }))
    const res = await app.request(`/api/characters/import${q(root)}`, { method: 'POST', body: form })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; cards: unknown[] }
    expect(body.id).toBe('沈砚')
    expect(body.cards).toHaveLength(1)
  })

  it('导入带 chara chunk 的 PNG', async () => {
    const png = pngWithChara(JSON.stringify(sampleCard))
    const form = new FormData()
    form.append('file', new File([Uint8Array.from(png)], 'card.png', { type: 'image/png' }))
    const res = await app.request(`/api/characters/import${q(root)}`, { method: 'POST', body: form })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { id: string }).id).toBe('沈砚')
  })

  it('导入没名字的卡返回 400', async () => {
    const form = new FormData()
    form.append('file', new File(['{"description":"无名"}'], 'card.json', { type: 'application/json' }))
    const res = await app.request(`/api/characters/import${q(root)}`, { method: 'POST', body: form })
    expect(res.status).toBe(400)
  })

  it('删除未被引用的卡', async () => {
    await postJson(`/api/characters${q(root)}`, { card: sampleCard })
    const res = await app.request(cardPath('沈砚'), { method: 'DELETE' })
    expect(res.status).toBe(200)
    const list = await app.request(`/api/characters${q(root)}`)
    expect(((await list.json()) as { cards: unknown[] }).cards).toHaveLength(0)
  })

  it('删除被戏引用的卡时返回 409，force=1 才真删', async () => {
    await postJson(`/api/characters${q(root)}`, { card: sampleCard })
    const created = await app.request(`/api/sessions${q(root)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '雨夜', cast: ['沈砚'] }),
    })
    const session = ((await created.json()) as { session: { id: string } }).session

    const refused = await app.request(cardPath('沈砚'), { method: 'DELETE' })
    expect(refused.status).toBe(409)
    const body = (await refused.json()) as { referencedBy: string[] }
    expect(body.referencedBy).toContain(session.id)

    const forced = await app.request(`${cardPath('沈砚')}&force=1`, { method: 'DELETE' })
    expect(forced.status).toBe(200)
  })
})
