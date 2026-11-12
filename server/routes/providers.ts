import { Hono } from 'hono'
import { fetchProviderModels, readProvidersConfig, type Provider } from '../lib/providers'

const app = new Hono()

/**
 * 拉取某个供应商的模型列表。
 * 已保存的供应商按 id 查凭据；设置弹窗里尚未保存的供应商可以把 baseUrl/apiKey 放在 body 里临时使用。
 */
app.post('/:id/models', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    baseUrl?: unknown
    apiKey?: unknown
  }
  const saved = readProvidersConfig().providers.find((item) => item.id === c.req.param('id'))
  const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : saved?.baseUrl
  const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : saved?.apiKey

  if (!baseUrl) return c.json({ error: '缺少 baseUrl' }, 400)
  if (!apiKey) return c.json({ error: '缺少 apiKey' }, 400)

  const provider: Provider = saved
    ? { ...saved, baseUrl, apiKey }
    : { id: c.req.param('id'), name: c.req.param('id'), baseUrl, apiKey, models: [] }

  try {
    return c.json({ models: await fetchProviderModels(provider) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 502)
  }
})

export default app
