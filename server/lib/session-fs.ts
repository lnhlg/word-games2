import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface SessionMeta {
  id: string
  title: string
  model: string
  createdAt: string
  updatedAt: string
  turn: number
  status: 'active' | 'ended' | 'archived'
}

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'deepseek-chat'

const DEFAULT_WORLD = `engine:
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

const DEFAULT_STATE = {
  turn: 0,
  scene: '门厅',
  location: 'hallway',
  stats: { 洞察: 2, 胆识: 2, 共情: 2 },
  inventory: [] as string[],
  flags: {} as Record<string, boolean>,
  lastCheck: null,
  ending: null,
}

const DEFAULT_AGENT = `# AGENT.md

你正在主持一局互动小说。这份文件由玩家自由编写，引擎不会解析它的结构。

可以写：叙事风格、禁忌、节奏要求、语言习惯。
模型专属指令请放在 \`<模型名>.md\` 里（存在时优先于本文件）。
`

const pad = (n: number) => String(n).padStart(2, '0')

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
    model: DEFAULT_MODEL,
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

export function readSession(root: string, id: string): { meta: SessionMeta; messages: unknown[] } | null {
  const dir = path.join(root, id)
  const file = path.join(dir, 'session.json')
  if (!existsSync(file)) return null
  const meta = JSON.parse(readFileSync(file, 'utf8')) as SessionMeta
  const msgFile = path.join(dir, 'messages.jsonl')
  const messages = existsSync(msgFile)
    ? readFileSync(msgFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
  return { meta, messages }
}
