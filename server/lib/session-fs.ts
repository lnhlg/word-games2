import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface SessionMeta {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
  /** 回滚记录：每次回滚记下 (回滚到的回合, 回滚时刻)；此前的分叉消息按它过滤。 */
  discarded?: { turn: number; at: string }[]
}

export interface CheckResult {
  attribute: string
  roll: number
  total: number
  dc: number
  success: boolean
}

export interface GameState {
  turn: number
  scene: string
  location: string
  stats: Record<string, number>
  inventory: string[]
  flags: Record<string, boolean>
  lastCheck: CheckResult | null
  ending: string | null
}

export type MessageRecord =
  | { role: 'player'; turn: number; at: string; text: string }
  | { role: 'engine'; turn: number; at: string; kind: 'text'; text: string }
  | { role: 'engine'; turn: number; at: string; kind: 'tool_call'; id: string; name: string; args: unknown }
  | { role: 'tool'; turn: number; at: string; callId: string; name: string; ok: boolean; result: unknown }
  | { role: 'engine'; turn: number; at: string; kind: 'options'; options: string[] }
  | { role: 'system'; at: string; kind: 'error'; text: string }

/** 默认模型：运行时读 env，设置页改完立刻生效。 */
export function defaultModel(): string {
  return process.env.DEFAULT_MODEL || 'deepseek-chat'
}

export const DEFAULT_WORLD = `engine:
  name: "叙事引擎"
  tone: "冷峻、克制、第二人称"
  boundaries:
    - "不替玩家做决定"
    - "不剧透未触发的结局"
opening: "你在雾港旧宅门口醒来，口袋里只有一张对折的纸条。"
scenes:
  - id: hallway
    name: "门厅"
    exits: [study, parlor]
  - id: study
    name: "旧书房"
    exits: [hallway]
  - id: parlor
    name: "会客厅"
    exits: [hallway]
endings: []
`

export const DEFAULT_STATE: GameState = {
  turn: 0,
  scene: '门厅',
  location: 'hallway',
  stats: { 洞察: 2, 胆识: 2, 共情: 2 },
  inventory: [],
  flags: {},
  lastCheck: null,
  ending: null,
}

const DEFAULT_AGENT = `# AGENT.md

你正在主持一局互动小说。这份文件由玩家自由编写，引擎不会解析它的结构。

可以写：叙事风格、禁忌、节奏要求、语言习惯。
模型专属指令请放在 \`<模型名>.md\` 里（存在时优先于本文件）。
`

const pad = (n: number) => String(n).padStart(2, '0')

export function sessionDir(root: string, id: string): string {
  return path.join(root, id)
}

export function newSessionId(root: string): string {
  const d = new Date()
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  let id = base
  let i = 2
  while (existsSync(path.join(root, id))) id = `${base}-${i++}`
  return id
}

