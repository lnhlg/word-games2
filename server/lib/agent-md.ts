import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 会话的 agent 指令文件：`<model>.md` 优先，其次 `AGENT.md`，都没有就返回空串。
 * 每回合现读，改文件后下一回合立即生效，不用重启。
 */
export function resolveAgentMd(dir: string, model: string): string {
  const modelFile = path.join(dir, `${model}.md`)
  if (existsSync(modelFile)) return readFileSync(modelFile, 'utf8')
  const agentFile = path.join(dir, 'AGENT.md')
  if (existsSync(agentFile)) return readFileSync(agentFile, 'utf8')
  return ''
}
