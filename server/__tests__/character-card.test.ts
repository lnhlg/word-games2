import { describe, expect, it } from 'vitest'
import {
  cardFileId,
  extractCharaJson,
  normalizeCard,
  parseCardBuffer,
} from '../lib/character-card'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 拼一个假 chunk：4 字节长度 + 4 字节类型 + 数据 + 4 字节 CRC（解析器不校验 CRC）。 */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, data, Buffer.alloc(4)])
}

/** 造一张带 chara tEXt chunk 的 PNG。 */
function pngWithChara(json: string): Buffer {
  const text = Buffer.from('chara\0' + Buffer.from(json, 'utf8').toString('base64'), 'latin1')
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', text)])
}

describe('normalizeCard', () => {
  it('V2 卡以 data 为权威，补齐缺失字段并镜像到顶层', () => {
    const card = normalizeCard({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '沈砚',
        description: '旧书店老板',
        tags: ['民国', '克制'],
        first_mes: '灯还亮着。',
      },
    })
    expect(card.spec).toBe('chara_card_v2')
    expect(card.data.name).toBe('沈砚')
    expect(card.data.personality).toBe('')
    expect(card.data.tags).toEqual(['民国', '克制'])
    expect(card.name).toBe('沈砚')
    expect(card.description).toBe('旧书店老板')
    expect(card.first_mes).toBe('灯还亮着。')
  })

  it('V1 顶层卡升级成 V2，顶层未知字段原样保留', () => {
    const card = normalizeCard({
      name: '顾青',
      description: '修表匠',
      personality: '话少',
      custom_field: { keep: true },
    })
    expect(card.spec).toBe('chara_card_v2')
    expect(card.data.name).toBe('顾青')
    expect(card.data.personality).toBe('话少')
    expect(card.custom_field).toEqual({ keep: true })
  })

  it('缺 name 抛错', () => {
    expect(() => normalizeCard({ description: '无名氏' })).toThrow('角色卡缺少 name')
    expect(() => normalizeCard('不是对象')).toThrow('角色卡必须是 JSON 对象')
  })

  it('数组字段非数组时归空，character_book 原样保留', () => {
    const card = normalizeCard({
      name: '沈砚',
      tags: '民国',
      alternate_greetings: null,
      character_book: { entries: [] },
    })
    expect(card.data.tags).toEqual([])
    expect(card.data.alternate_greetings).toEqual([])
    expect(card.data.character_book).toEqual({ entries: [] })
  })
})

describe('cardFileId', () => {
  it('中文保留，非法字符换成短横线', () => {
    expect(cardFileId('沈砚/旧书房')).toBe('沈砚-旧书房')
    expect(cardFileId('a:b*c?')).toBe('a-b-c-')
  })

  it('去掉首尾的点和空白，内部空白折叠成一个空格', () => {
    expect(cardFileId('  .沈 砚.  ')).toBe('沈 砚')
  })

  it('空名回落成 character', () => {
    expect(cardFileId('   ')).toBe('character')
    expect(cardFileId('...')).toBe('character')
  })

  it('最长 64 个字符', () => {
    expect(Array.from(cardFileId('龙'.repeat(100))).length).toBe(64)
  })
})

describe('PNG chara chunk', () => {
  it('从 tEXt 里取出 base64 编码的 JSON', () => {
    const json = JSON.stringify({ name: '沈砚', description: '旧书店老板' })
    expect(extractCharaJson(pngWithChara(json))).toBe(json)
  })

  it('不是 PNG 或没有 chara chunk 时返回 null', () => {
    expect(extractCharaJson(Buffer.from('{"name":"沈砚"}'))).toBeNull()
    const plain = Buffer.concat([PNG_SIGNATURE, chunk('tEXt', Buffer.from('Comment\0hi', 'latin1'))])
    expect(extractCharaJson(plain)).toBeNull()
  })

  it('parseCardBuffer：PNG 走 chara，JSON 文件按 UTF-8 解析', () => {
    const fromPng = parseCardBuffer(pngWithChara('{"name":"沈砚"}'), 'card.png')
    expect(fromPng).toEqual({ name: '沈砚' })
    const fromJson = parseCardBuffer(Buffer.from('{"name":"顾青"}', 'utf8'), 'card.json')
    expect(fromJson).toEqual({ name: '顾青' })
  })

  it('PNG 没有 chara 数据时抛出可读错误', () => {
    expect(() => parseCardBuffer(Buffer.from('not a png'), 'card.png')).toThrow('chara')
  })
})
