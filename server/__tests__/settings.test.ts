import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import app from '../app'

let dir: string
let file: string

function put(body: unknown) {
  return app.request('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    name: '供应商',
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-test',
    models: [{ name: 'model-a', efforts: ['low', 'high'] }],
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'wg-settings-'))
  file = path.join(dir, 'providers.json')
  process.env.PROVIDERS_FILE = file
  delete process.env.LLM_API_KEY
  delete process.env.LLM_BASE_URL
  delete process.env.DEFAULT_MODEL
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.PROVIDERS_FILE
  delete process.env.LLM_API_KEY
  delete process.env.LLM_BASE_URL
  delete process.env.DEFAULT_MODEL
})

describe('settings', () => {
  it('首次读取把 .env 三键迁移成一个默认供应商并落盘', async () => {
    process.env.LLM_BASE_URL = 'https://env.test/v1'
    process.env.LLM_API_KEY = 'sk-env-secret'
    process.env.DEFAULT_MODEL = 'env-model'

    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('sk-env-secret')
    const body = JSON.parse(text) as {
      providers: { id: string; name: string; baseUrl: string; hasKey: boolean; models: unknown[] }[]
      default: unknown
    }
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0]).toMatchObject({
      id: 'default',
      name: '默认供应商',
      baseUrl: 'https://env.test/v1',
      hasKey: true,
      models: [{ name: 'env-model', efforts: [] }],
    })
    expect(body.default).toEqual({ providerId: 'default', model: 'env-model', effort: null })
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).providers[0].apiKey).toBe('sk-env-secret')
  })

  it('PUT 整体替换供应商，省略 apiKey 时保留原 key', async () => {
    const first = await put({
      providers: [provider({ id: 'a' })],
      default: { providerId: 'a', model: 'model-a', effort: 'high' },
    })
    expect(first.status).toBe(200)

    const second = await put({
      providers: [provider({ id: 'a', apiKey: undefined, name: '改过的名字' })],
      default: { providerId: 'a', model: 'model-a', effort: 'high' },
    })
    expect(second.status).toBe(200)
    const body = (await second.json()) as {
      providers: { id: string; name: string; hasKey: boolean }[]
      default: unknown
    }
    expect(body.providers[0]).toMatchObject({ id: 'a', name: '改过的名字', hasKey: true })
    expect(body.default).toEqual({ providerId: 'a', model: 'model-a', effort: 'high' })
    expect(JSON.parse(readFileSync(file, 'utf8')).providers[0].apiKey).toBe('sk-test')
  })

  it('删除供应商后 default 回退到第一个供应商的第一个模型', async () => {
    await put({
      providers: [provider({ id: 'a' }), provider({ id: 'b', name: '另一个' })],
      default: { providerId: 'b', model: 'model-a', effort: null },
    })

    const res = await put({
      providers: [provider({ id: 'a' })],
      default: { providerId: 'b', model: 'model-a', effort: null },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { default: unknown }
    expect(body.default).toEqual({ providerId: 'a', model: 'model-a', effort: 'high' })
  })

  it('供应商按显示名称排序，组内模型按名称排序', async () => {
    await put({
      providers: [
        provider({
          id: 'z',
          name: 'Zeta',
          models: [
            { name: 'm2', efforts: [] },
            { name: 'm1', efforts: [] },
          ],
        }),
        provider({ id: 'a', name: 'Alpha' }),
      ],
      default: { providerId: 'a', model: 'model-a', effort: null },
    })

    const body = (await (await app.request('/api/settings')).json()) as {
      providers: { name: string; models: { name: string }[] }[]
    }
    expect(body.providers.map((item) => item.name)).toEqual(['Alpha', 'Zeta'])
    expect(body.providers[1].models.map((item) => item.name)).toEqual(['m1', 'm2'])
  })

  it('新增供应商缺少 API key 返回 400', async () => {
    const res = await put({
      providers: [provider({ id: 'new', apiKey: '' })],
      default: { providerId: 'new', model: 'model-a', effort: null },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('API key')
  })

  it('providers 不是数组时返回 400', async () => {
    const res = await put({ providers: 'nope' })
    expect(res.status).toBe(400)
  })
})
