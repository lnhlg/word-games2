import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner } from '../lib/llm'
import { memoryFile } from '../lib/memory'
import { setOptionsRunner } from '../lib/options'
import { cleanRewrite } from '../lib/rewrite'
import { locateSelection } from '../lib/selection'
import { readMessages, sessionDir } from '../lib/session-fs'

let root: string
let sessionId: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

function fakeLlm(script: Array<{ text?: string; fail?: string }>) {
  let step = 0
  return async function* () {
    const current = script[step] ?? { text: '（脚本结束）' }
    step += 1
    if (current.text) yield { type: 'delta' as const, text: current.text }
    if (current.fail) throw new Error(current.fail)
    yield { type: 'done' as const, finishReason: 'stop' }
  }
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-selection-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  process.env.PROVIDERS_FILE = path.join(root, 'providers.json')
  const created = await app.request(`/api/sessions${q(root)}`, { method: 'POST' })
  sessionId = ((await created.json()) as { session: { id: string } }).session.id
  setOptionsRunner(async () => [])
})

afterEach(() => {
  setLlmRunner(null)
  setOptionsRunner(null)
  delete process.env.PROVIDERS_FILE
  delete process.env.DEFAULT_MODEL
})

const dirOf = () => sessionDir(root, sessionId)

async function postTurn(input: string) {
  return app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  })
}

async function rewrite(turn: number, body: Record<string, unknown>) {
  return app.request(`/api/sessions/${sessionId}/turns/${turn}/rewrite${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function narrativeText(turn = 0): string {
  return (
    readMessages(dirOf()).find((message) => message.role === 'narrative' && message.turn === turn)
      ?.text ?? ''
  )
}

describe('locateSelection：把界面选区映射回原文区间', () => {
  it('唯一出现时直接定位', () => {
    expect(locateSelection({ text: '雨停了，檐角还在滴水。', selected: '檐角还在滴水。' })).toEqual({
      start: 4,
      end: 11,
    })
  })

  it('界面文本与原文的空白、段首缩进不同也能对上', () => {
    const text = '　　雨停了，檐角还在滴水。\n\n　　他吹了灯。'
    expect(
      locateSelection({ text, selected: '檐角还在滴水。\n他吹了灯。', before: '雨停了，' }),
    ).toEqual({ start: 6, end: 22 })
  })

  it('同一句出现多次时用前后文消歧', () => {
    const text = '他笑了。雨停了。他笑了。'
    expect(locateSelection({ text, selected: '他笑了。', after: '雨停了。' })).toEqual({
      start: 0,
      end: 4,
    })
    expect(locateSelection({ text, selected: '他笑了。', before: '雨停了。' })).toEqual({
      start: 8,
      end: 12,
    })
  })

  it('分不出是哪一处就放弃', () => {
    expect(locateSelection({ text: '他笑了。他笑了。', selected: '他笑了。' })).toBeNull()
    expect(locateSelection({ text: '他笑了。', selected: '没说过的话' })).toBeNull()
  })
})

describe('cleanRewrite：剥掉模型加的外壳', () => {
  it('剥掉整段包裹的引号与前缀行', () => {
    expect(cleanRewrite('“檐角仍在滴水。”')).toBe('檐角仍在滴水。')
    expect(cleanRewrite('改写后：檐角仍在滴水。')).toBe('檐角仍在滴水。')
    expect(cleanRewrite('  **檐角仍在滴水。**  ')).toBe('檐角仍在滴水。')
  })

  it('本来是对话的引号不剥', () => {
    expect(cleanRewrite('“雨停了。”他说。')).toBe('“雨停了。”他说。')
  })
})

describe('选区改写：只重写选中的一小段', () => {
  it('替换选中的那一段，其余原文不动，标为已编辑并作废选项', async () => {
    setOptionsRunner(async () => ['追出去', '按兵不动', '点灯'])
    setLlmRunner(
      fakeLlm([{ text: '雨停了，檐角还在滴水。\n\n他吹了灯。' }, { text: '檐角仍在滴水。' }]),
    )
    await (await postTurn('开场')).text()

    const res = await rewrite(0, {
      selected: '檐角还在滴水。',
      instruction: '更紧凑一点',
      before: '雨停了，',
      after: '他吹了灯。',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rewritten: string
      messages: Array<{
        role: string
        text?: string
        edited?: boolean
        nextOptions?: string[]
      }>
    }
    expect(body.rewritten).toBe('檐角仍在滴水。')
    const narrative = body.messages.find((message) => message.role === 'narrative')
    expect(narrative).toMatchObject({ text: '雨停了，檐角仍在滴水。\n\n他吹了灯。', edited: true })
    expect(narrative?.nextOptions).toBeUndefined()
  })

  it('界面跨段落选中的文字（段间只有一个换行）也能替换', async () => {
    setLlmRunner(
      fakeLlm([
        { text: '　　雨停了，檐角还在滴水。\n\n　　他吹了灯。' },
        { text: '檐角还在滴水。他吹了灯。' },
      ]),
    )
    await (await postTurn('开场')).text()

    const res = await rewrite(0, {
      selected: '檐角还在滴水。\n他吹了灯。',
      instruction: '',
      before: '雨停了，',
      after: '',
    })
    expect(res.status).toBe(200)
    expect(narrativeText()).toBe('　　雨停了，檐角还在滴水。他吹了灯。')
  })

  it('定位不到就不写盘，返回 400', async () => {
    setLlmRunner(fakeLlm([{ text: '雨停了，檐角还在滴水。' }]))
    await (await postTurn('开场')).text()

    const res = await rewrite(0, { selected: '完全没有出现过的话', before: '', after: '' })
    expect(res.status).toBe(400)
    expect(narrativeText()).toBe('雨停了，檐角还在滴水。')
  })

  it('模型没给出结果时不替换，原文不动', async () => {
    setLlmRunner(fakeLlm([{ text: '雨停了，檐角还在滴水。' }, { text: '   ' }]))
    await (await postTurn('开场')).text()

    const res = await rewrite(0, { selected: '檐角还在滴水。', before: '雨停了，', after: '' })
    expect(res.status).toBe(400)
    expect(narrativeText()).toBe('雨停了，檐角还在滴水。')
  })

  it('改写跑偏超过上限时不替换，原文不动', async () => {
    setLlmRunner(
      fakeLlm([{ text: '雨停了，檐角还在滴水。' }, { text: '字'.repeat(2101) }]),
    )
    await (await postTurn('开场')).text()

    const res = await rewrite(0, { selected: '檐角还在滴水。', before: '雨停了，', after: '' })
    expect(res.status).toBe(400)
    expect(narrativeText()).toBe('雨停了，檐角还在滴水。')
  })

  it('已压进摘要的回合改写后带 memoryStale', async () => {
    setLlmRunner(fakeLlm([{ text: '雨停了，檐角还在滴水。' }, { text: '雨住了，檐角还在滴水。' }]))
    await (await postTurn('开场')).text()
    writeFileSync(
      memoryFile(dirOf()),
      JSON.stringify({
        id: 'm0',
        turns: [0, 0],
        summary: '雨停了。',
        keywords: [],
        entities: [],
        createdAt: new Date().toISOString(),
      }) + '\n',
      'utf8',
    )

    const res = await rewrite(0, { selected: '雨停了', before: '', after: '，' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { memoryStale: boolean }).memoryStale).toBe(true)
  })
})
