import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cardFileId, isCardId, isRecord, normalizeCard, type CharacterCard } from './character-card'

/** 卡库列表里的一行：只带展示需要的字段。 */
export interface CardSummary {
  id: string
  name: string
  tags: string[]
  creator: string
  description: string
  updatedAt: string
}

/** 保存语义：create 遇到同名报错；overwrite 覆盖同名；auto 自动加 `-2` 后缀。 */
export type SaveMode = 'create' | 'overwrite' | 'auto'

export class CardExistsError extends Error {
  constructor(readonly id: string) {
    super(`角色卡「${id}」已存在`)
    this.name = 'CardExistsError'
  }
}

export function charactersDir(workspace: string): string {
  return path.join(workspace, 'characters')
}

function cardFile(workspace: string, id: string): string {
  return path.join(charactersDir(workspace), `${id}.json`)
}

function tryRead(file: string): CharacterCard | null {
  try {
    return normalizeCard(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function readCard(workspace: string, id: string): CharacterCard | null {
  if (!isCardId(id)) return null
  const file = cardFile(workspace, id)
  return existsSync(file) ? tryRead(file) : null
}

/** 按 id 顺序读卡；缺失的跳过（调用方据此显示「角色缺失」）。 */
export function loadCards(workspace: string, ids: string[]): CharacterCard[] {
  const out: CharacterCard[] = []
  for (const id of ids) {
    const card = readCard(workspace, id)
    if (card) out.push(card)
  }
  return out
}

export function listCards(workspace: string): CardSummary[] {
  const dir = charactersDir(workspace)
  if (!existsSync(dir)) return []
  const out: CardSummary[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const id = entry.name.slice(0, -'.json'.length)
    const file = path.join(dir, entry.name)
    const card = tryRead(file)
    if (!card) continue
    out.push({
      id,
      name: card.data.name,
      tags: card.data.tags,
      creator: card.data.creator,
      description: card.data.description.slice(0, 160),
      updatedAt: statSync(file).mtime.toISOString(),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/**
 * 保存一张卡。id 由角色名清洗得出；同名卡按 mode 处理，
 * 文件名撞车（清洗后相同的不同名字）时统一顺延加 `-2`、`-3`。
 */
export function saveCard(
  workspace: string,
  raw: unknown,
  mode: SaveMode = 'create',
): { id: string; card: CharacterCard } {
  const card = normalizeCard(raw)
  const dir = charactersDir(workspace)
  mkdirSync(dir, { recursive: true })

  const base = cardFileId(card.data.name)
  let id = base
  let index = 2
  for (;;) {
    const file = path.join(dir, `${id}.json`)
    if (!existsSync(file)) break
    if (mode !== 'auto') {
      const existing = tryRead(file)
      if (existing?.data.name === card.data.name) {
        if (mode === 'overwrite') break
        throw new CardExistsError(id)
      }
    }
    id = `${base}-${index++}`
  }

  writeFileSync(cardFile(workspace, id), JSON.stringify(card, null, 2) + '\n', 'utf8')
  return { id, card }
}

/**
 * 按原 id 更新一张已有卡：把 patch 里的字段合并到现有 data 上，没提到的字段保留。
 * id 与文件名不变——改名只改 `data.name`，不迁移文件，避免打断已有会话的 cast 引用。
 * 卡不存在返回 null（工坊对话期间被删的情况）。
 */
export function updateCard(
  workspace: string,
  id: string,
  patch: unknown,
): { id: string; card: CharacterCard } | null {
  const existing = readCard(workspace, id)
  if (!existing) return null
  if (!isRecord(patch)) throw new Error('角色卡必须是 JSON 对象')
  const patchData = isRecord(patch.data) ? patch.data : patch
  const card = normalizeCard({ ...existing, data: { ...existing.data, ...patchData } })
  writeFileSync(cardFile(workspace, id), JSON.stringify(card, null, 2) + '\n', 'utf8')
  return { id, card }
}

export function deleteCard(workspace: string, id: string): boolean {
  if (!isCardId(id)) return false
  const file = cardFile(workspace, id)
  if (!existsSync(file)) return false
  rmSync(file, { force: true })
  return true
}

/** 哪些会话的 cast 引用了这张卡。删卡前用它提示「N 场戏在用」。 */
export function referencedBy(workspace: string, id: string): string[] {
  if (!existsSync(workspace)) return []
  const out: string[] = []
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'characters') continue
    const file = path.join(workspace, entry.name, 'session.json')
    if (!existsSync(file)) continue
    try {
      const meta = JSON.parse(readFileSync(file, 'utf8')) as { cast?: unknown }
      if (Array.isArray(meta.cast) && meta.cast.includes(id)) out.push(entry.name)
    } catch {
      // 坏会话跳过，不影响删卡。
    }
  }
  return out
}
