import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** 上游思考强度参数名：OpenAI 兼容端点用 reasoning_effort，Gemini 用 thinking_level。 */
export const REASONING_PARAMS = ['reasoning_effort', 'thinking_level'] as const
export type ReasoningParam = (typeof REASONING_PARAMS)[number]

/** 各参数支持的档位；thinking_level 不接受 max。 */
export function effortsForParam(param: ReasoningParam): Effort[] {
  return param === 'thinking_level' ? ['low', 'medium', 'high'] : ['low', 'high', 'max']
}

/** 旧版枚举（minimal/xhigh/ultra）到新枚举的迁移映射；medium 已成为合法档位。 */
const LEGACY_EFFORTS: Record<string, Effort> = {
  minimal: 'low',
  xhigh: 'max',
  ultra: 'max',
}

export interface ModelEntry {
  name: string
  efforts: Effort[]
  defaultEffort?: Effort
  /** 上游思考强度参数；缺省 reasoning_effort，含 gemini 的模型自动推断为 thinking_level。 */
  reasoningParam?: ReasoningParam
}

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: ModelEntry[]
}

/** 新建会话默认值 / 选择器当前值。providerId 为 null 表示用 .env 兜底。 */
export interface Selection {
  providerId: string | null
  model: string
  effort: Effort | null
}

export interface ProvidersConfig {
  version: 1
  providers: Provider[]
  default: Selection
}

export interface ModelInput {
  name?: unknown
  efforts?: unknown
  defaultEffort?: unknown
  reasoningParam?: unknown
}

export interface ProviderInput {
  id?: unknown
  name?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  models?: unknown
}

export interface SettingsInput {
  providers?: unknown
  default?: unknown
}

export interface PublicProvider {
  id: string
  name: string
  baseUrl: string
  hasKey: boolean
  models: ModelEntry[]
}

export interface PublicSettings {
  providers: PublicProvider[]
  default: Selection
}

export interface ResolvedSelection {
  provider: Provider | null
  model: string
  effort: Effort | null
  /** 该模型是否声明了思考强度档位；为 false 时不向上游发送 thinking 参数。 */
  supportsReasoning: boolean
  /** 上游参数名；Gemini 系列为 thinking_level，其余 reasoning_effort。 */
  reasoningParam: ReasoningParam
}

