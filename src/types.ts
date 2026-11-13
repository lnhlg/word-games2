/** 与后端 server/lib/character-card.ts 对应的展示类型（前端只读，不做归一化）。 */
export interface CharacterCardData {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  alternate_greetings: string[]
  tags: string[]
  creator: string
  character_version: string
  extensions: Record<string, unknown>
  character_book?: unknown
}

export interface CharacterCard {
  spec: string
  spec_version: string
  data: CharacterCardData
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  [extra: string]: unknown
}

export interface CardSummary {
  id: string
  name: string
  tags: string[]
  creator: string
  description: string
  updatedAt: string
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

/** 一个状态项：看什么。值与模板分开，值在 status.jsonl 里。 */
export interface StatusItem {
  name: string
  note: string
}

/** 一场戏里每个角色的状态项清单，键是角色卡 id。 */
export type StatusTemplate = Record<string, StatusItem[]>

export interface StatusValue {
  name: string
  value: string
}

export interface StatusChange {
  cardId: string
  item: string
  from: string
  to: string
  basis: string
}

export interface StatusRecord {
  /** 0 基回合号；null 表示不属于任何回合（删条目的清空记录）。 */
  turn: number | null
  at: string
  source: 'ai' | 'manual'
  changes: StatusChange[]
  added?: Array<{ cardId: string; name: string; note: string }>
}

export interface StatusView {
  template: StatusTemplate
  /** 模板的完整投影：每个模板项一条，没取过值的 value 为空串。 */
  values: Record<string, StatusValue[]>
  /** 最近的变化，最新在前。 */
  recent: StatusRecord[]
}

/** 模板库列表里的一行。 */
export interface TemplateSummary {
  id: string
  name: string
  note: string
  itemCount: number
  updatedAt: string
}

/** 模板库里的一份模板；套到角色上时是快照复制。 */
export interface TemplateDoc {
  id: string
  name: string
  note: string
  items: StatusItem[]
  createdAt: string
  updatedAt: string
}

export type TurnEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; turn: number }
  | { type: 'next_options'; turn: number; options: string[] }
  | { type: 'status_update'; turn: number; status: StatusView }
  | { type: 'error'; message: string }

export interface StudioMessage {
  role: 'user' | 'assistant'
  content: string
}

export type StudioEvent =
  | { type: 'delta'; text: string }
  | { type: 'card_saved'; id: string; card: CharacterCard }
  | { type: 'done' }
  | { type: 'error'; message: string }
