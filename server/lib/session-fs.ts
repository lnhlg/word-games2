import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defaultSelection, type Effort } from './providers'

/** 一个状态项：看什么。值在 status.jsonl 里，不在模板里。 */
export interface StatusItem {
  name: string
  note: string
}

/** 一场戏里每个角色的状态项清单，键是角色卡 id；缺省表示这场戏没启用角色状态。 */
export type StatusTemplate = Record<string, StatusItem[]>

export interface SessionMeta {
  id: string
  title: string
  model: string
  /** 选用的供应商；缺省时按模型名唯一匹配，再回退 default。 */
  providerId?: string
  /** 本会话的思考强度；缺省/null 表示关闭。 */
  reasoningEffort?: Effort | null
  /** 本场的默认叙述视角；自由文本，缺省按第三人称限知处理。 */
  perspective?: string
  /** 参演角色卡的 id；空数组表示一场没有角色的独白。 */
  cast?: string[]
  /** 角色状态的模板：每个角色看哪些维度；值随回合变化，存在 status.jsonl。 */
  statusTemplate?: StatusTemplate
  /** 每个角色当前套用的是模板库里的哪一份；只作来源记录，实际定义看 statusTemplate。 */
  statusTemplateIds?: Record<string, string>
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
}

export type MessageRecord =
  | { role: 'director'; turn: number; at: string; text: string }
  | {
      role: 'narrative'
      turn: number
      at: string
      text: string
      interrupted?: boolean
      /** 导演手动改过这段情节。 */
      edited?: boolean
      /** 这一段是按导演的哪条重写要求生成的；没有要求时缺省。 */
      instruction?: string
      /** 正文写完后生成的后续剧情选项。 */
      nextOptions?: string[]
    }
  | { role: 'system'; at: string; kind: 'error'; text: string }

export const DEFAULT_PERSPECTIVE = '第三人称限知'

/** 默认模型：运行时读 env，设置页改完立刻生效。 */
export function defaultModel(): string {
  return process.env.DEFAULT_MODEL || 'deepseek-chat'
}

