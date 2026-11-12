import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Effort, ModelEntry, SettingsView } from './api'

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

export interface PickerSelection {
  providerId: string | null
  model: string
  reasoningEffort: Effort | null
}

interface Props {
  selection: PickerSelection
  settings: SettingsView | null
  onSelect: (selection: PickerSelection) => Promise<void>
}

function defaultEffortOf(entry: ModelEntry): Effort | null {
  if (entry.defaultEffort) return entry.defaultEffort
  if (entry.efforts.includes('high')) return 'high'
  return entry.efforts[0] ?? null
}

/** 列表行右侧的强度提示：不支持显示 Off，Gemini 显示默认档位，其余不显示。 */
function effortBadge(entry: ModelEntry): string | null {
  if (entry.efforts.length === 0) return 'Off'
  if (entry.reasoningParam === 'thinking_level') {
    const effort = defaultEffortOf(entry)
    return effort ? EFFORT_LABELS[effort] : null
  }
  return null
}

/** 会话头的「供应商 · 模型 · 强度」选择器：按供应商分组，组内按模型名排序。 */
export default function ModelPicker({ selection, settings, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<PickerSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // 选择器可能贴屏幕顶部（剧场头部），弹层要按剩余空间决定朝下还是朝上，避免被裁掉。
  const [placement, setPlacement] = useState<'above' | 'below'>('below')
  const [align, setAlign] = useState<'left' | 'right'>('left')

  const measure = () => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const panel = panelRef.current
    const height = panel?.offsetHeight ?? 360
    const width = panel?.offsetWidth ?? 340
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    setPlacement(spaceBelow < height + 12 && spaceAbove > spaceBelow ? 'above' : 'below')
    setAlign(rect.left + width > window.innerWidth - 12 ? 'right' : 'left')
  }

  useLayoutEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    // 捕获阶段监听，消息区滚动时也能重新贴合。
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const providers = settings?.providers ?? []
  const matched = providers.find(
    (provider) => provider.id === selection.providerId && provider.models.some((model) => model.name === selection.model),
  )
  // providerId 缺失或已失效时，按模型名在供应商间唯一匹配。
  const byName = matched
    ? []
    : providers.filter((provider) => provider.models.some((model) => model.name === selection.model))
  const displayProvider = matched ?? (byName.length === 1 ? byName[0] : null)
  const displayEntry = displayProvider?.models.find((model) => model.name === selection.model) ?? null
  const unavailable = settings !== null && !displayProvider

  const pendingProvider = providers.find((provider) => provider.id === pending?.providerId) ?? null
  const pendingModel = pendingProvider?.models.find((model) => model.name === pending?.model) ?? null

  function startOpen() {
    const initial =
      displayEntry?.reasoningParam === 'thinking_level' && selection.reasoningEffort == null
        ? defaultEffortOf(displayEntry)
        : (selection.reasoningEffort ?? null)
    setPending({
      providerId: displayProvider?.id ?? selection.providerId ?? null,
      model: selection.model,
      reasoningEffort: initial,
    })
    setOpen(true)
  }

  function choose(providerId: string, entry: ModelEntry) {
    const keep =
      pending?.reasoningEffort && entry.efforts.includes(pending.reasoningEffort)
        ? pending.reasoningEffort
        : null
    setPending({ providerId, model: entry.name, reasoningEffort: keep ?? defaultEffortOf(entry) })
  }

  async function apply() {
    if (!pending) return
    setBusy(true)
    try {
      await onSelect(pending)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={anchorRef}
      className="relative shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : startOpen())}
        className="flex min-w-0 max-w-[240px] items-center gap-1 rounded px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100"
        title="选择供应商、模型与思考强度"
      >
        <span className="min-w-0 truncate">
          {displayProvider ? displayProvider.name : (selection.providerId ?? selection.model)}
          <span className="text-neutral-300"> · </span>
          {selection.model}
          {displayEntry && displayEntry.efforts.length > 0 && (
            <>
              <span className="text-neutral-300"> · </span>
              {displayEntry.reasoningParam === 'thinking_level'
                ? EFFORT_LABELS[selection.reasoningEffort ?? defaultEffortOf(displayEntry) ?? 'high']
                : selection.reasoningEffort
                  ? EFFORT_LABELS[selection.reasoningEffort]
                  : 'Off'}
            </>
          )}
        </span>
        {unavailable && <span className="shrink-0 text-[10px] text-amber-600">不可用</span>}
        <span className="shrink-0 text-neutral-400">▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className={`absolute z-30 max-h-[80vh] w-[340px] max-w-[calc(100vw-1.5rem)] overflow-y-auto overflow-x-hidden rounded-md border border-neutral-200 bg-white text-xs shadow-lg ${
            placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="max-h-72 overflow-y-auto">
            {providers.length === 0 && (
              <p className="px-3 py-4 text-neutral-400">还没有配置供应商，先在「设置」里添加。</p>
            )}
            {providers.map((provider) => (
              <div key={provider.id} className="border-b border-neutral-100 last:border-b-0">
                <p className="bg-neutral-50 px-3 py-1.5 text-[11px] font-medium text-neutral-500">
                  {provider.name}
                </p>
                {provider.models.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-neutral-400">这个供应商还没有模型</p>
                )}
                {[...provider.models]
                  .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
                  .map((entry) => {
                    const selected =
                      pending?.providerId === provider.id && pending?.model === entry.name
                    return (
                      <button
                        key={entry.name}
                        type="button"
                        onClick={() => choose(provider.id, entry)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                          selected ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        {effortBadge(entry) && (
                          <span className="shrink-0 text-neutral-400">{effortBadge(entry)}</span>
                        )}
                        {selected && <span className="shrink-0">✓</span>}
                      </button>
                    )
                  })}
              </div>
            ))}
          </div>

          <div className="border-t border-neutral-200 px-3 py-2.5">
            <p className="text-[11px] text-neutral-400">思考强度</p>
            {!pendingModel && <p className="mt-1 text-[11px] text-neutral-400">先选一个模型</p>}
            {pendingModel && pendingModel.efforts.length === 0 && (
              <p className="mt-1 text-[11px] text-neutral-400">这个模型不支持思考强度</p>
            )}
            {pendingModel && pendingModel.efforts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {pendingModel.reasoningParam !== 'thinking_level' && (
                  <button
                    type="button"
                    onClick={() => setPending((value) => (value ? { ...value, reasoningEffort: null } : value))}
                    className={`rounded-full border px-2 py-1 text-[11px] ${
                      pending?.reasoningEffort === null
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    Off
                  </button>
                )}
                {pendingModel.efforts.map((effort) => (
                  <button
                    key={effort}
                    type="button"
                    onClick={() => setPending((value) => (value ? { ...value, reasoningEffort: effort } : value))}
                    className={`rounded-full border px-2 py-1 text-[11px] ${
                      pending?.reasoningEffort === effort
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {EFFORT_LABELS[effort]}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">
                {unavailable ? '当前选择不可用，请重新选择' : '切换后下一回合生效'}
              </span>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={!pending || busy}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? '应用中…' : '应用'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
