import { describe, expect, it } from 'vitest'
import { splitParagraphs } from '../narrative'

describe('splitParagraphs 切自然段', () => {
  it('按空行切段，段内的软换行原样保留', () => {
    expect(splitParagraphs('雨落在檐角。\n她没有回头。\n\n门轴响了一声。')).toEqual([
      '雨落在檐角。\n她没有回头。',
      '门轴响了一声。',
    ])
  })

  it('连续空行（含只有空白的空行）只切一次', () => {
    expect(splitParagraphs('第一段。\n\n  \n\n第二段。')).toEqual(['第一段。', '第二段。'])
  })

  it('剥掉模型自带的段首缩进：全角空格、半角空格与制表符', () => {
    expect(splitParagraphs('\u3000\u3000他推开门。\n\n  灯还亮着。\n\n\t桌上有茶。')).toEqual([
      '他推开门。',
      '灯还亮着。',
      '桌上有茶。',
    ])
  })

  it('统一 CRLF，忽略纯空白段', () => {
    expect(splitParagraphs('甲。\r\n\r\n乙。\r\n\r\n\r\n')).toEqual(['甲。', '乙。'])
  })

  it('空正文与纯空白正文都返回空数组', () => {
    expect(splitParagraphs('')).toEqual([])
    expect(splitParagraphs(' \n\n\u3000')).toEqual([])
  })
})
