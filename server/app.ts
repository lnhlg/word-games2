import { Hono } from 'hono'
import { cors } from 'hono/cors'
import sessions from './routes/sessions'
import workspaces from './routes/workspaces'

const app = new Hono()

app.use(cors())
app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/workspaces', workspaces)
app.route('/api/sessions', sessions)

export default app