export const DEFAULT_AGENT = `# AGENT.md

这场戏的全场通用指令，对全部参演角色生效。代码不会解析它的结构。

可以写：文风、禁忌、节奏、语言习惯、整体氛围。
人物设定请写进各自的角色卡，这里只放全场共用的东西。
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

/** 一场戏 = 工作区里一个含 session.json 的子目录。 */
export function createSession(
  root: string,
  input: { title?: string; cast?: string[]; perspective?: string } = {},
): SessionMeta {
  mkdirSync(root, { recursive: true })
  const id = newSessionId(root)
  const dir = path.join(root, id)
  mkdirSync(dir, { recursive: true })

  const now = new Date().toISOString()
  const defaults = defaultSelection()
  const meta: SessionMeta = {
    id,
    title: input.title?.trim() ? input.title.trim().slice(0, 80) : '未命名的一场戏',
    model: defaults.model,
    ...(defaults.providerId ? { providerId: defaults.providerId } : {}),
    ...(defaults.effort ? { reasoningEffort: defaults.effort } : {}),
    perspective: input.perspective?.trim() || DEFAULT_PERSPECTIVE,
    cast: input.cast ?? [],
    createdAt: now,
    updatedAt: now,
    turn: 0,
    status: 'active',
  }

  writeFileSync(path.join(dir, 'session.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
  writeFileSync(path.join(dir, 'AGENT.md'), DEFAULT_AGENT, 'utf8')
  writeFileSync(path.join(dir, 'messages.jsonl'), '', 'utf8')

  return meta
}

/**
 * 旧格式（互动小说时代）的会话带 state.json 或 world.yaml；
 * 它们留在磁盘上，但不进新列表。
 */
export function isLegacySession(dir: string): boolean {
  return existsSync(path.join(dir, 'state.json')) || existsSync(path.join(dir, 'world.yaml'))
}

export function listSessions(root: string): SessionMeta[] {
  if (!existsSync(root)) return []
  const out: SessionMeta[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'characters') continue
    const dir = path.join(root, entry.name)
    const file = path.join(dir, 'session.json')
    if (!existsSync(file) || isLegacySession(dir)) continue
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

export function appendMessage(dir: string, msg: MessageRecord): void {
  writeFileSync(path.join(dir, 'messages.jsonl'), JSON.stringify(msg) + '\n', { flag: 'a', encoding: 'utf8' })
}

/** 只返回新格式记录；旧文件里的 player/engine/tool 行读取时忽略。 */
export function readMessages(dir: string): MessageRecord[] {
  const file = path.join(dir, 'messages.jsonl')
  if (!existsSync(file)) return []
  const out: MessageRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as { role?: unknown }
      if (parsed.role === 'director' || parsed.role === 'narrative' || parsed.role === 'system') {
        out.push(parsed as MessageRecord)
      }
    } catch {
      // 坏行跳过，不阻塞会话。
    }
  }
  return out
}

/**
 * 原地改写整个消息文件：先写临时文件再 rename，避免进程中断留下半截 JSONL。
 * messages.jsonl 从"只追加"改成"可原地改写"见 docs/adr/0001-turn-rewriting.md。
 */
export function writeMessages(dir: string, messages: MessageRecord[]): void {
  const file = path.join(dir, 'messages.jsonl')
  const tmp = `${file}.tmp`
  const body = messages.map((message) => JSON.stringify(message)).join('\n')
  writeFileSync(tmp, messages.length ? `${body}\n` : '', 'utf8')
  renameSync(tmp, file)
}

/** 去掉某一回合的全部记录（导演大纲 + 情节）；系统错误记录不归属回合，保留。 */
export function withoutTurn(messages: MessageRecord[], turn: number): MessageRecord[] {
  return messages.filter((message) => message.role === 'system' || message.turn !== turn)
}

/** 只去掉某一回合的情节，保留大纲（重新生成时先清旧稿）。 */
export function withoutNarrative(messages: MessageRecord[], turn: number): MessageRecord[] {
  return messages.filter((message) => !(message.role === 'narrative' && message.turn === turn))
}

/** 把某一回合的情节换成新文本，标记已编辑，并作废该回合的选项。 */
export function withEditedNarrative(
  messages: MessageRecord[],
  turn: number,
  text: string,
): { messages: MessageRecord[]; found: boolean } {
  let found = false
  const next = messages.map((message) => {
    if (message.role !== 'narrative' || message.turn !== turn) return message
    found = true
    return { ...message, text, edited: true, nextOptions: undefined }
  })
  return { messages: next, found }
}

/** 给某一回合的情节挂上后续选项。 */
export function withNextOptions(
  messages: MessageRecord[],
  turn: number,
  options: string[],
): { messages: MessageRecord[]; found: boolean } {
  let found = false
  const next = messages.map((message) => {
    if (message.role !== 'narrative' || message.turn !== turn) return message
    found = true
    return { ...message, nextOptions: options }
  })
  return { messages: next, found }
}

/**
 * 最后一条非 system 记录所属的回合，删除与重新生成的判定都以它为准。
 * 生成失败时不占回合号，于是大纲的回合号会比 `meta.turn - 1` 多出一格，
 * 这条「失败后只留下大纲」的回合同样算最后一回合，可以重新生成或删除。
 * `pending` 表示这一回合还没有情节。
 */
export function lastTurnOf(messages: MessageRecord[]): { turn: number; pending: boolean } | null {
  let last: Exclude<MessageRecord, { role: 'system' }> | null = null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'system') {
      last = message
      break
    }
  }
  if (!last) return null
  return {
    turn: last.turn,
    pending: !messages.some((message) => message.role === 'narrative' && message.turn === last.turn),
  }
}

/** 删除最后一回合；该回合没有任何记录时返回 false。 */
export function deleteTurnFiles(dir: string, turn: number): boolean {
  const messages = readMessages(dir)
  if (!messages.some((message) => message.role !== 'system' && message.turn === turn)) return false
  writeMessages(dir, withoutTurn(messages, turn))
  return true
}

/** 改写某一回合的情节原文；该回合没有落盘情节时返回 false。 */
export function editNarrativeFile(dir: string, turn: number, text: string): boolean {
  const { messages, found } = withEditedNarrative(readMessages(dir), turn, text)
  if (!found) return false
  writeMessages(dir, messages)
  return true
}

/** 写回某一回合的后续选项；该回合没有落盘情节时返回 false。 */
export function saveNextOptions(dir: string, turn: number, options: string[]): boolean {
  const { messages, found } = withNextOptions(readMessages(dir), turn, options)
  if (!found) return false
  writeMessages(dir, messages)
  return true
}

export function patchMeta(
  dir: string,
  patch: {
    title?: string
    status?: SessionMeta['status']
    model?: string
    providerId?: string | null
    reasoningEffort?: Effort | null
    perspective?: string
    /** 参演角色整份替换；追加走 sessions 路由的 /cast 接口。 */
    cast?: string[]
  },
): SessionMeta {
  const meta = readMeta(dir)
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 80)
    if (title) meta.title = title
  }
  if (patch.status !== undefined) meta.status = patch.status
  if (patch.model !== undefined && patch.model.trim()) meta.model = patch.model.trim()
  if (patch.providerId !== undefined) {
    if (patch.providerId && patch.providerId.trim()) meta.providerId = patch.providerId.trim()
    else delete meta.providerId
  }
  if (patch.reasoningEffort !== undefined) {
    if (patch.reasoningEffort) meta.reasoningEffort = patch.reasoningEffort
    else delete meta.reasoningEffort
  }
  if (patch.perspective !== undefined && patch.perspective.trim()) {
    meta.perspective = patch.perspective.trim()
  }
  if (patch.cast !== undefined) meta.cast = patch.cast
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

/** 把一场戏导出为 Markdown 小说：元信息 + 回合大纲与情节；appendix 接在剧情之后。 */
export function exportMarkdown(meta: SessionMeta, messages: MessageRecord[], appendix = ''): string {
  const statusText = meta.status === 'ended' ? '已落笔' : meta.status === 'archived' ? '已归档' : '进行中'
  const lines: string[] = [
    `# ${meta.title}`,
    '',
    `- 会话：\`${meta.id}\``,
    `- 模型：${meta.model}`,
    ...(meta.providerId ? [`- 供应商：${meta.providerId}`] : []),
    `- 视角：${meta.perspective ?? DEFAULT_PERSPECTIVE}`,
    `- 参演：${(meta.cast ?? []).join('、') || '（无）'}`,
    `- 回合：${meta.turn}`,
    `- 状态：${statusText}`,
    `- 创建：${meta.createdAt}`,
    `- 更新：${meta.updatedAt}`,
    '',
    '## 剧情',
    '',
  ]

  let currentTurn = -1
  for (const m of messages) {
    if (m.role === 'system') {
      lines.push(`> 系统：${m.text}`, '')
      continue
    }
    if (m.turn !== currentTurn) {
      currentTurn = m.turn
      const clock = clockOf(m.at)
      lines.push(`### 第 ${currentTurn + 1} 回合${clock ? ` · ${clock}` : ''}`, '')
    }
    if (m.role === 'director') {
      lines.push(`> **导演**：${m.text}`, '')
    } else if (m.role === 'narrative') {
      lines.push(m.text + (m.interrupted ? '（此回合生成被中断）' : ''), '')
    }
  }

  if (appendix.trim()) lines.push('', appendix.trim())

  return lines.join('\n')
}

export function readSession(
  root: string,
  id: string,
): { meta: SessionMeta; messages: MessageRecord[] } | null {
  const dir = sessionDir(root, id)
  if (!existsSync(path.join(dir, 'session.json')) || isLegacySession(dir)) return null
  const meta = readMeta(dir)
  return { meta, messages: readMessages(dir) }
}
