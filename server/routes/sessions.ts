import { Hono } from 'hono'
import { createSession, listSessions, readSession } from '../lib/session-fs'

const app = new Hono()

app.get('/', (c) => c.json({ sessions: listSessions() }))

app.post('/', (c) => c.json({ session: createSession() }, 201))

app.get('/:id', (c) => {
  const result = readSession(c.req.param('id'))
  if (!result) return c.json({ error: 'session not found' }, 404)
  return c.json(result)
})

export default app
