import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_AGENT } from './session-fs'

/**
 * 全场通用指令，每回合现读，改文件后下一回合立即生效，不用重启。
 *
 * 两层叠加：工作区根目录的 `AGENTS.md`（或 `AGENT.md`）是整首歌的默认规则，
 * 会话目录的 `<model>.md` / `AGENT.md` 只对这一场戏生效、排在工作区之后，
 * 冲突时更具体的那层更靠后、更容易被模型当成补充。
 *
 * 会话里的 `AGENT.md` 是新建会话时写入的模板说明，没被导演改过时不算指令，避免白占 prompt。
 */
export function resolveAgentMd(dir: string, model: string, workspace: string): string {
  const layers = [readWorkspaceRules(workspace), readSessionRules(dir, model)].filter(Boolean)
  return layers.join('\n\n')
}

/** 工作区级默认指令：`AGENTS.md` 优先，其次单数的 `AGENT.md`。 */
function readWorkspaceRules(workspace: string): string {
  for (const name of ['AGENTS.md', 'AGENT.md']) {
    const file = path.join(workspace, name)
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8').trim()
      if (text) return text
    }
  }
  return ''
}

/** 本场指令：`<model>.md` 优先，其次 `AGENT.md`；模板原文不算。 */
function readSessionRules(dir: string, model: string): string {
  const modelFile = path.join(dir, `${model}.md`)
  if (existsSync(modelFile)) {
    const text = readFileSync(modelFile, 'utf8').trim()
    if (text) return text
  }
  const agentFile = path.join(dir, 'AGENT.md')
  if (!existsSync(agentFile)) return ''
  const text = readFileSync(agentFile, 'utf8').trim()
  // 新建会话时写入的占位说明不是导演写的指令。
  if (!text || text === DEFAULT_AGENT.trim()) return ''
  return text
}
