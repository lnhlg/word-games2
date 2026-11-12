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
      /** 正文写完后生成的后续剧情选项。 */
      nextOptions?: string[]
    }
  | { role: 'system'; at: string; kind: 'error'; text: string }

export type TurnEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; turn: number }
  | { type: 'next_options'; turn: number; options: string[] }
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
