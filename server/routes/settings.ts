import { Hono } from 'hono'
import { readSettings, updateSettings } from '../lib/settings'

const app = new Hono()

app.get('/', (c) => c.json(readSettings()))

app.put('/', async (c) => {
  let body: Record<string, unknown> = {}
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  return c.json(
    updateSettings({
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      defaultModel: typeof body.defaultModel === 'string' ? body.defaultModel : undefined,
    }),
  )
})

export default app
