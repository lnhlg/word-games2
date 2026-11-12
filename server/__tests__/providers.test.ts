import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  fetchProviderModels,
  parseModelNames,
  readProvidersConfig,
  resolveSelection,
  updateProvidersConfig,
  writeProvidersConfig,
  type ProvidersConfig,
} from '../lib/providers'

let dir: string
let file: string

function emptyConfig(): ProvidersConfig {
  return {
    version: 1,
    providers: [],
    default: { providerId: null, model: 'fallback-model', effort: null },
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'wg-providers-'))
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
  vi.unstubAllGlobals()
})

describe('providers 配置', () => {
  it('没有文件时从 .env 迁移成一个供应商', () => {
    process.env.LLM_BASE_URL = 'https://env.test/v1'
    process.env.LLM_API_KEY = 'sk-env'
    process.env.DEFAULT_MODEL = 'env-model'

    const config = readProvidersConfig()
    expect(config.providers).toHaveLength(1)
    expect(config.providers[0]).toMatchObject({
      id: 'default',
      name: '默认供应商',
      baseUrl: 'https://env.test/v1',
      models: [{ name: 'env-model', efforts: [] }],
    })
    expect(config.default).toEqual({ providerId: 'default', model: 'env-model', effort: null })
  })

  it('id 冲突时自动加数字后缀', () => {
    const config = updateProvidersConfig({
      providers: [
        { name: 'Same', baseUrl: 'https://a.test/v1', apiKey: 'sk-1', models: [] },
        { name: 'Same', baseUrl: 'https://b.test/v1', apiKey: 'sk-2', models: [] },
      ],
      default: null,
    })
    expect(config.providers.map((item) => item.id)).toEqual(['same', 'same-2'])
  })

  it('模型条目只保留受支持的档位，空集合即不支持思考强度', () => {
    const config = updateProvidersConfig({
      providers: [
        {
          name: 'P',
          baseUrl: 'https://p.test/v1',
          apiKey: 'sk-p',
          models: [
            { name: 'plain', efforts: [] },
            { name: 'reasoning', efforts: ['high', 'bogus', 'low'], defaultEffort: 'high' },
          ],
        },
      ],
      default: { providerId: 'p', model: 'reasoning', effort: 'high' },
    })
    const reasoning = config.providers[0].models.find((model) => model.name === 'reasoning')
    expect(reasoning).toEqual({ name: 'reasoning', efforts: ['low', 'high'], defaultEffort: 'high' })
    expect(config.providers[0].models.find((model) => model.name === 'plain')).toEqual({
      name: 'plain',
      efforts: [],
    })
  })

  it('旧枚举值折算，medium 作为合法档位保留', () => {
    const config = updateProvidersConfig({
      providers: [
        {
          name: 'P',
          baseUrl: 'https://p.test/v1',
          apiKey: 'sk-p',
          models: [
            { name: 'legacy', efforts: ['minimal', 'medium', 'high', 'xhigh', 'ultra'] },
            { name: 'high-first', efforts: ['low', 'high', 'max'] },
          ],
        },
      ],
      default: null,
    })
    const legacy = config.providers[0].models.find((model) => model.name === 'legacy')
    expect(legacy).toEqual({
      name: 'legacy',
      efforts: ['low', 'medium', 'high', 'max'],
      defaultEffort: 'high',
    })
    expect(config.providers[0].models.find((model) => model.name === 'high-first')?.defaultEffort).toBe('high')
  })

  it('模型名含 gemini 时推断 thinking_level，并过滤 max', () => {
    const config = updateProvidersConfig({
      providers: [
        {
          name: 'G',
          baseUrl: 'https://g.test/v1',
          apiKey: 'sk-g',
          models: [
            { name: 'gemini-4-argon', efforts: ['low', 'medium', 'high', 'max'] },
            { name: 'Gemini-4-Carbon', efforts: ['high'], defaultEffort: 'high' },
          ],
        },
      ],
      default: null,
    })
    const argon = config.providers[0].models.find((model) => model.name === 'gemini-4-argon')
    expect(argon?.reasoningParam).toBe('thinking_level')
    expect(argon?.efforts).toEqual(['low', 'medium', 'high'])
    expect(argon?.defaultEffort).toBe('high')
    const carbon = config.providers[0].models.find((model) => model.name === 'Gemini-4-Carbon')
    expect(carbon?.reasoningParam).toBe('thinking_level')
  })

  it('显式 reasoningParam 优先于名称推断', () => {
    const config = updateProvidersConfig({
      providers: [
        {
          name: 'G',
          baseUrl: 'https://g.test/v1',
          apiKey: 'sk-g',
          models: [{ name: 'gemini-custom', efforts: ['low', 'max'], reasoningParam: 'reasoning_effort' }],
        },
      ],
      default: null,
    })
    const entry = config.providers[0].models[0]
    expect(entry.reasoningParam).toBe('reasoning_effort')
    expect(entry.efforts).toEqual(['low', 'max'])
  })
})

