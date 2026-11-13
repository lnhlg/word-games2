import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAgentMd } from '../lib/agent-md'
import { buildMessages, CONTRACT, castBlock } from '../lib/prompt'
import { DEFAULT_AGENT } from '../lib/session-fs'
import type { CharacterCard } from '../lib/character-card'

function card(name: string, overrides: Partial<CharacterCard['data']> = {}): CharacterCard {
  const data = {
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
    ...overrides,
  }
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
  }
}

describe('buildMessages 组装顺序', () => {
  it('system：契约 → agent.md → 演员表 → 视角，顺序固定', () => {
    const messages = buildMessages({
      agentMd: '【AGENT】雨夜，旧书店。',
      cast: [card('沈砚')],
      perspective: '第三人称限知',
      memory: '',
      history: [],
      outline: '沈砚听见了敲门声。',
    })
    expect(messages[0].role).toBe('system')
    const text = messages[0].content ?? ''
    expect(text.startsWith(CONTRACT)).toBe(true)

    // 契约正文里也提到「【演员表】」「【视角】」，所以用只在目标段出现的标记定位。
    const order = ['【AGENT】雨夜，旧书店。', '## 沈砚', '【视角】\n第三人称限知']
    const positions = order.map((part) => text.indexOf(part))
    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('user：摘要 → 最近情节 → 角色附注 → 本回合大纲', () => {
    const messages = buildMessages({
      agentMd: '',
      cast: [card('沈砚', { post_history_instructions: '别用感叹号。' })],
      perspective: '第三人称限知',
      memory: '你曾在码头见过一只黑猫。',
      history: [
        { role: 'director', text: '沈砚翻着账本。' },
        { role: 'narrative', text: '门轴发出一声干涩的呻吟。' },
      ],
      outline: '有人敲门。',
    })
    const user = messages[1].content ?? ''
    const order = [
      '【更早情节（摘要）】',
      '【最近情节】',
      '导演：沈砚翻着账本。',
      '门轴发出一声干涩的呻吟。',
      '【角色附注】',
      '【本回合大纲】',
      '有人敲门。',
    ]
    const positions = order.map((part) => user.indexOf(part))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('user：重新生成的要求接在本回合大纲之后', () => {
    const messages = buildMessages({
      agentMd: '',
      cast: [],
      perspective: '第三人称限知',
      memory: '',
      history: [],
      outline: '有人敲门。',
      instruction: '写得更紧张，少解释。',
    })
    const user = messages[1].content ?? ''
    const order = ['【本回合大纲】', '有人敲门。', '【重写要求】', '写得更紧张，少解释。']
    const positions = order.map((part) => user.indexOf(part))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('user：没有重写要求时不出现这一段', () => {
    const messages = buildMessages({
      agentMd: '',
      cast: [],
      perspective: '第三人称限知',
      memory: '',
      history: [],
      outline: '有人敲门。',
      instruction: '   ',
    })
    expect(messages[1].content ?? '').not.toContain('【重写要求】')
  })
  it('没有 agentMd 时 system 直接从演员表开始', () => {
    const messages = buildMessages({
      agentMd: '',
      cast: [card('沈砚')],
      perspective: '第一人称',
      memory: '',
      history: [],
      outline: '看',
    })
    const text = messages[0].content ?? ''
    expect(text.startsWith(CONTRACT)).toBe(true)
    expect(text).toContain('【演员表】')
    expect(text).toContain('【视角】\n第一人称')
  })

  it('没有角色卡时演员表给占位说明，不产生空的 ## 段', () => {
    const block = castBlock([])
    expect(block).toContain('【演员表】')
    expect(block).toContain('没有角色卡')
    expect(block).not.toContain('##')
  })

  it('卡里空字段整段略过', () => {
    const block = castBlock([card('沈砚', { description: '', personality: '嘴硬心软' })])
    expect(block).not.toContain('人物设定：')
    expect(block).toContain('性格：嘴硬心软')
  })

  it('演员表把当前状态接在角色段末尾，空值写「未定」', () => {
    const block = castBlock([card('沈砚'), card('阿箬')], {
      沈砚: [
        { name: '好感度', value: '35' },
        { name: '被怀疑', value: '' },
      ],
    })
    expect(block).toContain('当前状态：好感度 35；被怀疑 未定')
    // 没有状态的角色不产生这一行。
    expect(block.split('当前状态：')).toHaveLength(2)
  })

  it('契约里写明状态不要直接报数值', () => {
    expect(CONTRACT).toContain('当前状态')
    expect(CONTRACT).toContain('不要直接报出条目名或数值')
  })
})

describe('resolveAgentMd 优先级', () => {
  /** 一对临时目录：workspace 是工作区，dir 是会话目录。 */
  function tempDirs() {
    return {
      workspace: mkdtempSync(path.join(os.tmpdir(), 'wg-ws-')),
      dir: mkdtempSync(path.join(os.tmpdir(), 'wg-agent-')),
    }
  }

  function cleanup(...dirs: string[]) {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }

  it('<model>.md 存在时优先于会话的 AGENT.md', () => {
    const { workspace, dir } = tempDirs()
    writeFileSync(path.join(dir, 'AGENT.md'), '通用设定', 'utf8')
    writeFileSync(path.join(dir, 'deepseek-chat.md'), '模型专属设定', 'utf8')
    expect(resolveAgentMd(dir, 'deepseek-chat', workspace)).toBe('模型专属设定')
    cleanup(workspace, dir)
  })

  it('没有 <model>.md 时用会话的 AGENT.md', () => {
    const { workspace, dir } = tempDirs()
    writeFileSync(path.join(dir, 'AGENT.md'), '通用设定', 'utf8')
    expect(resolveAgentMd(dir, 'other-model', workspace)).toBe('通用设定')
    cleanup(workspace, dir)
  })

  it('工作区根的 AGENTS.md 会作为默认指令注入', () => {
    const { workspace, dir } = tempDirs()
    writeFileSync(path.join(workspace, 'AGENTS.md'), '工作区的全场规则', 'utf8')
    expect(resolveAgentMd(dir, 'any-model', workspace)).toBe('工作区的全场规则')
    cleanup(workspace, dir)
  })

  it('工作区也认单数的 AGENT.md', () => {
    const { workspace, dir } = tempDirs()
    writeFileSync(path.join(workspace, 'AGENT.md'), '工作区规则', 'utf8')
    expect(resolveAgentMd(dir, 'any-model', workspace)).toBe('工作区规则')
    cleanup(workspace, dir)
  })

  it('工作区规则在前，本场规则追加在后', () => {
    const { workspace, dir } = tempDirs()
    writeFileSync(path.join(workspace, 'AGENTS.md'), '工作区规则', 'utf8')
    writeFileSync(path.join(dir, 'AGENT.md'), '本场规则', 'utf8')
    expect(resolveAgentMd(dir, 'any-model', workspace)).toBe('工作区规则\n\n本场规则')
    cleanup(workspace, dir)
  })

  it('会话里的默认模板不算指令', () => {
    const { workspace, dir } = tempDirs()
    writeFileSync(path.join(dir, 'AGENT.md'), DEFAULT_AGENT, 'utf8')
    expect(resolveAgentMd(dir, 'any-model', workspace)).toBe('')
    cleanup(workspace, dir)
  })

  it('两个都不存在时返回空串', () => {
    const { workspace, dir } = tempDirs()
    expect(resolveAgentMd(dir, 'any-model', workspace)).toBe('')
    cleanup(workspace, dir)
  })
})