/** 在工作区目录下开一局新的会话；会话是工作区里含 session.json 的子目录。 */
export function createSession(root: string): SessionMeta {
  mkdirSync(root, { recursive: true })
  const id = newSessionId(root)
  const dir = path.join(root, id)
  mkdirSync(path.join(dir, 'snapshots'), { recursive: true })

  const now = new Date().toISOString()
  const meta: SessionMeta = {
    id,
    title: '未命名的一局',
    model: defaultModel(),
    createdAt: now,
    updatedAt: now,
    turn: 0,
    status: 'active',
  }

  writeFileSync(path.join(dir, 'session.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
  writeFileSync(path.join(dir, 'AGENT.md'), DEFAULT_AGENT, 'utf8')
  writeFileSync(path.join(dir, 'world.yaml'), DEFAULT_WORLD, 'utf8')
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify(DEFAULT_STATE, null, 2) + '\n', 'utf8')
  writeFileSync(path.join(dir, 'messages.jsonl'), '', 'utf8')

  return meta
}

export function listSessions(root: string): SessionMeta[] {
  if (!existsSync(root)) return []
  const out: SessionMeta[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(root, entry.name, 'session.json')
    if (!existsSync(file)) continue
    try {
      out.push(JSON.parse(readFileSync(file, 'utf8')) as SessionMeta)
    } catch {
      // 损坏的会话暂时跳过，界面上再处理
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readMeta(dir: string): SessionMeta {
  return JSON.parse(readFileSync(path.join(dir, 'session.json'), 'utf8')) as SessionMeta
}

export function writeMeta(dir: string, meta: SessionMeta): void {
  writeFileSync(path.join(dir, 'session.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
}

export function readState(dir: string): GameState {
  const file = path.join(dir, 'state.json')
  if (!existsSync(file)) return JSON.parse(JSON.stringify(DEFAULT_STATE)) as GameState
  return JSON.parse(readFileSync(file, 'utf8')) as GameState
}

export function writeState(dir: string, state: GameState): void {
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8')
}

export function appendMessage(dir: string, msg: MessageRecord): void {
  writeFileSync(path.join(dir, 'messages.jsonl'), JSON.stringify(msg) + '\n', { flag: 'a', encoding: 'utf8' })
}

export function readMessages(dir: string): MessageRecord[] {
  const file = path.join(dir, 'messages.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MessageRecord)
}

export function writeSnapshot(dir: string, turn: number, state: GameState): void {
  mkdirSync(path.join(dir, 'snapshots'), { recursive: true })
  writeFileSync(
    path.join(dir, 'snapshots', `${turn}.json`),
    JSON.stringify({ ...state, turn }, null, 2) + '\n',
    'utf8',
  )
}

export function patchMeta(
  dir: string,
  patch: { title?: string; status?: SessionMeta['status']; model?: string },
): SessionMeta {
  const meta = readMeta(dir)
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 80)
    if (title) meta.title = title
  }
  if (patch.status !== undefined) meta.status = patch.status
  if (patch.model !== undefined && patch.model.trim()) meta.model = patch.model.trim()
  meta.updatedAt = new Date().toISOString()
  writeMeta(dir, meta)
  return meta
}

/** 删除整个会话文件夹；id 必须是单段目录名，防止穿越到工作区之外。 */
export function removeSession(root: string, id: string): boolean {
  if (!id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) return false
  const dir = sessionDir(root, id)
  if (!existsSync(path.join(dir, 'session.json'))) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

function clockOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 把一局导出为 Markdown：元信息、世界、全部回合、最终状态。 */
export function exportMarkdown(
  dir: string,
  meta: SessionMeta,
  messages: MessageRecord[],
  state: GameState,
): string {
  const worldFile = path.join(dir, 'world.yaml')
  const world = existsSync(worldFile) ? readFileSync(worldFile, 'utf8').trim() : ''
  const statusText = meta.status === 'ended' ? '已结束' : meta.status === 'archived' ? '已归档' : '进行中'
  const lines: string[] = [
    `# ${meta.title}`,
    '',
    `- 会话：\`${meta.id}\``,
    `- 模型：${meta.model}`,
    `- 回合：${meta.turn}`,
    `- 状态：${statusText}`,
    `- 创建：${meta.createdAt}`,
    `- 更新：${meta.updatedAt}`,
    '',
  ]
  if (world) lines.push('## 世界', '', '```yaml', world, '```', '')

  lines.push('## 剧情', '')
  let currentTurn = -1
  for (const m of messages) {
    if ('turn' in m && m.turn !== currentTurn) {
      currentTurn = m.turn
      const clock = m.role === 'player' ? clockOf(m.at) : ''
      lines.push(`### 回合 ${currentTurn + 1}${clock ? ` · ${clock}` : ''}`, '')
    }
    if (m.role === 'player') lines.push(`> **玩家**：${m.text}`, '')
    else if (m.role === 'engine' && m.kind === 'text') lines.push(m.text, '')
    else if (m.role === 'engine' && m.kind === 'tool_call')
      lines.push(`- 工具 \`${m.name}\`：\`${JSON.stringify(m.args)}\``, '')
    else if (m.role === 'tool') lines.push(`  - 结果：\`${JSON.stringify(m.result)}\``, '')
    else if (m.role === 'engine' && m.kind === 'options') lines.push(`- 选项：${m.options.join(' / ')}`, '')
    else if (m.role === 'system') lines.push(`- 系统：${m.text}`, '')
  }

  lines.push('## 最终状态', '', '```json', JSON.stringify(state, null, 2), '```', '')
  return lines.join('\n')
}

/** 回滚之后，被回滚分支里在回滚时刻之前产生的消息不再展示；messages.jsonl 本身不动。 */
export function visibleMessages(messages: MessageRecord[], meta: SessionMeta): MessageRecord[] {
  const discarded = meta.discarded ?? []
  if (discarded.length === 0) return messages
  return messages.filter((message) => {
    if (!('turn' in message)) return true
    return !discarded.some((cut) => message.turn > cut.turn && message.at <= cut.at)
  })
}

export interface RollbackResult {
  meta: SessionMeta
  state: GameState
  messages: MessageRecord[]
}

/** 把 state 恢复到 snapshots/<turn>.json；messages.jsonl 只追加不回写。 */
export function rollbackSession(dir: string, turn: number): RollbackResult | null {
  const file = path.join(dir, 'snapshots', `${turn}.json`)
  if (!existsSync(file)) return null

  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as GameState
  const state: GameState = { ...snapshot, turn: turn + 1 }
  writeState(dir, state)

  const meta = readMeta(dir)
  meta.turn = turn + 1
  meta.status = state.ending ? 'ended' : 'active'
  meta.updatedAt = new Date().toISOString()
  meta.discarded = [...(meta.discarded ?? []), { turn, at: meta.updatedAt }]
  writeMeta(dir, meta)

  return { meta, state, messages: visibleMessages(readMessages(dir), meta) }
}

export function readSession(
  root: string,
  id: string,
): { meta: SessionMeta; messages: MessageRecord[]; state: GameState } | null {
  const dir = sessionDir(root, id)
  if (!existsSync(path.join(dir, 'session.json'))) return null
  const meta = readMeta(dir)
  return { meta, messages: visibleMessages(readMessages(dir), meta), state: readState(dir) }
}
