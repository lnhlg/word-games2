import { useEffect, useState } from 'react'
import {
  EFFORTS,
  effortsForParam,
  fetchProviderModels,
  type Effort,
  type ModelEntry,
  type ReasoningParam,
  type Selection,
  type SettingsInput,
  type SettingsView,
} from './api'

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

const PARAM_LABELS: Record<ReasoningParam, string> = {
  reasoning_effort: 'reasoning_effort',
  thinking_level: 'thinking_level',
}

/** 名称含 gemini 的模型默认走 thinking_level，其余走 reasoning_effort。 */
function inferReasoningParam(name: string): ReasoningParam {
  return name.toLowerCase().includes('gemini') ? 'thinking_level' : 'reasoning_effort'
}

interface ProviderDraft {
  key: string
  id: string
  name: string
  baseUrl: string
  apiKey: string
  hasKey: boolean
  models: ModelEntry[]
  candidates: string[]
  manual: string
  loading: boolean
  error: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortEfforts(values: Effort[]): Effort[] {
  const picked = new Set(values)
  return EFFORTS.filter((effort) => picked.has(effort))
}

function fromSettings(settings: SettingsView | null): ProviderDraft[] {
  return (settings?.providers ?? []).map((provider, index) => ({
    key: `${provider.id}-${index}`,
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: '',
    hasKey: provider.hasKey,
    models: provider.models.map((model) => ({
      name: model.name,
      efforts: [...model.efforts],
      ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
      ...(model.reasoningParam ? { reasoningParam: model.reasoningParam } : {}),
    })),
    candidates: [],
    manual: '',
    loading: false,
    error: null,
  }))
}

interface Props {
  open: boolean
  settings: SettingsView | null
  onClose: () => void
  onSave: (input: SettingsInput) => Promise<void>
}

/** 设置弹窗：只管供应商配置与新建会话默认值；当前会话的选择在聊天窗口头部。 */
export default function SettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ProviderDraft[]>([])
  const [defaultSelection, setDefaultSelection] = useState<Selection>({
    providerId: null,
    model: '',
    effort: null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState('')

  useEffect(() => {
    if (!open) return
    const next = fromSettings(settings)
    setDraft(next)
    setActiveKey(next[0]?.key ?? '')
    setDefaultSelection(settings?.default ?? { providerId: null, model: '', effort: null })
    setError(null)
  }, [open, settings])

  if (!open) return null

  function updateProvider(key: string, patch: Partial<ProviderDraft>) {
    setDraft((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  function addProvider() {
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setDraft((items) => [
      ...items,
      {
        key,
        id: '',
        name: '',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        hasKey: false,
        models: [],
        candidates: [],
        manual: '',
        loading: false,
        error: null,
      },
    ])
    setActiveKey(key)
  }

  function removeProvider(key: string) {
    const removed = draft.find((item) => item.key === key)
    const rest = draft.filter((item) => item.key !== key)
    setDraft(rest)
    if (activeKey === key) {
      const index = draft.findIndex((item) => item.key === key)
      const next = rest[Math.max(0, index - 1)] ?? rest[0]
      setActiveKey(next?.key ?? '')
    }
    if (removed && defaultSelection.providerId === removed.id) {
      setDefaultSelection({ providerId: null, model: '', effort: null })
    }
  }

  async function loadCandidates(item: ProviderDraft) {
    updateProvider(item.key, { loading: true, error: null })
    try {
      const models = await fetchProviderModels(item.id.trim() || 'draft', {
        baseUrl: item.baseUrl.trim(),
        apiKey: item.apiKey.trim() || undefined,
      })
      updateProvider(item.key, { candidates: models, loading: false })
    } catch (e) {
      updateProvider(item.key, { loading: false, error: messageOf(e) })
    }
  }

  function toggleCandidate(item: ProviderDraft, name: string) {
    if (item.models.some((model) => model.name === name)) {
      updateProvider(item.key, { models: item.models.filter((model) => model.name !== name) })
    } else {
      updateProvider(item.key, {
        models: [...item.models, { name, efforts: [], reasoningParam: inferReasoningParam(name) }],
      })
    }
  }

  function addManual(item: ProviderDraft) {
    const name = item.manual.trim()
    if (!name || item.models.some((model) => model.name === name)) return
    updateProvider(item.key, {
      models: [...item.models, { name, efforts: [], reasoningParam: inferReasoningParam(name) }],
      manual: '',
    })
  }

  function toggleEffort(item: ProviderDraft, name: string, effort: Effort) {
    updateProvider(item.key, {
      models: item.models.map((model) => {
        if (model.name !== name) return model
        const efforts = sortEfforts(
          model.efforts.includes(effort)
            ? model.efforts.filter((value) => value !== effort)
            : [...model.efforts, effort],
        )
        const fallback = efforts.includes('high') ? 'high' : efforts[0]
        const kept = model.defaultEffort && efforts.includes(model.defaultEffort) ? model.defaultEffort : fallback
        return {
          name,
          efforts,
          ...(model.reasoningParam ? { reasoningParam: model.reasoningParam } : {}),
          ...(kept ? { defaultEffort: kept } : {}),
        }
      }),
    })
  }

  function setModelParam(item: ProviderDraft, name: string, reasoningParam: ReasoningParam) {
    updateProvider(item.key, {
      models: item.models.map((model) => {
        if (model.name !== name) return model
        const allowed = effortsForParam(reasoningParam)
        const efforts = model.efforts.filter((effort) => allowed.includes(effort))
        const fallback = efforts.includes('high') ? 'high' : efforts[0]
        const kept = model.defaultEffort && efforts.includes(model.defaultEffort) ? model.defaultEffort : fallback
        return {
          name,
          efforts,
          reasoningParam,
          ...(kept ? { defaultEffort: kept } : {}),
        }
      }),
    })
  }

  function setDefaultProvider(providerId: string) {
    const provider = draft.find((item) => item.id === providerId)
    const entry = provider?.models[0]
    setDefaultSelection(
      entry
        ? { providerId, model: entry.name, effort: entry.defaultEffort ?? null }
        : { providerId: providerId || null, model: '', effort: null },
    )
  }

  async function save() {
    const input: SettingsInput = {
      providers: draft.map((item) => ({
        ...(item.id.trim() ? { id: item.id.trim() } : {}),
        name: item.name.trim(),
        baseUrl: item.baseUrl.trim(),
        ...(item.apiKey.trim() ? { apiKey: item.apiKey.trim() } : {}),
        models: item.models.map((model) => ({
          name: model.name,
          efforts: model.efforts,
          ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
          ...(model.reasoningParam ? { reasoningParam: model.reasoningParam } : {}),
        })),
      })),
      default: defaultSelection,
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(input)
      onClose()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const defaultProvider = draft.find((item) => item.id === defaultSelection.providerId) ?? null
  const defaultEntry = defaultProvider?.models.find((model) => model.name === defaultSelection.model) ?? null
  const active = draft.find((item) => item.key === activeKey) ?? draft[0] ?? null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4">
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 className="text-sm font-semibold">设置</h2>
          <p className="mt-1 text-xs text-neutral-400">
            供应商与新建会话默认值。当前会话的选择在聊天窗口头部。API Key 只保存在本机 providers.json。
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {draft.length === 0 && (
            <p className="text-xs text-neutral-400">还没有供应商。添加一个 OpenAI 兼容端点即可开始。</p>
          )}

          {draft.length === 0 && (
            <p className="text-xs text-neutral-400">还没有供应商。添加一个 OpenAI 兼容端点即可开始。</p>
          )}

          <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-200">
            {draft.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveKey(item.key)}
                className={`shrink-0 border-b-2 px-3 py-2 text-xs ${
                  active?.key === item.key
                    ? 'border-neutral-900 font-medium text-neutral-900'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {item.name || item.id || '新供应商'}
              </button>
            ))}
            <button
              type="button"
              onClick={addProvider}
              className="ml-auto shrink-0 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800"
            >
              ＋ 添加供应商
            </button>
          </div>

          {active && (
            <div className="rounded-md border border-neutral-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-neutral-700">{active.name || '新供应商'}</span>
                <button
                  type="button"
                  onClick={() => removeProvider(active.key)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-neutral-500">
                  显示名称
                  <input
                    value={active.name}
                    onChange={(event) => updateProvider(active.key, { name: event.target.value })}
                    placeholder="DeepSeek"
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                  />
                </label>
                <label className="block text-[11px] text-neutral-500">
                  id（留空按名称生成）
                  <input
                    value={active.id}
                    onChange={(event) => updateProvider(active.key, { id: event.target.value })}
                    placeholder="deepseek"
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                  />
                </label>
                <label className="col-span-2 block text-[11px] text-neutral-500">
                  Base URL
                  <input
                    value={active.baseUrl}
                    onChange={(event) => updateProvider(active.key, { baseUrl: event.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                  />
                </label>
                <label className="col-span-2 block text-[11px] text-neutral-500">
                  API Key{active.hasKey ? '（已配置，留空不改）' : ''}
                  <input
                    type="password"
                    value={active.apiKey}
                    onChange={(event) => updateProvider(active.key, { apiKey: event.target.value })}
                    placeholder={active.hasKey ? '••••••••' : 'sk-...'}
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-neutral-500">模型（{active.models.length}）</span>
                <button
                  type="button"
                  onClick={() => void loadCandidates(active)}
                  disabled={active.loading || !active.baseUrl.trim()}
                  className="rounded border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {active.loading ? '拉取中…' : '从 /models 拉取'}
                </button>
              </div>
              {active.error && <p className="mt-1 text-[11px] text-red-600">{active.error}</p>}

              {active.candidates.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded border border-neutral-200 p-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">候选模型</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {active.candidates.map((name) => {
                      const checked = active.models.some((model) => model.name === name)
                      return (
                        <label key={name} className="flex items-center gap-1 text-[11px] text-neutral-600">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCandidate(active, name)}
                          />
                          {name}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {active.models.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {active.models.map((model) => (
                    <div key={model.name} className="rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[11px] font-medium text-neutral-700">
                          {model.name}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <select
                            value={model.reasoningParam ?? inferReasoningParam(model.name)}
                            onChange={(event) =>
                              setModelParam(active, model.name, event.target.value as ReasoningParam)
                            }
                            title="上游思考强度参数"
                            className="rounded border border-neutral-300 px-1 py-0.5 text-[10px] text-neutral-600"
                          >
                            {(['reasoning_effort', 'thinking_level'] as const).map((param) => (
                              <option key={param} value={param}>
                                {PARAM_LABELS[param]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              updateProvider(active.key, {
                                models: active.models.filter((entry) => entry.name !== model.name),
                              })
                            }
                            className="shrink-0 rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {effortsForParam(model.reasoningParam ?? inferReasoningParam(model.name)).map((effort) => {
                          const on = model.efforts.includes(effort)
                          return (
                            <button
                              key={effort}
                              type="button"
                              onClick={() => toggleEffort(active, model.name, effort)}
                              className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                on
                                  ? 'border-neutral-900 bg-neutral-900 text-white'
                                  : 'border-neutral-300 text-neutral-500 hover:bg-neutral-100'
                              }`}
                            >
                              {EFFORT_LABELS[effort]}
                            </button>
                          )
                        })}
                        {model.efforts.length === 0 && (
                          <span className="text-[10px] text-neutral-400">未勾选档位 = 不支持思考强度</span>
                        )}
                        {model.efforts.length > 0 && (
                          <label className="ml-1 flex items-center gap-1 text-[10px] text-neutral-500">
                            默认
                            <select
                              value={model.defaultEffort ?? ''}
                              onChange={(event) => {
                                const value = event.target.value as Effort
                                updateProvider(active.key, {
                                  models: active.models.map((entry) =>
                                    entry.name === model.name
                                      ? { ...entry, defaultEffort: value }
                                      : entry,
                                  ),
                                })
                              }}
                              className="rounded border border-neutral-300 px-1 py-0.5 text-[10px]"
                            >
                              {model.efforts.map((effort) => (
                                <option key={effort} value={effort}>
                                  {EFFORT_LABELS[effort]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={active.manual}
                  onChange={(event) => updateProvider(active.key, { manual: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addManual(active)
                    }
                  }}
                  placeholder="手动添加模型名（私有的也可以）"
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-[11px] text-neutral-800"
                />
                <button
                  type="button"
                  onClick={() => addManual(active)}
                  disabled={!active.manual.trim()}
                  className="rounded border border-neutral-300 px-2 py-1.5 text-[11px] text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  添加
                </button>
              </div>
            </div>
          )}

          <div className="rounded-md border border-neutral-200 p-3">
            <p className="text-xs font-medium text-neutral-700">新建会话默认值</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="block text-[11px] text-neutral-500">
                供应商
                <select
                  value={defaultSelection.providerId ?? ''}
                  onChange={(event) => setDefaultProvider(event.target.value)}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                >
                  <option value="">（.env 兜底）</option>
                  {draft
                    .filter((item) => item.id.trim())
                    .map((item) => (
                      <option key={item.key} value={item.id}>
                        {item.name || item.id}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-[11px] text-neutral-500">
                模型
                <select
                  value={defaultSelection.model}
                  onChange={(event) => {
                    const name = event.target.value
                    const entry = defaultProvider?.models.find((model) => model.name === name)
                    setDefaultSelection({
                      providerId: defaultSelection.providerId,
                      model: name,
                      effort: entry?.defaultEffort ?? null,
                    })
                  }}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                >
                  {!defaultProvider && <option value="">（未选择）</option>}
                  {defaultProvider?.models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] text-neutral-500">
                思考强度
                <select
                  value={defaultSelection.effort ?? ''}
                  onChange={(event) => {
                    const value = event.target.value
                    setDefaultSelection({
                      ...defaultSelection,
                      effort: value ? (value as Effort) : null,
                    })
                  }}
                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-800"
                >
                  <option value="">Off</option>
                  {defaultEntry?.efforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {EFFORT_LABELS[effort]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {defaultEntry && defaultEntry.efforts.length === 0 && (
              <p className="mt-1 text-[10px] text-neutral-400">这个模型不支持思考强度，默认值会存为 Off。</p>
            )}
          </div>
        </div>

        <div className="border-t border-neutral-200 px-5 py-3">
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
