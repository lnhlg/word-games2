import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** 读取 .env 填充 process.env；已存在的变量不覆盖。 */
export function loadEnv(file = path.join(process.cwd(), '.env')): void {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

// 作为副作用模块被 index.ts 首先导入，保证其它模块读到环境变量。
loadEnv()
