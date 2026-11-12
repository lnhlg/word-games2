import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface SettingsView {
  baseUrl: string
  hasKey: boolean
  defaultModel: string
}

export interface SettingsPatch {
  baseUrl?: string
  apiKey?: string
  defaultModel?: string
}

/** 测试里用 SETTINGS_ENV_FILE 指到临时文件，避免改动仓库里的 .env。 */
function envFile(): string {
  return process.env.SETTINGS_ENV_FILE ?? path.join(process.cwd(), '.env')
}

function formatValue(value: string): string {
  return /[\s#'"]/.test(value) ? JSON.stringify(value) : value
}

export function readSettings(): SettingsView {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
    hasKey: Boolean(process.env.LLM_API_KEY),
    defaultModel: process.env.DEFAULT_MODEL ?? 'deepseek-chat',
  }
}

/**
 * 只改 .env 里的三个键，其余行（注释、其它变量）原样保留；空 apiKey 表示不改。
 * 同时更新 process.env，让下一次模型调用立刻用新配置。
 */
export function updateSettings(patch: SettingsPatch): SettingsView {
  const updates = new Map<string, string>()
  if (patch.baseUrl !== undefined) updates.set('LLM_BASE_URL', patch.baseUrl.trim())
  if (patch.apiKey !== undefined && patch.apiKey.trim()) updates.set('LLM_API_KEY', patch.apiKey.trim())
  if (patch.defaultModel !== undefined) updates.set('DEFAULT_MODEL', patch.defaultModel.trim())

  if (updates.size > 0) {
    const file = envFile()
    const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const seen = new Set<string>()
    const lines = (raw ? raw.split(/\r?\n/) : []).map((line) => {
      const eq = line.indexOf('=')
      if (eq <= 0) return line
      const key = line.slice(0, eq).trim()
      if (!updates.has(key)) return line
      seen.add(key)
      return `${key}=${formatValue(updates.get(key)!)}`
    })
    for (const [key, value] of updates) {
      if (!seen.has(key)) lines.push(`${key}=${formatValue(value)}`)
    }
    const text = lines.filter((line, index) => line !== '' || index > 0).join('\n').replace(/\n+$/, '') + '\n'
    writeFileSync(file, text, 'utf8')
    for (const [key, value] of updates) process.env[key] = value
  }
  return readSettings()
}
