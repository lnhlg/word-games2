import type { MessageRecord } from './types'

/**
 * 最后一条非 system 记录所属的回合；与后端 `server/lib/session-fs.ts` 的 `lastTurnOf` 同义。
 * 生成失败时不占回合号，大纲的回合号会比 `meta.turn - 1` 多出一格；
 * 这条只剩大纲的回合仍是最后一回合，界面上照样给重新生成与删除。
 * `pending` 表示这一回合还没有情节。
 */
export function lastTurnOf(messages: MessageRecord[]): { turn: number; pending: boolean } | null {
  let last: Exclude<MessageRecord, { role: 'system' }> | null = null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'system') {
      last = message
      break
    }
  }
  if (!last) return null
  return {
    turn: last.turn,
    pending: !messages.some((message) => message.role === 'narrative' && message.turn === last.turn),
  }
}

/** 最后一条导演大纲在 messages 里的下标；没有导演记录时 -1。 */
export function lastDirectorIndex(messages: MessageRecord[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'director') return i
  }
  return -1
}
