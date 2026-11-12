import type { GameState } from './session-fs'
import { excerptTurns, searchMemories, type MemoryRecord } from './memory'
import { sceneByRef, type World } from './world'

export const TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'move_to',
      description: '移动到某个场景，校验当前场景的出口',
      parameters: {
        type: 'object',
        properties: { scene: { type: 'string', description: '目标场景 id 或名称' } },
        required: ['scene'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_flag',
      description: '设置一个剧情旗标',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'boolean', description: '默认 true' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_item',
      description: '往背包里加一件物品',
      parameters: {
        type: 'object',
        properties: { item: { type: 'string' } },
        required: ['item'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_item',
      description: '从背包里移除一件物品',
      parameters: {
        type: 'object',
        properties: { item: { type: 'string' } },
        required: ['item'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'roll_check',
      description: '属性判定：d6 + 属性 对比 dc，结果写入 lastCheck',
      parameters: {
        type: 'object',
        properties: {
          attribute: { type: 'string', enum: ['洞察', '胆识', '共情'] },
          dc: { type: 'number', description: '难度阈值' },
        },
        required: ['attribute', 'dc'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_lore',
      description: '查问世界设定（从 world.yaml 取相关段落）',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall',
      description: '回忆更早的剧情：按关键词搜索记忆索引，或按回合范围直接取回原文',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要回忆的关键词、场景或人物' },
          turns: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
            description: '可选：直接指定回合范围 [起, 止]（0 基，闭区间）',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'trigger_ending',
      description: '触发一个结局，会话状态转为已结束',
      parameters: {
        type: 'object',
        properties: { ending: { type: 'string', description: '结局 id 或描述' } },
        required: ['ending'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'end_turn',
      description: '结束本回合：给出叙事文本与 2–4 个建议行动',
      parameters: {
        type: 'object',
        properties: {
          narrative: { type: 'string', description: '本回合的叙事收束' },
          options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
          status: { type: 'string', description: '可选：active 或 ended' },
        },
        required: ['narrative', 'options'],
        additionalProperties: false,
      },
    },
  },
]

export interface ToolContext {
  world: World
  state: GameState
  dir: string
  memories: MemoryRecord[]
}

export interface ToolOutcome {
  ok: boolean
  result: unknown
  ended?: boolean
  options?: string[]
  narrative?: string
}

function fail(error: string): ToolOutcome {
  return { ok: false, result: { error } }
}

export function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  const args = (rawArgs ?? {}) as Record<string, unknown>
  const state = ctx.state

  switch (name) {
    case 'move_to': {
      const ref = String(args.scene ?? '')
      const target = sceneByRef(ctx.world, ref)
      if (!target) return fail(`场景不存在：${ref}`)
      const current = sceneByRef(ctx.world, state.location) ?? sceneByRef(ctx.world, state.scene)
      if (current && current.exits.length > 0 && !current.exits.includes(target.id)) {
        return fail(`从 ${current.name} 不能直接去 ${target.name}；出口：${current.exits.join(', ')}`)
      }
      state.location = target.id
      state.scene = target.name
      return { ok: true, result: { scene: target.name, location: target.id } }
    }

    case 'set_flag': {
      const key = String(args.name ?? '')
      if (!key) return fail('缺少旗标名')
      state.flags[key] = args.value === undefined ? true : Boolean(args.value)
      return { ok: true, result: { [key]: state.flags[key] } }
    }

    case 'add_item': {
      const item = String(args.item ?? '')
      if (!item) return fail('缺少物品名')
      if (!state.inventory.includes(item)) state.inventory.push(item)
      return { ok: true, result: { inventory: state.inventory } }
    }

    case 'remove_item': {
      const item = String(args.item ?? '')
      if (!state.inventory.includes(item)) return fail(`背包里没有 ${item}`)
      state.inventory = state.inventory.filter((i) => i !== item)
      return { ok: true, result: { inventory: state.inventory } }
    }

    case 'roll_check': {
      const attribute = String(args.attribute ?? '')
      const dc = Number(args.dc ?? 0)
      if (!(attribute in state.stats)) return fail(`属性不存在：${attribute}`)
      if (!Number.isFinite(dc) || dc <= 0) return fail('dc 必须是正数')
      const roll = Math.floor(Math.random() * 6) + 1
      const total = roll + state.stats[attribute]
      const success = total >= dc
      state.lastCheck = { attribute, roll, total, dc, success }
      return { ok: true, result: { ...state.lastCheck } }
    }

    case 'lookup_lore': {
      const query = String(args.query ?? '').trim()
      if (!query) return fail('缺少查询词')
      const hits = ctx.world.raw
        .split('\n')
        .filter((line) => line.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8)
        .join('\n')
      return { ok: true, result: { found: hits.length > 0, text: hits } }
    }

    case 'recall': {
      const range = Array.isArray(args.turns) ? args.turns.map(Number) : null
      if (range && range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
        const turns: [number, number] = [range[0], range[1]]
        return { ok: true, result: { turns, excerpt: excerptTurns(ctx.dir, turns) } }
      }
      const query = String(args.query ?? '').trim()
      if (!query) return fail('需要 query 或 turns')
      const hits = searchMemories(ctx.dir, ctx.memories, query)
      if (!hits.length) {
        return {
          ok: true,
          result: { found: false, query, hint: '没有命中记忆；可以换更宽泛的词，或用 turns 指定回合范围' },
        }
      }
      return { ok: true, result: { found: true, query, hits } }
    }

    case 'trigger_ending': {
      const ending = String(args.ending ?? '')
      if (!ending) return fail('缺少结局标识')
      state.ending = ending
      return { ok: true, result: { ending }, ended: true }
    }

    case 'end_turn': {
      const narrative = String(args.narrative ?? '')
      const rawOptions = Array.isArray(args.options) ? args.options.map(String) : []
      const options = rawOptions.slice(0, 4)
      if (options.length < 2) return fail('options 至少 2 个')
      return { ok: true, result: { options }, ended: true, options, narrative }
    }

    default:
      return fail(`未知工具：${name}`)
  }
}
