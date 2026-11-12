import './lib/env'
import { serve } from '@hono/node-server'
import app from './app'
import { readProvidersConfig } from './lib/providers'

// 启动时预热：首次运行把 .env 迁移成 providers.json。
try {
  readProvidersConfig()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[providers] 初始化失败：${message}`)
}

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] http://127.0.0.1:${info.port}`)
})
