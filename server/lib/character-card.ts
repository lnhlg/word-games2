/**
 * 酒馆 V2 角色卡：解析、归一化、从 PNG 里取出 `chara` chunk、生成文件名。
 * 这里只做纯函数，不碰磁盘。
 */

/** V2 卡片 data 段；字段名沿用酒馆规范。 */
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

/**
 * 一张归一化后的角色卡：固定 V2 头，data 为权威值，顶层保留 V1 镜像字段。
 * 原卡里其它未知字段原样保留，避免导入时丢东西。
 */
export interface CharacterCard {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: CharacterCardData
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  [extra: string]: unknown
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 把任意来源的 JSON 归一化成 V2 卡：
 * - 有 data 对象就以 data 为准，否则把顶层当 data（V1）；
 * - name 必填，其余字符串字段缺失即空串，数组字段非数组即空数组；
 * - character_book 原样保留，不做结构校验。
 */
export function normalizeCard(raw: unknown): CharacterCard {
  if (!isRecord(raw)) throw new Error('角色卡必须是 JSON 对象')
  const source = isRecord(raw.data) ? raw.data : raw
  const name = text(source.name).trim()
  if (!name) throw new Error('角色卡缺少 name')

  const data: CharacterCardData = {
    name,
    description: text(source.description),
    personality: text(source.personality),
    scenario: text(source.scenario),
    first_mes: text(source.first_mes),
    mes_example: text(source.mes_example),
    creator_notes: text(source.creator_notes),
    system_prompt: text(source.system_prompt),
    post_history_instructions: text(source.post_history_instructions),
    alternate_greetings: textList(source.alternate_greetings),
    tags: textList(source.tags),
    creator: text(source.creator),
    character_version: text(source.character_version),
    extensions: isRecord(source.extensions) ? source.extensions : {},
  }
  if (source.character_book !== undefined) data.character_book = source.character_book

  return {
    ...raw,
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
    // 顶层镜像：酒馆生态习惯同时读 V1 字段。
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
  }
}

/**
 * PNG 里找 keyword 为 `chara` 的 tEXt chunk，返回其中的 JSON 文本。
 * 不是 PNG、或没有该 chunk 时返回 null。
 */
export function extractCharaJson(buffer: Buffer): string | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) return null
    if (type === 'tEXt') {
      const chunk = buffer.subarray(dataStart, dataEnd)
      const nul = chunk.indexOf(0)
      if (nul >= 0 && chunk.toString('latin1', 0, nul) === 'chara') {
        const encoded = chunk.toString('utf8', nul + 1)
        return Buffer.from(encoded, 'base64').toString('utf8')
      }
    }
    offset = dataEnd + 4
  }
  return null
}

/** 从上传文件里读出角色卡 JSON：PNG 读 chara chunk，其它按 UTF-8 JSON 解析。 */
export function parseCardBuffer(buffer: Buffer, filename: string): unknown {
  const looksPng =
    (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) ||
    filename.toLowerCase().endsWith('.png')
  if (looksPng) {
    const json = extractCharaJson(buffer)
    if (!json) throw new Error('这张 PNG 里没有找到 chara 角色卡数据')
    try {
      return JSON.parse(json) as unknown
    } catch {
      throw new Error('PNG 里的 chara 数据不是有效的 JSON')
    }
  }
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown
  } catch {
    throw new Error('不是有效的 JSON 角色卡')
  }
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g

/** 由角色名生成文件名 id：保留中文与字母数字，非法字符换成 `-`，最长 64 字符。 */
export function cardFileId(name: string): string {
  const cleaned = name
    .replace(ILLEGAL, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const clamped = Array.from(cleaned).slice(0, 64).join('')
  return clamped || 'character'
}

/** 卡库里 id 的合法性：单段文件名，不含路径分隔符。 */
export function isCardId(id: string): boolean {
  return Boolean(id) && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\')
}
