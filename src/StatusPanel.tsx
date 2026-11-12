import { useEffect, useRef, useState } from 'react'
import type { StatusItem, StatusRecord, StatusValue } from './types'

interface Props {
  cardId: string
  /** 本场这个角色的状态项清单（可能为空）。 */
  items: StatusItem[]
  /** 与清单一一对应的当前值。 */
  values: StatusValue[]
  /** 最近变化：用来显示每项的依据与「新」标记。 */
  recent: StatusRecord[]
  /** 被导演编辑过的回合号：这些回合留下的依据已经和原文脱节。 */
  staleTurns?: Set<number>
  /** 这个角色当前套用的模板名；没套就是 null。 */
  templateName?: string | null
  disabled: boolean
  onSetValue: (item: string, value: string) => void
  onAddItem: (name: string, note: string) => void
  onRemoveItem: (item: string) => void
  onPickTemplate: () => void
}

/** 某一项最近一次变化的依据；没有变化返回 null。 */
function latestBasis(
  cardId: string,
  item: string,
  recent: StatusRecord[],
): { basis: string; turn: number | null } | null {
  for (const record of recent) {
    const change = record.changes.find((entry) => entry.cardId === cardId && entry.item === item)
    if (change) return { basis: change.basis, turn: record.turn }
  }
  return null
}

function isNew(cardId: string, item: string, recent: StatusRecord[]): boolean {
  return recent.some((record) => record.added?.some((entry) => entry.cardId === cardId && entry.name === item))
}

const isNumber = (value: string) => /^-?\d+$/.test(value.trim())

const chip =
  'rounded border border-transparent px-1 py-0.5 text-left text-xs text-neutral-700 hover:border-neutral-200 hover:bg-neutral-50'
const tinyButton = 'rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700'

/** 右栏里一个角色的状态区：点值就改、数值给 ±1、加/删条目、让 AI 定。 */
export default function StatusPanel({
  cardId,
  items,
  values,
  recent,
  staleTurns,
  templateName,
  disabled,
  onSetValue,
  onAddItem,
  onRemoveItem,
  onPickTemplate,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.focus()
  }, [editing])

  function startEdit(item: string, value: string) {
    if (disabled) return
    setEditing(item)
    setDraft(value)
  }

  function commit() {
    if (editing === null) return
    const value = draft.trim()
    const previous = values.find((entry) => entry.name === editing)?.value ?? ''
    setEditing(null)
    if (value !== previous) onSetValue(editing, value)
  }

  function bump(item: string, current: string, step: number) {
    if (disabled) return
    const next = String(Number(current) + step)
    onSetValue(item, next)
  }

  function submitNew() {
    const name = newName.trim()
    if (!name) return
    if (items.some((item) => item.name === name)) return
    onAddItem(name, newNote.trim())
    setAdding(false)
    setNewName('')
    setNewNote('')
  }

  const full = items.length >= 8

  return (
    <div className="px-3 pb-2.5">
      {items.length > 0 && (
        <ul className="space-y-1 border-t border-neutral-100 pt-2">
          {items.map((item) => {
            const value = values.find((entry) => entry.name === item.name)?.value ?? ''
            const basis = latestBasis(cardId, item.name, recent)
            const editingThis = editing === item.name
            return (
              <li key={item.name} className="group">
                <div className="flex items-center gap-1">
                  <span
                    title={item.note || item.name}
                    className="w-[52px] shrink-0 truncate text-[11px] text-neutral-500"
                  >
                    {item.name}
                  </span>

                  {editingThis ? (
                    <input
                      ref={input}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={commit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commit()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          setEditing(null)
                        }
                      }}
                      className="min-w-0 flex-1 rounded border border-neutral-300 px-1 py-0.5 text-xs outline-none focus:border-neutral-500"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => startEdit(item.name, value)}
                      title={basis?.basis ? `依据：${basis.basis}` : '点一下改值'}
                      className={`${chip} min-w-0 flex-1 truncate ${value ? '' : 'text-neutral-300'}`}
                    >
                      {value || '未定'}
                      {isNew(cardId, item.name, recent) && (
                        <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">新</span>
                      )}
                    </button>
                  )}

                  {!editingThis && isNumber(value) && !disabled && (
                    <>
                      <button
                        type="button"
                        onClick={() => bump(item.name, value, -1)}
                        className={tinyButton}
                        title="减 1"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => bump(item.name, value, 1)}
                        className={tinyButton}
                        title="加 1"
                      >
                        +
                      </button>
                    </>
                  )}

                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`删掉「${item.name}」这一项？它的当前值也会一起清掉。`)) {
                          onRemoveItem(item.name)
                        }
                      }}
                      className={`${tinyButton} opacity-0 group-hover:opacity-100`}
                      title="删掉这一项"
                    >
                      ×
                    </button>
                  )}
                </div>
                {basis?.basis && basis.basis !== '导演手改' && (
                  <p className="mt-0.5 pl-[56px] text-[10px] leading-4 text-neutral-400">
                    {basis.basis}
                    {basis.turn !== null && `（第 ${basis.turn + 1} 回合）`}
                    {basis.turn !== null && staleTurns?.has(basis.turn) && (
                      <span className="ml-1 text-amber-600">原文已改</span>
                    )}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 space-y-1 border-t border-neutral-100 pt-2">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitNew()
              if (event.key === 'Escape') setAdding(false)
            }}
            placeholder="状态项名称，如 好感度"
            autoFocus
            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs outline-none focus:border-neutral-500"
          />
          <input
            value={newNote}
            onChange={(event) => setNewNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitNew()
              if (event.key === 'Escape') setAdding(false)
            }}
            placeholder="这一项看什么（可空）"
            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs outline-none focus:border-neutral-500"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={submitNew}
              className="rounded bg-neutral-900 px-2 py-0.5 text-[11px] text-white hover:bg-neutral-700"
            >
              加上
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        items.length === 0 &&
        !disabled && (
          <p className="mt-1 text-[10px] leading-4 text-neutral-400">还没有状态项，先给这个角色定几项。</p>
        )
      )}

      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => setAdding(true)}
          className={`${tinyButton} disabled:opacity-40`}
          title={full ? '每角色最多 8 项' : '加一项'}
        >
          ＋ 加状态
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onPickTemplate}
          className={`${tinyButton} disabled:opacity-40`}
          title={templateName ? `当前模板：${templateName}` : '从模板库里选一份'}
        >
          选模板
        </button>
        {full && <span className="text-[10px] text-neutral-400">已满 8 项</span>}
      </div>
      {templateName && (
        <p className="mt-1 truncate text-[10px] text-neutral-400" title={templateName}>
          模板：{templateName}
        </p>
      )}
    </div>
  )
}
