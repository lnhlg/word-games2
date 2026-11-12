import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { writeMeta, type SessionMeta, type StatusItem, type StatusTemplate } from './session-fs'

/**
 * 角色状态：模板在 session.json，值变更流在 status.jsonl。
 * 当前值不落盘，靠重放变更流得出——这样删除/重新生成回合时只要丢尾部记录即可回滚。
 * 决策见 docs/adr/0002-character-status.md。
 */

/** 每个角色最多 8 条状态项；超出的新增提议直接丢弃。 */
export const MAX_STATUS_ITEMS = 8

/** 会话详情里带的「最近变化」条数，够界面显示依据与「新」标记。 */
const RECENT_LIMIT = 20

export interface StatusValue {
  name: string
  value: string
}

/** 一次值变化：属于哪一回合、改的是谁、从什么变成什么、依据是什么。 */
export interface StatusChange {
  cardId: string
  item: string
  from: string
  to: string
  basis: string
}

export interface StatusRecord {
  /** 0 基回合号；null 表示不属于任何回合（删除条目的清空记录）。 */
  turn: number | null
  at: string
  source: 'ai' | 'manual'
  changes: StatusChange[]
  /** 本次由 AI 提议并落进模板的新条目，界面据此标「新」。 */
  added?: Array<{ cardId: string; name: string; note: string }>
}

export interface StatusView {
  template: StatusTemplate
  /** 模板的完整投影：每个模板项一条，没有取过值的 value 为空串。 */
  values: Record<string, StatusValue[]>
  /** 最近的变化，最新在前。 */
  recent: StatusRecord[]
}

export function statusFile(dir: string): string {
  return path.join(dir, 'status.jsonl')
}

export function readStatusRecords(dir: string): StatusRecord[] {
  const file = statusFile(dir)
  if (!existsSync(file)) return []
  const out: StatusRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Partial<StatusRecord>
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.changes)) {
        out.push(parsed as StatusRecord)
      }
    } catch {
      // 坏行跳过，不阻塞会话。
    }
  }
  return out
}

function appendStatusRecord(dir: string, record: StatusRecord): void {
  appendFileSync(statusFile(dir), JSON.stringify(record) + '\n', 'utf8')
}

/** 原地重写：先写临时文件再 rename，和 messages.jsonl 用同一套原子写。 */
function writeStatusRecords(dir: string, records: StatusRecord[]): void {
  const file = statusFile(dir)
  const tmp = `${file}.tmp`
  const body = records.map((record) => JSON.stringify(record)).join('\n')
  writeFileSync(tmp, records.length ? `${body}\n` : '', 'utf8')
  renameSync(tmp, file)
}

/** 当前值 = 从空开始重放全部记录；模板里已经删掉的条目直接丢弃。 */
export function replayValues(
  template: StatusTemplate,
  records: StatusRecord[],
): Record<string, StatusValue[]> {
  const current: Record<string, Record<string, string>> = {}
  for (const record of records) {
    for (const change of record.changes) {
      if (!template[change.cardId]?.some((item) => item.name === change.item)) continue
      ;(current[change.cardId] ??= {})[change.item] = change.to
    }
  }
  const out: Record<string, StatusValue[]> = {}
  for (const [cardId, items] of Object.entries(template)) {
    out[cardId] = items.map((item) => ({ name: item.name, value: current[cardId]?.[item.name] ?? '' }))
  }
  return out
}

export function statusView(dir: string, meta: SessionMeta): StatusView {
  const template = meta.statusTemplate ?? {}
  const records = readStatusRecords(dir)
  return {
    template,
    values: replayValues(template, records),
    recent: records.slice(-RECENT_LIMIT).reverse(),
  }
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** 一组状态项归一化：名称非空、去重、截断到上限。模板库与会话内模板共用。 */
export function normalizeItems(raw: unknown): StatusItem[] {
  if (!Array.isArray(raw)) return []
  const items: StatusItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const name = clampText((entry as { name?: unknown }).name, 12)
    if (!name || items.some((item) => item.name === name)) continue
    if (items.length >= MAX_STATUS_ITEMS) break
    items.push({ name, note: clampText((entry as { note?: unknown }).note, 60) })
  }
  return items
}

/** 模板归一化：名称非空、同角色内去重、每角色截断到上限。 */
export function normalizeTemplate(raw: unknown): StatusTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: StatusTemplate = {}
  for (const [cardId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!cardId.trim()) continue
    const items = normalizeItems(value)
    if (items.length) out[cardId] = items
  }
  return out
}

/**
 * 整份替换模板。被删掉的条目如果还有值，补一条清空记录，
 * 免得以后同名条目加回来时旧值意外复活。
 */
export function saveStatusTemplate(dir: string, meta: SessionMeta, raw: unknown): SessionMeta {
  const before = meta.statusTemplate ?? {}
  const template = normalizeTemplate(raw)
  const now = new Date().toISOString()

  const records = readStatusRecords(dir)
  const values = replayValues(before, records)
  const cleared: StatusChange[] = []
  for (const [cardId, items] of Object.entries(values)) {
    const nextNames = new Set((template[cardId] ?? []).map((item) => item.name))
    for (const value of items) {
      if (!nextNames.has(value.name) && value.value !== '') {
        cleared.push({ cardId, item: value.name, from: value.value, to: '', basis: '条目已删除' })
      }
    }
  }
  if (cleared.length) {
    appendStatusRecord(dir, { turn: null, at: now, source: 'manual', changes: cleared })
  }

  const next: SessionMeta = { ...meta, updatedAt: now }
  if (Object.keys(template).length) next.statusTemplate = template
  else delete next.statusTemplate
  writeMeta(dir, next)
  return next
}

