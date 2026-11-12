import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Workspace {
  path: string
  name: string
  lastOpenedAt: string
}

export interface Registry {
  workspaces: Workspace[]
  current: string | null
}

/** 工作区注册表放在应用数据目录，不污染玩家自己的目录。 */
export function stateDir(): string {
  return process.env.APP_DATA_DIR
    ? path.resolve(process.env.APP_DATA_DIR)
    : path.join(os.homedir(), '.word-games')
}

function registryFile(): string {
  return path.join(stateDir(), 'workspaces.json')
}

export function loadRegistry(): Registry {
  const file = registryFile()
  if (!existsSync(file)) return { workspaces: [], current: null }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<Registry>
    return {
      workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
      current: typeof data.current === 'string' ? data.current : null,
    }
  } catch {
    return { workspaces: [], current: null }
  }
}

export function saveRegistry(registry: Registry): void {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(registryFile(), JSON.stringify(registry, null, 2) + '\n', 'utf8')
}

/** 打开（或重新打开）一个已有目录，并把它设为当前工作区。 */
export function openWorkspace(input: string): Workspace {
  const resolved = path.resolve(input)
  if (!existsSync(resolved)) throw new Error(`目录不存在：${resolved}`)
  if (!statSync(resolved).isDirectory()) throw new Error(`不是目录：${resolved}`)

  const registry = loadRegistry()
  const now = new Date().toISOString()
  const existing = registry.workspaces.find((w) => w.path === resolved)
  const workspace: Workspace = existing
    ? { ...existing, lastOpenedAt: now }
    : { path: resolved, name: path.basename(resolved) || resolved, lastOpenedAt: now }

  registry.workspaces = [workspace, ...registry.workspaces.filter((w) => w.path !== resolved)]
  registry.current = resolved
  saveRegistry(registry)
  return workspace
}

export function removeWorkspace(input: string): void {
  const resolved = path.resolve(input)
  const registry = loadRegistry()
  registry.workspaces = registry.workspaces.filter((w) => w.path !== resolved)
  if (registry.current === resolved) registry.current = registry.workspaces[0]?.path ?? null
  saveRegistry(registry)
}
