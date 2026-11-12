export interface CheckResult {
  attribute: string
  roll: number
  total: number
  dc: number
  success: boolean
}

export interface GameState {
  turn: number
  scene: string
  location: string
  stats: Record<string, number>
  inventory: string[]
  flags: Record<string, boolean>
  lastCheck: CheckResult | null
  ending: string | null
}

export type MessageRecord =
  | { role: 'player'; turn: number; at: string; text: string }
  | { role: 'engine'; turn: number; kind: 'text'; text: string }
  | { role: 'engine'; turn: number; kind: 'tool_call'; id: string; name: string; args: unknown }
  | { role: 'tool'; turn: number; callId: string; name: string; ok: boolean; result: unknown }
  | { role: 'engine'; turn: number; kind: 'options'; options: string[] }
  | { role: 'system'; kind: 'error'; text: string }

export type TurnEvent =
  | { type: 'turn_start'; turn: number }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; result: unknown }
  | { type: 'options'; options: string[] }
  | { type: 'state'; state: GameState }
  | { type: 'done'; turn: number }
  | { type: 'error'; message: string }
