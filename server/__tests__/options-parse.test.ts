import { describe, expect, it } from 'vitest'
import { parseOptions } from '../lib/options'

describe('parseOptions：模型输出格式的容错', () => {
  it('标准 JSON', () => {
    expect(parseOptions('{"options":["追出去","锁上门","问她从哪来"]}')).toEqual([
      '追出去',
      '锁上门',
      '问她从哪来',
    ])
  })

  it('JSON 被代码块包住', () => {
    expect(parseOptions('```json\n{"options":["追出去","锁上门","问她从哪来"]}\n```')).toEqual([
      '追出去',
      '锁上门',
      '问她从哪来',
    ])
  })

  it('裸数组', () => {
    expect(parseOptions('["追出去","锁上门"]')).toEqual(['追出去', '锁上门'])
  })

  it('选项被引号或书名号包住时剥掉外层', () => {
    expect(parseOptions('{"options":["「追出去」","“锁上门”"]}')).toEqual(['追出去', '锁上门'])
  })

  it('模型用编号列表时按行兜底', () => {
    const text = [
      '接下来可以这么演：',
      '1. 追出去看看门外是谁',
      '2. 先把门锁好再说话',
      '3. 问她这一路从哪来',
    ].join('\n')
    expect(parseOptions(text)).toEqual([
      '追出去看看门外是谁',
      '先把门锁好再说话',
      '问她这一路从哪来',
    ])
  })

  it('解释文字不足两条时不算选项', () => {
    expect(parseOptions('好的，我想想接下来可以怎么演：')).toEqual([])
  })

  it('空输出', () => {
    expect(parseOptions('')).toEqual([])
  })
})
