import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export interface Scene {
  id: string
  name: string
  exits: string[]
}

export interface Ending {
  id: string
  trigger?: string
}

export interface EngineIdentity {
  name?: string
  tone?: string
  boundaries?: string[]
}

export interface World {
  engine?: EngineIdentity
  opening?: string
  scenes: Scene[]
  endings: Ending[]
  raw: string
}

export function loadWorld(dir: string): World {
  const file = path.join(dir, 'world.yaml')
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const data = (parse(raw) ?? {}) as Record<string, unknown>

  const scenes = Array.isArray(data.scenes)
    ? (data.scenes as Record<string, unknown>[]).map((s) => ({
        id: String(s.id ?? ''),
        name: String(s.name ?? s.id ?? ''),
        exits: Array.isArray(s.exits) ? (s.exits as unknown[]).map(String) : [],
      }))
    : []

  const endings = Array.isArray(data.endings)
    ? (data.endings as Record<string, unknown>[]).map((e) => ({
        id: String(e.id ?? ''),
        trigger: typeof e.trigger === 'string' ? e.trigger : undefined,
      }))
    : []

  return {
    engine: (data.engine as EngineIdentity | undefined) ?? undefined,
    opening: typeof data.opening === 'string' ? data.opening : undefined,
    scenes,
    endings,
    raw,
  }
}

export function sceneById(world: World, id: string): Scene | undefined {
  return world.scenes.find((s) => s.id === id)
}

export function sceneByRef(world: World, ref: string): Scene | undefined {
  return world.scenes.find((s) => s.id === ref || s.name === ref)
}