/** 导演手改一个值；条目不存在返回 null。值没变化就不记账。 */
export function setStatusValue(
  dir: string,
  meta: SessionMeta,
  input: { cardId: string; item: string; value: string; turn: number | null },
): StatusView | null {
  const template = meta.statusTemplate ?? {}
  const items = template[input.cardId]
  if (!items || !items.some((item) => item.name === input.item)) return null

  const records = readStatusRecords(dir)
  const current = replayValues(template, records)[input.cardId]?.find(
    (value) => value.name === input.item,
  )
  const from = current?.value ?? ''
  const to = clampText(input.value, 60)
  if (from === to) return statusView(dir, meta)

  appendStatusRecord(dir, {
    turn: input.turn,
    at: new Date().toISOString(),
    source: 'manual',
    changes: [{ cardId: input.cardId, item: input.item, from, to, basis: '导演手改' }],
  })
  return statusView(dir, meta)
}

/** 模型一次更新里带来的东西；字段缺失就是没有。 */
export interface AiStatusInput {
  /** 改已有条目的值。 */
  changes?: Array<{ character: string; item: string; value: string; basis?: string }>
  /** 剧情里新冒出来的维度；带上此刻的取值。 */
  newItems?: Array<{ character: string; item: string; value: string; basis?: string; note?: string }>
}

export interface ApplyStatusResult {
  meta: SessionMeta
  view: StatusView
  changed: boolean
}

/**
 * 把模型给出的绝对值落盘：改值 + 可提议新增条目，但不能删条目。
 * 条目已满、名字重复、角色对不上的提议一律静默丢弃。
 */
export function applyAiStatus(
  dir: string,
  meta: SessionMeta,
  turn: number,
  input: AiStatusInput,
  nameToId: Record<string, string>,
): ApplyStatusResult {
  const template: StatusTemplate = JSON.parse(JSON.stringify(meta.statusTemplate ?? {})) as StatusTemplate
  const records = readStatusRecords(dir)
  const before = replayValues(template, records)
  const changes: StatusChange[] = []
  const added: Array<{ cardId: string; name: string; note: string }> = []

  for (const item of input.changes ?? []) {
    const cardId = nameToId[String(item.character ?? '').trim()]
    if (!cardId || !template[cardId]?.some((entry) => entry.name === item.item)) continue
    const from = before[cardId]?.find((value) => value.name === item.item)?.value ?? ''
    const to = clampText(item.value, 60)
    if (!to || to === from) continue
    changes.push({ cardId, item: item.item, from, to, basis: clampText(item.basis, 60) })
  }

  for (const item of input.newItems ?? []) {
    const cardId = nameToId[String(item.character ?? '').trim()]
    if (!cardId) continue
    const items = template[cardId] ?? []
    const name = clampText(item.item, 12)
    if (!name || items.length >= MAX_STATUS_ITEMS || items.some((entry) => entry.name === name)) continue
    const to = clampText(item.value, 60)
    if (!to) continue
    const note = clampText(item.note, 60)
    items.push({ name, note })
    template[cardId] = items
    added.push({ cardId, name, note })
    changes.push({ cardId, item: name, from: '', to, basis: clampText(item.basis, 60) })
  }

  if (!changes.length) return { meta, view: statusView(dir, meta), changed: false }

  let nextMeta = meta
  if (added.length) {
    nextMeta = { ...meta, updatedAt: new Date().toISOString(), statusTemplate: template }
    writeMeta(dir, nextMeta)
  }
  appendStatusRecord(dir, {
    turn,
    at: new Date().toISOString(),
    source: 'ai',
    changes,
    ...(added.length ? { added } : {}),
  })
  return { meta: nextMeta, view: statusView(dir, nextMeta), changed: true }
}

/** 丢弃某一回合及之后的状态记录（删除最后一回合时用）；不属于回合的记录保留。 */
export function rollbackStatus(dir: string, turn: number): void {
  const records = readStatusRecords(dir)
  const kept = records.filter((record) => record.turn === null || record.turn < turn)
  if (kept.length !== records.length) writeStatusRecords(dir, kept)
}

/** 只丢掉某一回合的状态记录（重新生成最后一回合时用）。 */
export function clearTurnStatus(dir: string, turn: number): void {
  const records = readStatusRecords(dir)
  const kept = records.filter((record) => record.turn !== turn)
  if (kept.length !== records.length) writeStatusRecords(dir, kept)
}

/** 导出 Markdown 的附录：只列有状态的条目，不打断正文。 */
export function statusMarkdown(view: StatusView, names: Record<string, string> = {}): string {
  const blocks: string[] = []
  for (const [cardId, values] of Object.entries(view.values)) {
    if (!values.length) continue
    blocks.push(
      `- ${names[cardId] ?? cardId}：${values.map((value) => `${value.name} ${value.value || '未定'}`).join('；')}`,
    )
  }
  if (!blocks.length) return ''
  return `## 角色状态\n\n${blocks.join('\n')}\n`
}
