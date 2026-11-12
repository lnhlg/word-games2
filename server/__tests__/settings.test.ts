import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import app from '../app'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'wg-settings-'))
  process.env.SETTINGS_ENV_FILE = path.join(dir, '.env')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.SETTINGS_ENV_FILE
  delete process.env.LLM_API_KEY
  delete process.env.LLM_BASE_URL
  delete process.env.DEFAULT_MODEL
})

describe('settings', () => {
  it('PUT 写 .env 并即时更新进程环境', async () => {
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test-123',
        defaultModel: 'test-model',
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      baseUrl: 'https://example.com/v1',
      hasKey: true,
      defaultModel: 'test-model',
    })
    expect(process.env.LLM_API_KEY).toBe('sk-test-123')

    const text = readFileSync(path.join(dir, '.env'), 'utf8')
    expect(text).toContain('LLM_API_KEY=sk-test-123')
    expect(text).toContain('DEFAULT_MODEL=test-model')
  })

  it('GET 不返回明文 key', async () => {
    process.env.LLM_API_KEY = 'sk-secret-value'
    const res = await app.request('/api/settings')
    const text = await res.text()
    expect(text).not.toContain('sk-secret-value')
    expect(JSON.parse(text).hasKey).toBe(true)
  })

  it('保留 .env 里已有的其它行', async () => {
    writeFileSync(path.join(dir, '.env'), '# comment\nPORT=3999\nLLM_API_KEY=old\n', 'utf8')
    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://x.test/v1' }),
    })
    const text = readFileSync(path.join(dir, '.env'), 'utf8')
    expect(text).toContain('# comment')
    expect(text).toContain('PORT=3999')
    expect(text).toContain('LLM_BASE_URL=https://x.test/v1')
    expect(text).toContain('LLM_API_KEY=old')
  })
})