function isReasoningParam(value: unknown): value is ReasoningParam {
  return typeof value === 'string' && (REASONING_PARAMS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapEffort(value: unknown): Effort | null {
  if (typeof value !== 'string') return null
  if ((EFFORTS as readonly string[]).includes(value)) return value as Effort
  return LEGACY_EFFORTS[value] ?? null
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

function normalizeEfforts(value: unknown): Effort[] {
  if (!Array.isArray(value)) return []
  const picked = new Set<Effort>()
  for (const item of value) {
    const effort = mapEffort(item)
    if (effort) picked.add(effort)
  }
  return EFFORTS.filter((effort) => picked.has(effort))
}

export function normalizeEffort(value: unknown, supported: Effort[]): Effort | null {
  const effort = mapEffort(value)
  return effort && supported.includes(effort) ? effort : null
}

function defaultModelName(): string {
  return process.env.DEFAULT_MODEL?.trim() || 'deepseek-chat'
}

export function providersFile(): string {
  return process.env.PROVIDERS_FILE ?? path.join(process.cwd(), 'providers.json')
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'provider'
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base
  let index = 2
  while (taken.has(id)) id = `${base}-${index++}`
  return id
}

function normalizeModelEntry(input: ModelInput): ModelEntry | null {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null
  const declared = isReasoningParam(input.reasoningParam) ? input.reasoningParam : null
  const reasoningParam: ReasoningParam | null =
    declared ?? (name.toLowerCase().includes('gemini') ? 'thinking_level' : null)
  const allowed = reasoningParam ? effortsForParam(reasoningParam) : [...EFFORTS]
  const efforts = normalizeEfforts(input.efforts).filter((effort) => allowed.includes(effort))
  const fallback = efforts.includes('high') ? 'high' : efforts[0]
  const requested = mapEffort(input.defaultEffort)
  const defaultEffort = requested && efforts.includes(requested) ? requested : fallback
  return {
    name,
    efforts,
    ...(defaultEffort ? { defaultEffort } : {}),
    ...(reasoningParam ? { reasoningParam } : {}),
  }
}

function normalizeModels(value: unknown): ModelEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const models: ModelEntry[] = []
  for (const item of value) {
    const entry = normalizeModelEntry(isRecord(item) ? (item as ModelInput) : {})
    if (!entry || seen.has(entry.name)) continue
    seen.add(entry.name)
    models.push(entry)
  }
  return models.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

function normalizeConfig(raw: unknown): ProvidersConfig {
  const source = isRecord(raw) ? raw : {}
  const providers: Provider[] = []
  const taken = new Set<string>()
  for (const item of Array.isArray(source.providers) ? source.providers : []) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim() : ''
    if (!name || !baseUrl) continue
    const id = uniqueId(
      (typeof item.id === 'string' && item.id.trim()) || slugify(name),
      taken,
    )
    taken.add(id)
    providers.push({
      id,
      name,
      baseUrl,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
      models: normalizeModels(item.models),
    })
  }

  const rawDefault = isRecord(source.default) ? source.default : {}
  const requestedProvider = typeof rawDefault.providerId === 'string' ? rawDefault.providerId : null
  const defaultProvider =
    providers.find((provider) => provider.id === requestedProvider) ?? providers[0] ?? null
  const requestedModel = typeof rawDefault.model === 'string' ? rawDefault.model : ''
  const defaultEntry =
    defaultProvider?.models.find((model) => model.name === requestedModel) ??
    defaultProvider?.models[0] ??
    null

  const defaultSelection: Selection = defaultProvider && defaultEntry
    ? {
        providerId: defaultProvider.id,
        model: defaultEntry.name,
        effort: normalizeEffort(rawDefault.effort, defaultEntry.efforts),
      }
    : { providerId: null, model: requestedModel || defaultModelName(), effort: null }

  return { version: 1, providers, default: defaultSelection }
}

/** 首次读取时把 .env 三键迁移成一个供应商；没有 .env 也落一份空配置，避免反复迁移。 */
function migrateFromEnv(): ProvidersConfig {
  const baseUrl = process.env.LLM_BASE_URL?.trim()
  const apiKey = process.env.LLM_API_KEY?.trim()
  const model = defaultModelName()
  if (!baseUrl && !apiKey) {
    return { version: 1, providers: [], default: { providerId: null, model, effort: null } }
  }
  return {
    version: 1,
    providers: [
      {
        id: 'default',
        name: '默认供应商',
        baseUrl: baseUrl || 'https://api.deepseek.com/v1',
        apiKey: apiKey ?? '',
        models: [{ name: model, efforts: [] }],
      },
    ],
    default: { providerId: 'default', model, effort: null },
  }
}

export function readProvidersConfig(): ProvidersConfig {
  const file = providersFile()
  if (!existsSync(file)) {
    const config = migrateFromEnv()
    writeProvidersConfig(config)
    return config
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`providers.json 解析失败：${file}`)
  }
  return normalizeConfig(raw)
}

export function writeProvidersConfig(config: ProvidersConfig): void {
  const file = providersFile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export function publicSettings(config: ProvidersConfig = readProvidersConfig()): PublicSettings {
  return {
    providers: [...config.providers]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        hasKey: Boolean(provider.apiKey),
        models: provider.models,
      })),
    default: config.default,
  }
}

export function defaultSelection(config: ProvidersConfig = readProvidersConfig()): Selection {
  const provider = config.default.providerId
    ? config.providers.find((item) => item.id === config.default.providerId)
    : undefined
  const entry = provider?.models.find((model) => model.name === config.default.model) ?? provider?.models[0]
  if (provider && entry) {
    return {
      providerId: provider.id,
      model: entry.name,
      effort: normalizeEffort(config.default.effort, entry.efforts),
    }
  }
  const first = config.providers[0]
  if (first?.models[0]) {
    return {
      providerId: first.id,
      model: first.models[0].name,
      effort: first.models[0].defaultEffort ?? null,
    }
  }
  return { providerId: null, model: defaultModelName(), effort: null }
}

/**
 * 把会话三元组解析成实际调用使用的供应商与模型：
 * 先按 providerId + 模型名精确命中，再按模型名在供应商间唯一匹配，最后回退 default。
 */
