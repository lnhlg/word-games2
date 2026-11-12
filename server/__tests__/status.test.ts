import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../app'
import { setLlmRunner } from '../lib/llm'
import { parseSuggestedItems, parseTurnExtras, setTurnExtrasRunner } from '../lib/options'
import { readMeta, sessionDir } from '../lib/session-fs'
import { statusFile } from '../lib/status'

let root: string
let sessionId: string
let cardId: string

const q = (ws: string) => `?workspace=${encodeURIComponent(ws)}`

function card(name: string) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name,
      description: `${name}的设定`,
      personality: `${name}的性格`,
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
    },
  }
}

function fakeLlm(script: string[]) {
  let step = 0
  return async function* () {
    const text = script[step] ?? '（脚本结束）'
    step += 1
    yield { type: 'delta' as const, text }
    yield { type: 'done' as const, finishReason: 'stop' }
  }
}

function parseSse(text: string): Array<{ type: string; [key: string]: unknown }> {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.replace(/^data:\s*/, '')) as { type: string })
}

const dirOf = () => sessionDir(root, sessionId)

async function createSession(cast: string[]) {
  const res = await app.request(`/api/sessions${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cast }),
  })
  return res
}

async function putTemplate(template: Record<string, Array<{ name: string; note: string }>>) {
  return app.request(`/api/sessions/${sessionId}/status/template${q(root)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template }),
  })
}

async function putValue(cardId: string, item: string, value: string) {
  return app.request(`/api/sessions/${sessionId}/status/value${q(root)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, item, value }),
  })
}

async function postTurn(input: string) {
  return app.request(`/api/sessions/${sessionId}/turns${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  })
}

