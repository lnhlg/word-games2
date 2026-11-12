import type { TemplateSummary } from './types'

interface Props {
  open: boolean
  cardName: string
  templates: TemplateSummary[]
  /** 这个角色现在套着哪一份模板；null 表示没套。 */
  currentId: string | null
  loading: boolean
  onClose: () => void
  onPick: (templateId: string) => void
}

/**
 * 会话右栏的「选模板」：从工作区的模板库里挑一份套到这个角色上。
 * 套用是快照——复制条目进这场戏，之后改模板不影响已经开演的戏（ADR 0003）。
 */
export default function TemplatePickerDialog({
  open,
  cardName,
  templates,
  currentId,
  loading,
  onClose,
  onPick,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-6">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">给「{cardName}」选状态模板</h3>
            <p className="mt-1 text-[11px] leading-5 text-neutral-500">
              选中会把模板里的条目复制进这场戏，之后改模板不影响已经开演的戏。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100"
          >
            关
          </button>
        </div>

        {loading && <p className="mt-3 text-xs text-neutral-400">载入模板库…</p>}

        {!loading && templates.length === 0 && (
          <p className="mt-3 rounded-md border border-dashed border-neutral-200 px-3 py-3 text-xs leading-5 text-neutral-400">
            模板库还是空的。到左栏「状态模板」里先建一份。
          </p>
        )}

        {templates.length > 0 && (
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {templates.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  onClick={() => onPick(template.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left ${
                    template.id === currentId
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-neutral-800">{template.name}</span>
                    <span className="shrink-0 text-[10px] text-neutral-400">
                      {template.itemCount} 项
                      {template.id === currentId && ' · 当前'}
                    </span>
                  </span>
                  {template.note && (
                    <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{template.note}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex justify-between">
          <button
            type="button"
            onClick={() => onPick('')}
            className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            不套用（清空这个角色的状态项）
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
