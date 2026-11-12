import { useEffect, useState } from 'react'
import { useApp } from './store'

interface Props {
  open: boolean
  onClose: () => void
}

const PRESETS = ['第三人称限知', '第一人称', '第三人称全知']

export default function NewSessionDialog({ open, onClose }: Props) {
  const { cards, cardsLoading, creating, create, setView } = useApp()
  const [title, setTitle] = useState('')
  const [perspective, setPerspective] = useState('第三人称限知')
  const [cast, setCast] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setTitle('')
    setPerspective('第三人称限知')
    setCast(cards.map((card) => card.id))
  }, [open, cards])

  if (!open) return null

  function toggle(id: string) {
    setCast((value) => (value.includes(id) ? value.filter((item) => item !== id) : [...value, id]))
  }

  async function start() {
    if (creating) return
    try {
      await create({
        title: title.trim() || undefined,
        cast,
        perspective: perspective.trim() || undefined,
      })
      onClose()
    } catch {
      // 错误已进 store 的 error，弹窗保持打开
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl"
      >
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold">开一场新戏</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            挑好演员，写一句开场大纲就能开演。
          </p>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-[11px] font-medium text-neutral-500">戏名</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="不填就按时间起名"
              className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm outline-none placeholder:text-neutral-300 focus:border-neutral-400"
            />
          </label>

          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-neutral-500">参演角色</span>
              <button
                type="button"
                onClick={() => setCast(cast.length === cards.length ? [] : cards.map((card) => card.id))}
                className="text-[11px] text-neutral-400 hover:text-neutral-600"
              >
                {cast.length === cards.length ? '全不选' : '全选'}
              </button>
            </div>

            {cardsLoading && <p className="mt-2 text-xs text-neutral-400">载入卡库…</p>}

            {!cardsLoading && cards.length === 0 && (
              <div className="mt-2 rounded-md border border-dashed border-neutral-200 px-3 py-4 text-center">
                <p className="text-xs text-neutral-500">卡库是空的，先建一个角色。</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    setView('characters')
                  }}
                  className="mt-2 rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
                >
                  去「角色」页
                </button>
              </div>
            )}

            {cards.length > 0 && (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {cards.map((card) => {
                  const checked = cast.includes(card.id)
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        onClick={() => toggle(card.id)}
                        className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left ${
                          checked
                            ? 'border-neutral-900 bg-neutral-50'
                            : 'border-neutral-200 hover:bg-neutral-50'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                            checked
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-neutral-300 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{card.name}</span>
                          {card.description && (
                            <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-400">
                              {card.description}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {cast.length === 0 && cards.length > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-600">
                一个角色都不选，模型只能凭大纲硬写。
              </p>
            )}
          </div>

          <div>
            <span className="text-[11px] font-medium text-neutral-500">视角</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPerspective(preset)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    perspective === preset
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {preset}
                </button>
              ))}
              <input
                value={perspective}
                onChange={(event) => setPerspective(event.target.value)}
                className="min-w-0 flex-1 rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] outline-none focus:border-neutral-400"
              />
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={creating}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? '开演…' : '开演'}
          </button>
        </footer>
      </div>
    </div>
  )
}