async function getSession() {
  const res = await app.request(`/api/sessions/${sessionId}${q(root)}`)
  return (await res.json()) as {
    meta: { turn: number }
    status: {
      template: Record<string, Array<{ name: string; note: string }>>
      values: Record<string, Array<{ name: string; value: string }>>
      recent: Array<{ turn: number | null; source: string; changes: unknown[] }>
    }
  }
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'word-games-status-'))
  process.env.APP_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'word-games-app-'))
  process.env.PROVIDERS_FILE = path.join(root, 'providers.json')

  const saved = await app.request(`/api/characters${q(root)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ card: card('沈砚') }),
  })
  cardId = ((await saved.json()) as { id: string }).id

  const created = await createSession([cardId])
  sessionId = ((await created.json()) as { session: { id: string } }).session.id
})

afterEach(() => {
  setLlmRunner(null)
  setTurnExtrasRunner(null)
  delete process.env.PROVIDERS_FILE
  delete process.env.DEFAULT_MODEL
})

describe('状态模板与值', () => {
  it('模板写进 session.json，GET 会话给出带「未定」的投影', async () => {
    const res = await putTemplate({ [cardId]: [{ name: '好感度', note: '亲近程度' }] })
    expect(res.status).toBe(200)

    const meta = readMeta(dirOf())
    expect(meta.statusTemplate).toEqual({ [cardId]: [{ name: '好感度', note: '亲近程度' }] })

    const detail = await getSession()
    expect(detail.status.values[cardId]).toEqual([{ name: '好感度', value: '' }])
  })

  it('只接受参演角色：模板里别人的键被丢掉', async () => {
    const res = await putTemplate({
      [cardId]: [{ name: '好感度', note: '' }],
      路人: [{ name: 'HP', note: '' }],
    })
    expect(res.status).toBe(200)
    expect(Object.keys(readMeta(dirOf()).statusTemplate ?? {})).toEqual([cardId])
  })

  it('每角色最多 8 项，多出来的截断', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ name: `项${index}`, note: '' }))
    await putTemplate({ [cardId]: items })
    expect(readMeta(dirOf()).statusTemplate?.[cardId]).toHaveLength(8)
  })

  it('手改值追加一条 manual 记录，GET 能读到', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    const res = await putValue(cardId, '好感度', '30')
    expect(res.status).toBe(200)

    const file = statusFile(dirOf())
    expect(existsSync(file)).toBe(true)
    const records = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ turn: null, source: 'manual' })

    const detail = await getSession()
    expect(detail.status.values[cardId]).toEqual([{ name: '好感度', value: '30' }])
  })

  it('改不存在的状态项返回 404', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    expect((await putValue(cardId, '不存在的项', '1')).status).toBe(404)
  })

  it('值没变化时不记账', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    await putValue(cardId, '好感度', '30')
    await putValue(cardId, '好感度', '30')
    const lines = readFileSync(statusFile(dirOf()), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
  })
})

describe('AI 更新与回合回滚', () => {
  it('正文之后落状态变化与新增条目，并推 status_update', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    setLlmRunner(fakeLlm(['她替他挡了一刀。']))
    setTurnExtrasRunner(async () => ({
      options: [],
      status: {
        changes: [{ character: '沈砚', item: '好感度', value: '35', basis: '她替他挡了一刀' }],
        newItems: [{ character: '沈砚', item: '伤势', value: '刀伤', note: '身上的伤', basis: '刀口' }],
      },
    }))

    const events = parseSse(await (await postTurn('有人替他挡刀。')).text())
    expect(events.map((event) => event.type)).toEqual(['turn_start', 'delta', 'done', 'status_update'])
    const update = events.find((event) => event.type === 'status_update') as unknown as {
      status: { values: Record<string, Array<{ name: string; value: string }>> }
    }
    expect(update.status.values[cardId]).toEqual([
      { name: '好感度', value: '35' },
      { name: '伤势', value: '刀伤' },
    ])

    // 新增条目落进模板，下次开戏还在。
    const meta = readMeta(dirOf())
    expect(meta.statusTemplate?.[cardId]?.map((item) => item.name)).toEqual(['好感度', '伤势'])
  })

  it('没有模板时不做状态更新，也不推事件', async () => {
    setLlmRunner(fakeLlm(['门开了。']))
    setTurnExtrasRunner(async () => ({
      options: [],
      status: { changes: [{ character: '沈砚', item: '好感度', value: '35', basis: 'x' }] },
    }))

    const events = parseSse(await (await postTurn('有人敲门。')).text())
    expect(events.map((event) => event.type)).toEqual(['turn_start', 'delta', 'done'])
    expect(existsSync(statusFile(dirOf()))).toBe(false)
  })

  it('删除最后一回合时状态回滚到该回合之前', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    setLlmRunner(fakeLlm(['第一段。', '第二段。']))
    let step = 0
    setTurnExtrasRunner(async () => {
      step += 1
      return {
        options: [],
        status: {
          changes: [
            { character: '沈砚', item: '好感度', value: step === 1 ? '30' : '50', basis: '依据' },
          ],
        },
      }
    })

    await (await postTurn('第一幕')).text()
    await (await postTurn('第二幕')).text()
    expect((await getSession()).status.values[cardId]).toEqual([{ name: '好感度', value: '50' }])

    const res = await app.request(`/api/sessions/${sessionId}/turns/1${q(root)}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await getSession()).status.values[cardId]).toEqual([{ name: '好感度', value: '30' }])
  })

  it('重新生成丢掉旧稿带来的状态，按新稿重算', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    setLlmRunner(fakeLlm(['旧稿。', '新稿。']))
    let step = 0
    setTurnExtrasRunner(async () => {
      step += 1
      return {
        options: [],
        status: {
          changes: [
            { character: '沈砚', item: '好感度', value: step === 1 ? '30' : '50', basis: '依据' },
          ],
        },
      }
    })

    await (await postTurn('开场')).text()
    expect((await getSession()).status.values[cardId]).toEqual([{ name: '好感度', value: '30' }])

    const res = await app.request(`/api/sessions/${sessionId}/turns/regenerate${q(root)}`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    await res.text()

    const records = readFileSync(statusFile(dirOf()), 'utf8').trim().split('\n')
    expect(records).toHaveLength(1)
    expect((await getSession()).status.values[cardId]).toEqual([{ name: '好感度', value: '50' }])
  })

  it('删条目会补一条清空记录，别让旧值复活', async () => {
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }] })
    await putValue(cardId, '好感度', '30')
    await putTemplate({ [cardId]: [{ name: '被怀疑', note: '' }] })
    await putTemplate({ [cardId]: [{ name: '好感度', note: '' }, { name: '被怀疑', note: '' }] })

    expect((await getSession()).status.values[cardId]).toEqual([
      { name: '好感度', value: '' },
      { name: '被怀疑', value: '' },
    ])
  })
})