describe('resolveSelection', () => {
  function seed() {
    writeProvidersConfig({
      version: 1,
      providers: [
        {
          id: 'a',
          name: 'A',
          baseUrl: 'https://a.test/v1',
          apiKey: 'sk-a',
          models: [{ name: 'shared', efforts: ['low', 'high'], defaultEffort: 'low' }],
        },
        {
          id: 'b',
          name: 'B',
          baseUrl: 'https://b.test/v1',
          apiKey: 'sk-b',
          models: [
            { name: 'shared', efforts: ['high'], defaultEffort: 'high' },
            { name: 'only-b', efforts: [] },
          ],
        },
      ],
      default: { providerId: 'a', model: 'shared', effort: 'low' },
    })
  }

  it('providerId + 模型名精确命中', () => {
    seed()
    const resolved = resolveSelection({ providerId: 'b', model: 'shared', reasoningEffort: 'high' })
    expect(resolved.provider?.id).toBe('b')
    expect(resolved.model).toBe('shared')
    expect(resolved.effort).toBe('high')
  })

  it('没有 providerId 时按模型名在供应商间唯一匹配', () => {
    seed()
    const resolved = resolveSelection({ model: 'only-b' })
    expect(resolved.provider?.id).toBe('b')
    expect(resolved.effort).toBeNull()
  })

  it('模型名在多个供应商里重复时不猜，回退默认三元组', () => {
    seed()
    const resolved = resolveSelection({ model: 'shared' })
    expect(resolved.provider?.id).toBe('a')
    expect(resolved.effort).toBe('low')
  })

  it('失效引用回退默认三元组', () => {
    seed()
    const resolved = resolveSelection({ providerId: 'gone', model: 'gone-model', reasoningEffort: 'high' })
    expect(resolved.provider?.id).toBe('a')
    expect(resolved.model).toBe('shared')
    expect(resolved.effort).toBe('high')
  })

  it('Gemini 模型解析出 thinking_level 参数', () => {
    writeProvidersConfig({
      version: 1,
      providers: [
        {
          id: 'g',
          name: 'G',
          baseUrl: 'https://g.test/v1',
          apiKey: 'sk-g',
          models: [
            {
              name: 'gemini-4-argon',
              efforts: ['low', 'medium', 'high'],
              defaultEffort: 'high',
              reasoningParam: 'thinking_level',
            },
          ],
        },
      ],
      default: { providerId: 'g', model: 'gemini-4-argon', effort: 'high' },
    })
    const resolved = resolveSelection({ providerId: 'g', model: 'gemini-4-argon', reasoningEffort: 'medium' })
    expect(resolved.reasoningParam).toBe('thinking_level')
    expect(resolved.effort).toBe('medium')
    expect(resolved.supportsReasoning).toBe(true)
  })

  it('没有任何供应商时保留原模型名交给 .env 兜底', () => {
    writeProvidersConfig(emptyConfig())
    const resolved = resolveSelection({ model: 'legacy-model', reasoningEffort: 'high' })
    expect(resolved).toEqual({
      provider: null,
      model: 'legacy-model',
      effort: null,
      supportsReasoning: false,
      reasoningParam: 'reasoning_effort',
    })
  })
})

describe('parseModelNames', () => {
  it('兼容顶层数组、data[] 与 models[]，去重排序', () => {
    expect(parseModelNames(['m2', 'm1', 'm2'])).toEqual(['m1', 'm2'])
    expect(parseModelNames({ data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['a', 'b'])
    expect(parseModelNames({ models: [{ name: 'x' }, { name: 'y' }] })).toEqual(['x', 'y'])
    expect(parseModelNames({ nope: true })).toEqual([])
  })
})

describe('fetchProviderModels', () => {
  it('请求 baseUrl/models 并带 Bearer，解析 data[].id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const models = await fetchProviderModels({
      id: 'p',
      name: 'P',
      baseUrl: 'https://p.test/v1/',
      apiKey: 'sk-p',
      models: [],
    })
    expect(models).toEqual(['m1', 'm2'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://p.test/v1/models')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-p')
  })

  it('非 2xx 抛出带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401, statusText: 'Unauthorized' })))
    await expect(
      fetchProviderModels({ id: 'p', name: 'P', baseUrl: 'https://p.test/v1', apiKey: 'sk-p', models: [] }),
    ).rejects.toThrow('拉取模型失败：401 Unauthorized')
  })
})
