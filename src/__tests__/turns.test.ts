import { describe, expect, it } from 'vitest'
import { lastDirectorIndex, lastTurnOf } from '../turns'
import type { MessageRecord } from '../types'

const at = '2026-11-12T00:00:00.000Z'
const director = (turn: number, text: string): MessageRecord => ({ role: 'director', turn, at, text })
const narrative = (turn: number, text: string): MessageRecord => ({ role: 'narrative', turn, at, text })
const error = (text: string): MessageRecord => ({ role: 'system', at, kind: 'error', text })

describe('lastTurnOf：最后一条非系统记录所属的回合', () => {
  it('没有消息时返回 null', () => {
    expect(lastTurnOf([])).toBeNull()
    expect(lastTurnOf([error('上游 500')])).toBeNull()
  })

  it('正常回合：回合号是最后一条情节的回合号，pending 为 false', () => {
    const messages = [director(0, '开场'), narrative(0, '正文'), director(1, '第二幕'), narrative(1, '正文二')]
    expect(lastTurnOf(messages)).toEqual({ turn: 1, pending: false })
  })

  it('生成失败：最后一条是系统错误，往上取到大纲，pending 为 true', () => {
    const messages = [director(0, '开场'), narrative(0, '正文'), director(1, '第二幕'), error('上游 500')]
    expect(lastTurnOf(messages)).toEqual({ turn: 1, pending: true })
  })

  it('失败发生在第一回合时也能取到回合 0', () => {
    expect(lastTurnOf([director(0, '开场'), error('上游 500')])).toEqual({ turn: 0, pending: true })
  })
})

describe('lastDirectorIndex：最后一条导演大纲的下标', () => {
  it('失败后最后一条是系统错误，仍指向那条大纲', () => {
    const messages = [director(0, '开场'), narrative(0, '正文'), director(1, '第二幕'), error('上游 500')]
    expect(lastDirectorIndex(messages)).toBe(2)
  })

  it('没有导演记录时返回 -1', () => {
    expect(lastDirectorIndex([])).toBe(-1)
    expect(lastDirectorIndex([error('上游 500')])).toBe(-1)
  })
})