describe('套用模板库', () => {
  async function makeTemplate(name: string, items: string[]) {
    const res = await app.request(`/api/status-templates${q(root)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template: { name, note: '', items: items.map((item) => ({ name: item, note: '' })) },
      }),
    })
    return ((await res.json()) as { id: string }).id
  }

  async function apply(cardId: string, templateId: string) {
    return app.request(`/api/sessions/${sessionId}/status/apply-template${q(root)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId, templateId }),
    })
  }

  it('套用后条目复制进本场，来源 id 记下', async () => {
    const templateId = await makeTemplate('毒医验伤', ['毒性', '伤势'])
    const res = await apply(cardId, templateId)
    expect(res.status).toBe(200)

    const meta = readMeta(dirOf())
    expect(meta.statusTemplate?.[cardId]?.map((item) => item.name)).toEqual(['毒性', '伤势'])
    expect(meta.statusTemplateIds?.[cardId]).toBe(templateId)
    expect((await getSession()).status.values[cardId]).toEqual([
      { name: '毒性', value: '' },
      { name: '伤势', value: '' },
    ])
  })

  it('换模板会替换条目，旧条目的值被清空', async () => {
    const first = await makeTemplate('甲', ['毒性'])
    const second = await makeTemplate('乙', ['好感度'])
    await apply(cardId, first)
    await putValue(cardId, '毒性', '高')
    await apply(cardId, second)

    expect((await getSession()).status.values[cardId]).toEqual([{ name: '好感度', value: '' }])
  })

  it('templateId 为空表示清空这个角色的状态项', async () => {
    const templateId = await makeTemplate('甲', ['毒性'])
    await apply(cardId, templateId)
    expect((await apply(cardId, '')).status).toBe(200)

    const meta = readMeta(dirOf())
    expect(meta.statusTemplate?.[cardId]).toBeUndefined()
    expect(meta.statusTemplateIds?.[cardId]).toBeUndefined()
  })

  it('非参演角色 400，不存在的模板 404', async () => {
    const templateId = await makeTemplate('甲', ['毒性'])
    expect((await apply('路人', templateId)).status).toBe(400)
    expect((await apply(cardId, '不存在')).status).toBe(404)
  })

  it('模板改了不影响已经套用过的戏（快照）', async () => {
    const templateId = await makeTemplate('甲', ['毒性'])
    await apply(cardId, templateId)
    await app.request(`/api/status-templates/${encodeURIComponent(templateId)}${q(root)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: { items: [{ name: '好感度', note: '' }] } }),
    })
    expect(readMeta(dirOf()).statusTemplate?.[cardId]?.map((item) => item.name)).toEqual(['毒性'])
  })
})

describe('模型输出的解析', () => {
  it('整体 JSON 可解析时，字段各自降级', () => {
    const extras = parseTurnExtras(
      '```json\n{"options":"不是数组","status":[{"character":"沈砚","item":"好感度","value":"35","basis":"挡刀"}],"newItems":[]}\n```',
    )
    expect(extras.options).toEqual([])
    expect(extras.status.changes).toEqual([
      { character: '沈砚', item: '好感度', value: '35', basis: '挡刀' },
    ])
  })

  it('整体不是 JSON 时两者都不要', () => {
    expect(parseTurnExtras('随便一段话')).toEqual({ options: [], status: {} })
  })

  it('状态项解析：去重、截断、过滤空名', () => {
    const items = parseSuggestedItems(
      '{"items":[{"name":"好感度","note":"a"},{"name":"好感度","note":"b"},{"name":"","note":"c"},{"name":"伤势","note":"d"}]}',
    )
    expect(items).toEqual([
      { name: '好感度', note: 'a' },
      { name: '伤势', note: 'd' },
    ])
  })
})
