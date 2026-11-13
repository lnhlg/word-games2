import { useEffect } from 'react'
import type { CardSummary } from './types'

/**
 * 开演后往演员表里加人：只列卡库里还没参演的角色，点一下即加入。
 * 加入的角色从下一回合起进入演员表，已经写下的情节不动。
 */

interface Props {
  open: boolean
  /** 已经在场的卡 id。 */
  cast: string[]
  cards: CardSummary[]
  /** 正在加入的那张卡；非空时整列表禁用，避免连点。 */
  addingId: string | null
  onClose: () => void
  onAdd: (cardId: string) => void
  onGoCharacters: () => void
}

export default function AddCastDialog({
  open,
  cast,
  cards,
  addingId,
  onClose,
  onAdd,
  onGoCharacters,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const available = cards.filter((card) => !cast.includes(card.id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl"
      >
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold">加一个角色</h2>
          <p className="mt-0.5 text-[11px] leading-5 text-neutral-400">
            从卡库里挑一个还没参演的角色。加进来的人从下一回合起进入演员表，已经写下的情节不动。
          </p>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {cards.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center">
              <p className="text-xs text-neutral-500">卡库是空的，先建一个角色。</p>
              <button
                type="button"
                onClick={onGoCharacters}
                className="mt-2 rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
              >
                去「角色」页
              </button>
            </div>
          ) : available.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-neutral-400">
              卡库里的角色都在这场戏里了。
            </p>
          ) : (
            <ul className="space-y-1">
              {available.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    disabled={addingId !== null}
                    onClick={() => onAdd(card.id)}
                    className="flex w-full items-start gap-2 rounded-md border border-neutral-200 px-2.5 py-2 text-left hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[10px] text-neutral-400">
                      ＋
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{card.name}</span>
                      {card.tags.length > 0 && (
                        <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                          {card.tags.join(' · ')}
                        </span>
                      )}
                      {card.description && (
                        <span className="mt-0.5 line-clamp-1 block text-[11px] text-neutral-400">
                          {card.description}
                        </span>
                      )}
                    </span>
                    {addingId === card.id && (
                      <span className="ml-auto shrink-0 self-center text-[11px] text-neutral-400">
                        加入中…
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-neutral-200 px-5 py-3">
          <p className="min-w-0 text-[11px] text-neutral-400">想让它出场，下一句大纲里交代一下。</p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
