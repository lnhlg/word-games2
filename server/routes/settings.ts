import { Hono } from 'hono'
import { publicSettings, updateProvidersConfig, type SettingsInput } from '../lib/providers'

const app = new Hono()

app.get('/', (c) => c.json(publicSettings()))

app.put('/', async (c) => {
  let body: SettingsInput = {}
  try {
    body = (await c.req.json()) as SettingsInput
  } catch {
    return c.json({ error: '请求体必须是 JSON 对象' }, 400)
  }
  try {
    return c.json(publicSettings(updateProvidersConfig(body)))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

export default app
