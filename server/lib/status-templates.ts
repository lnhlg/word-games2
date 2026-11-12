import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cardFileId, isCardId, isRecord } from './character-card'
import type { StatusItem } from './session-fs'
import { normalizeItems } from './status'

/**
 * 工作区级的状态模板库：一份可复用的状态项清单，存在 <workspace>/status-templates/<id>.json。
 * 会话套用模板时是**快照**——把条目复制进这场戏，之后各改各的（见 docs/adr/0003）。
 */

export const TEMPLATES_DIR = 'status-templates'

export interface TemplateSummary {
  id: string
  name: string
  note: string
  itemCount: number
  updatedAt: string
}

/** 一份模板文件的内容；id 与文件名一致。 */
export interface TemplateDoc {
  id: string
  name: string
  note: string
  items: StatusItem[]
  createdAt: string
  updatedAt: string
}

export class TemplateExistsError extends Error {
  constructor(readonly id: string) {
    super(`状态模板「${id}」已存在`)
    this.name = 'TemplateExistsError'
  }
}

export function templatesDir(workspace: string): string {
  return path.join(workspace, TEMPLATES_DIR)
}

function templateFile(workspace: string, id: string): string {
  return path.join(templatesDir(workspace), `${id}.json`)
}

function tryRead(file: string): TemplateDoc | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const items = normalizeItems(raw.items)
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
    if (!name) return null
    return {
      id: path.basename(file, '.json'),
      name,
      note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '',
      items,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function readTemplate(workspace: string, id: string): TemplateDoc | null {
  if (!isCardId(id)) return null
  const file = templateFile(workspace, id)
  return existsSync(file) ? tryRead(file) : null
}

export function listTemplates(workspace: string): TemplateSummary[] {
  const dir = templatesDir(workspace)
  if (!existsSync(dir)) return []
  const out: TemplateSummary[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const file = path.join(dir, entry.name)
    const doc = tryRead(file)
    if (!doc) continue
    out.push({
      id: doc.id,
      name: doc.name,
      note: doc.note,
      itemCount: doc.items.length,
      updatedAt: statSync(file).mtime.toISOString(),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

function normalizeDoc(raw: unknown, id: string): TemplateDoc {
  if (!isRecord(raw)) throw new Error('状态模板必须是 JSON 对象')
  const source = isRecord(raw.template) ? raw.template : raw
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (!name) throw new Error('状态模板缺少 name')
  return {
    id,
    name: name.slice(0, 40),
    note: typeof source.note === 'string' ? source.note.trim().slice(0, 200) : '',
    items: normalizeItems(source.items),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** 新建模板：id 由名称清洗得出；同名按 overwrite 决定报错还是覆盖。 */
export function createTemplate(
  workspace: string,
  raw: unknown,
  overwrite = false,
): { id: string; template: TemplateDoc } {
  if (!isRecord(raw) && !isRecord((raw as { template?: unknown })?.template)) {
    throw new Error('状态模板必须是 JSON 对象')
  }
  const source = isRecord((raw as { template?: unknown })?.template) ? (raw as { template: unknown }).template : raw
  const name = isRecord(source) && typeof source.name === 'string' ? source.name.trim() : ''
  if (!name) throw new Error('状态模板缺少 name')

  const dir = templatesDir(workspace)
  mkdirSync(dir, { recursive: true })

  const base = cardFileId(name)
  let id = base
  if (existsSync(templateFile(workspace, id)) && !overwrite) throw new TemplateExistsError(id)

  const doc = normalizeDoc(source, id)
  writeFileSync(templateFile(workspace, id), JSON.stringify(doc, null, 2) + '\n', 'utf8')
  return { id, template: doc }
}

/** 按原 id 更新：没提到的字段保留；改名不改文件名。 */
export function updateTemplate(
  workspace: string,
  id: string,
  patch: unknown,
): { id: string; template: TemplateDoc } | null {
  const existing = readTemplate(workspace, id)
  if (!existing) return null
  if (!isRecord(patch)) throw new Error('状态模板必须是 JSON 对象')
  const source = isRecord(patch.template) ? patch.template : patch
  const merged = {
    ...existing,
    ...(typeof source.name === 'string' ? { name: source.name } : {}),
    ...(typeof source.note === 'string' ? { note: source.note } : {}),
    ...(source.items !== undefined ? { items: source.items } : {}),
  }
  const doc = normalizeDoc(merged, id)
  // 保留原创建时间。
  doc.createdAt = existing.createdAt
  writeFileSync(templateFile(workspace, id), JSON.stringify(doc, null, 2) + '\n', 'utf8')
  return { id, template: doc }
}

export function deleteTemplate(workspace: string, id: string): boolean {
  if (!isCardId(id)) return false
  const file = templateFile(workspace, id)
  if (!existsSync(file)) return false
  rmSync(file, { force: true })
  return true
}