export function resolveSelection(meta: {
  providerId?: string
  model: string
  reasoningEffort?: Effort | null
}): ResolvedSelection {
  const config = readProvidersConfig()
  const preferred = meta.providerId
    ? config.providers.find((provider) => provider.id === meta.providerId)
    : undefined
  const preferredEntry = preferred?.models.find((model) => model.name === meta.model)
  if (preferred && preferredEntry) {
    return {
      provider: preferred,
      model: preferredEntry.name,
      effort: normalizeEffort(meta.reasoningEffort, preferredEntry.efforts),
      supportsReasoning: preferredEntry.efforts.length > 0,
      reasoningParam: preferredEntry.reasoningParam ?? 'reasoning_effort',
    }
  }

  const matches = config.providers.filter((provider) =>
    provider.models.some((model) => model.name === meta.model),
  )
  if (matches.length === 1) {
    const provider = matches[0]
    const entry = provider.models.find((model) => model.name === meta.model)!
    return {
      provider,
      model: entry.name,
      effort: normalizeEffort(meta.reasoningEffort, entry.efforts),
      supportsReasoning: entry.efforts.length > 0,
      reasoningParam: entry.reasoningParam ?? 'reasoning_effort',
    }
  }

  const fallback = defaultSelection(config)
  const provider = fallback.providerId
    ? config.providers.find((item) => item.id === fallback.providerId) ?? null
    : null
  const entry = provider?.models.find((model) => model.name === fallback.model)
  if (provider && entry) {
    return {
      provider,
      model: entry.name,
      effort: normalizeEffort(meta.reasoningEffort ?? fallback.effort, entry.efforts),
      supportsReasoning: entry.efforts.length > 0,
      reasoningParam: entry.reasoningParam ?? 'reasoning_effort',
    }
  }

  return {
    provider: null,
    model: meta.model || defaultModelName(),
    effort: null,
    supportsReasoning: false,
    reasoningParam: 'reasoning_effort',
  }
}

/** 整体替换供应商配置；apiKey 省略或空串表示保留原 key。 */
export function updateProvidersConfig(input: SettingsInput): ProvidersConfig {
  const source = isRecord(input) ? input : {}
  if (!Array.isArray(source.providers)) {
    throw new Error('providers 必须是数组')
  }
  const existing = readProvidersConfig()
  const providers: Provider[] = []
  const taken = new Set<string>()

  for (const item of source.providers) {
    if (!isRecord(item)) throw new Error('供应商条目必须是对象')
    const providerInput = item as ProviderInput
    const name = typeof providerInput.name === 'string' ? providerInput.name.trim() : ''
    const baseUrl = typeof providerInput.baseUrl === 'string' ? providerInput.baseUrl.trim() : ''
    if (!name || !baseUrl) throw new Error('供应商名称与 baseUrl 不能为空')

    const wantedId =
      typeof providerInput.id === 'string' && providerInput.id.trim()
        ? providerInput.id.trim()
        : slugify(name)
    const id = uniqueId(wantedId, taken)
    taken.add(id)
    const prior = existing.providers.find((provider) => provider.id === id)
    const apiKey = (typeof providerInput.apiKey === 'string' ? providerInput.apiKey.trim() : '') || prior?.apiKey || ''
    if (!apiKey) throw new Error(`供应商「${name}」缺少 API key`)

    providers.push({
      id,
      name,
      baseUrl,
      apiKey,
      models: normalizeModels(providerInput.models),
    })
  }

  const requested = isRecord(source.default) ? source.default : null
  const fallbackProvider = providers[0] ?? null
  const fallbackEntry = fallbackProvider?.models[0] ?? null
  const fallback: Selection = fallbackProvider && fallbackEntry
    ? {
        providerId: fallbackProvider.id,
        model: fallbackEntry.name,
        effort: fallbackEntry.defaultEffort ?? null,
      }
    : { providerId: null, model: defaultModelName(), effort: null }

  let defaultSelectionValue = fallback
  if (requested) {
    const providerId = typeof requested.providerId === 'string' ? requested.providerId : null
    const model = typeof requested.model === 'string' ? requested.model : ''
    const provider = providers.find((item) => item.id === providerId)
    const entry = provider?.models.find((item) => item.name === model)
    if (provider && entry) {
      defaultSelectionValue = {
        providerId: provider.id,
        model: entry.name,
        effort: normalizeEffort(requested.effort, entry.efforts),
      }
    }
  }

  const config: ProvidersConfig = { version: 1, providers, default: defaultSelectionValue }
  writeProvidersConfig(config)
  return config
}

export function parseModelNames(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : []
  const names = list
    .map((item) =>
      typeof item === 'string' ? item : isRecord(item) && typeof (item.id ?? item.name) === 'string' ? String(item.id ?? item.name) : null,
    )
    .map((name) => name?.trim() ?? '')
    .filter(Boolean)
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'zh'))
}

/** 后端代理拉取 /models，前端不接触 API key。 */
export async function fetchProviderModels(provider: Provider): Promise<string[]> {
  const base = provider.baseUrl.replace(/\/+$/, '')
  const response = await fetch(`${base}/models`, {
    headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`拉取模型失败：${response.status} ${response.statusText}`)
  }
  return parseModelNames((await response.json()) as unknown)
}
