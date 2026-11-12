import { useEffect, useRef, useState } from 'react'
import ModelPicker, { type PickerSelection } from './ModelPicker'
import StatusPanel from './StatusPanel'
import TemplatePickerDialog from './TemplatePickerDialog'
import { splitParagraphs } from './narrative'
import { useApp } from './store'
import { lastDirectorIndex, lastTurnOf } from './turns'
import type { MessageRecord, StatusItem } from './types'

interface Props {
  onOpenSettings: () => void
}

function Caret() {
  return (
    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-neutral-400 align-middle" />
  )
}

/**
 * 小说正文：按空行分自然段，每段首行缩进两个汉字（2em），段距 6px、行高 28px，比聊天式排版紧凑。
 * 流式与已落盘的消息共用同一套排版，光标挂最后一段末尾。
 */
function NarrativeText({ text, caret = false }: { text: string; caret?: boolean }) {
  const paragraphs = splitParagraphs(text)
  const blocks = paragraphs.length > 0 ? paragraphs : ['']
  return (
    <div className="flex flex-col gap-1.5 text-[15px] leading-7 text-neutral-800">
      {blocks.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap indent-[2em]">
          {paragraph}
          {caret && index === blocks.length - 1 && <Caret />}
        </p>
      ))}
    </div>
  )
}

const manageButton =
  'rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40'

interface NarrativeProps {
  message: Extract<MessageRecord, { role: 'narrative' }>
  editing: boolean
  editText: string
  busy: boolean
  canPickOptions: boolean
  onEditText: (text: string) => void
  onSave: () => void
  onCancel: () => void
  onPickOption: (text: string) => void
}

function Narrative({
  message,
  editing,
  editText,
  busy,
  canPickOptions,
  onEditText,
  onSave,
  onCancel,
  onPickOption,
}: NarrativeProps) {
  if (editing) {
    return (
      <article className="space-y-2">
        <textarea
          value={editText}
          onChange={(event) => onEditText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              onSave()
            }
          }}
          rows={12}
          autoFocus
          className="w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-[15px] leading-7 outline-none focus:border-neutral-500"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !editText.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            取消
          </button>
          <span className="text-[11px] text-neutral-400">Ctrl + Enter 保存 · Esc 取消</span>
        </div>
      </article>
    )
  }

  return (
    <article className="space-y-1.5">
      <NarrativeText text={message.text} />
      {message.edited && <p className="text-[11px] text-neutral-400">已编辑</p>}
      {message.interrupted && (
        <p className="text-xs italic text-neutral-400">（写到一半被打断了）</p>
      )}
      {message.nextOptions && message.nextOptions.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] text-neutral-400">接下来可以这么演</p>
          <div className="flex flex-wrap gap-1.5">
            {message.nextOptions.map((option, index) =>
              canPickOptions ? (
                <button
                  key={index}
                  type="button"
                  onClick={() => onPickOption(option)}
                  className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
                >
                  {option}
                </button>
              ) : (
                <span
                  key={index}
                  className="rounded-full border border-dashed border-neutral-200 px-3 py-1 text-xs text-neutral-400"
                >
                  {option}
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </article>
  )
}

interface DirectorProps {
  message: Extract<MessageRecord, { role: 'director' }>
  isLast: boolean
  hasNarrative: boolean
  busy: boolean
  onRegenerate: () => void
  onEdit: () => void
  onDelete: () => void
}

function Director({ message, isLast, hasNarrative, busy, onRegenerate, onEdit, onDelete }: DirectorProps) {
  return (
    <div className="group border-l-2 border-neutral-300 pl-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          导演 · 第 {message.turn} 回合
        </p>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {isLast && (
            <button type="button" disabled={busy} onClick={onRegenerate} className={manageButton}>
              重新生成
            </button>
          )}
          {hasNarrative && (
            <button type="button" disabled={busy} onClick={onEdit} className={manageButton}>
              编辑
            </button>
          )}
          {isLast && (
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className={`${manageButton} hover:text-red-600`}
            >
              删除
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-500">{message.text}</p>
    </div>
  )
}

export default function PlayView({ onOpenSettings }: Props) {
  const {
    meta,
    messages,
    status,
    sessionLoading,
    streaming,
    streamText,
    currentWorkspace,
    settings,
    cards,
    send,
    cancel,
    regenerate,
    editNarrative,
    deleteLastTurn,
    setPerspective,
    setStatus,
    setSelection,
    setStatusValue,
    saveStatusTemplate,
    applyTemplateToRole,
    statusTemplates,
    statusTemplatesLoading,
    loadTemplates,
    selectCard,
    setView,
  } = useApp()

  const [draft, setDraft] = useState('')
  const [perspective, setPerspectiveDraft] = useState('')
  const [editingTurn, setEditingTurn] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPerspectiveDraft(meta?.perspective ?? '第三人称限知')
    setPickFor(null)
  }, [meta?.id, meta?.perspective])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, streamText])

  if (!currentWorkspace) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-400">先打开一个工作区。</p>
      </main>
    )
  }

  if (!meta) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="max-w-sm space-y-2 text-center">
          <p className="text-sm text-neutral-500">
            {sessionLoading ? '载入中…' : '还没有戏。'}
          </p>
          <p className="text-xs text-neutral-400">
            点左栏右上角「＋ 新建」，选几个角色，写一句开场大纲。
          </p>
        </div>
      </main>
    )
  }

  const ended = meta.status === 'ended'
  const cast = meta.cast ?? []
  const summaryOf = (id: string) => cards.find((card) => card.id === id) ?? null
  const noProvider = settings !== null && settings.providers.length === 0

  async function submit() {
    const text = draft.trim()
    if (!text || streaming || ended) return
    setDraft('')
    await send(text)
  }

  async function savePerspective() {
    const value = perspective.trim()
    if (!value || value === meta?.perspective) return
    await setPerspective(meta!.id, value)
  }

  async function onPick(selection: PickerSelection) {
    await setSelection(meta!.id, selection)
  }

  function openCard(id: string) {
    void selectCard(id)
    setView('characters')
  }

  const statusTemplate = status?.template ?? {}
  /** 被编辑过的回合：它们留下的状态依据已经跟原文脱节。 */
  const staleTurns = new Set(
    messages
      .filter(
        (message): message is Extract<MessageRecord, { role: 'narrative' }> =>
          message.role === 'narrative' && message.edited === true,
      )
      .map((message) => message.turn),
  )

  function itemsOf(cardId: string): StatusItem[] {
    return statusTemplate[cardId] ?? []
  }

  function valuesOf(cardId: string) {
    return status?.values[cardId] ?? []
  }

  async function addStatusItem(cardId: string, name: string, note: string) {
    const items = itemsOf(cardId)
    if (items.length >= 8 || items.some((item) => item.name === name)) return
    try {
      await saveStatusTemplate({ ...statusTemplate, [cardId]: [...items, { name, note }] })
    } catch {
      // 错误已经写进 store.error
    }
  }

  async function removeStatusItem(cardId: string, name: string) {
    const items = itemsOf(cardId).filter((item) => item.name !== name)
    const next = { ...statusTemplate }
    if (items.length) next[cardId] = items
    else delete next[cardId]
    try {
      await saveStatusTemplate(next)
    } catch {
      // 错误已经写进 store.error
    }
  }

  /** 这个角色套着的模板名；用来在状态区底部标来源。 */
  function templateNameOf(cardId: string): string | null {
    const templateId = meta?.statusTemplateIds?.[cardId]
    if (!templateId) return null
    return statusTemplates.find((template) => template.id === templateId)?.name ?? templateId
  }

  async function pickTemplate(cardId: string, templateId: string) {
    setPickFor(null)
    try {
      await applyTemplateToRole(cardId, templateId)
    } catch {
      // 错误已经写进 store.error
    }
  }

  // 失败的那一回合只留下大纲、回合号没有前进，它同样是最后一回合。
  const last = lastTurnOf(messages)
  const lastTurn = last?.turn ?? -1
  const lastDirector = lastDirectorIndex(messages)
  const narrativeOf = (turn: number) =>
    messages.find((message) => message.role === 'narrative' && message.turn === turn) ?? null

  function startEdit(turn: number) {
    const narrative = narrativeOf(turn)
    if (!narrative) return
    setEditingTurn(turn)
    setEditText(narrative.text)
  }

  function cancelEdit() {
    setEditingTurn(null)
    setEditText('')
  }

  async function saveEdit(turn: number) {
    const text = editText.trim()
    if (!text || editBusy) return
    setEditBusy(true)
    try {
      const { memoryStale } = await editNarrative(turn, text)
      setEditingTurn(null)
      setEditText('')
      setNotice(memoryStale ? '这一回合的原文已经压进摘要，改动不会同步进旧摘要。' : null)
    } catch {
      // 错误已经写进 store.error
    } finally {
      setEditBusy(false)
    }
  }

  async function handleDelete(hasNarrative: boolean) {
    const question = hasNarrative
      ? '删除这一回合？导演大纲和情节都会删掉，前面的剧情不受影响。'
      : '删除这条没生成出正文的大纲？前面的剧情不受影响。'
    if (!window.confirm(question)) return
    try {
      await deleteLastTurn()
    } catch {
      // 错误已经写进 store.error
    }
  }

  function pickOption(option: string) {
    setDraft(option)
    requestAnimationFrame(() => composer.current?.focus())
  }

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col border-r border-neutral-200">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{meta.title}</h1>
            <p className="mt-0.5 truncate text-[11px] text-neutral-400">
              {cast.length} 名角色 · 第 {meta.turn + 1} 回合
              {ended && ' · 已落笔'}
            </p>
          </div>

          <label className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-400">
            视角
            <input
              value={perspective}
              onChange={(event) => setPerspectiveDraft(event.target.value)}
              onBlur={() => void savePerspective()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
              className="w-[104px] rounded border border-transparent px-1 py-0.5 text-[11px] text-neutral-600 outline-none hover:border-neutral-200 focus:border-neutral-400"
            />
          </label>

          <ModelPicker
            selection={{
              providerId: meta.providerId ?? null,
              model: meta.model,
              reasoningEffort: meta.reasoningEffort ?? null,
            }}
            settings={settings}
            onSelect={onPick}
          />

          <button
            type="button"
            onClick={onOpenSettings}
            title="设置"
            className="shrink-0 rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ⚙
          </button>
        </header>

        {noProvider && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-700">
            还没有配置任何供应商，开演前先去
            <button type="button" onClick={onOpenSettings} className="mx-1 underline">
              设置
            </button>
            里加一个。
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl space-y-6">
            {messages.length === 0 && !streaming && (
              <p className="py-16 text-center text-xs text-neutral-400">
                空场。写下这一幕怎么演，第一段情节从这句开始。
              </p>
            )}

            {messages.map((message, index) =>
              message.role === 'director' ? (
                <Director
                  key={index}
                  message={message}
                  isLast={index === lastDirector}
                  hasNarrative={narrativeOf(message.turn) !== null}
                  busy={streaming || editBusy}
                  onRegenerate={() => void regenerate()}
                  onEdit={() => startEdit(message.turn)}
                  onDelete={() => void handleDelete(narrativeOf(message.turn) !== null)}
                />
              ) : message.role === 'narrative' ? (
                <Narrative
                  key={index}
                  message={message}
                  editing={editingTurn === message.turn}
                  editText={editText}
                  busy={editBusy}
                  canPickOptions={message.turn === lastTurn && !streaming && !ended}
                  onEditText={setEditText}
                  onSave={() => void saveEdit(message.turn)}
                  onCancel={cancelEdit}
                  onPickOption={pickOption}
                />
              ) : (
                <p key={index} className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">
                  {message.text}
                </p>
              ),
            )}

            {streaming && (
              <article>
                <NarrativeText text={streamText} caret />
              </article>
            )}

            <div ref={bottom} />
          </div>
        </div>

        {notice && (
          <div className="border-t border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-700">
            <div className="mx-auto flex max-w-2xl items-start justify-between gap-3">
              <p>{notice}</p>
              <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
                知道了
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-neutral-200 px-6 py-3">
          <div className="mx-auto max-w-2xl">
            <textarea
              ref={composer}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={3}
              disabled={streaming || ended}
              placeholder={ended ? '这场戏已落笔。想接着写，先在左栏选「重新开演」。' : '这一幕怎么演？'}
              className="w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm leading-6 outline-none placeholder:text-neutral-300 focus:border-neutral-400 disabled:bg-neutral-50 disabled:text-neutral-400"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-neutral-400">
                Enter 开演，Shift + Enter 换行
              </p>
              <div className="flex items-center gap-2">
                {streaming ? (
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                  >
                    停住
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(ended ? '重新开演？' : '就此落笔？之后还能重新开演。')) return
                        await setStatus(meta.id, ended ? 'active' : 'ended')
                      }}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                    >
                      {ended ? '重新开演' : '落笔'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submit()}
                      disabled={!draft.trim()}
                      className="rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      开演
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <aside className="flex w-[320px] shrink-0 flex-col">
        <div className="border-b border-neutral-200 px-4 py-2.5">
          <h2 className="text-xs font-semibold text-neutral-500">参演角色</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {cast.length === 0 && (
            <p className="px-1 py-2 text-xs text-neutral-400">
              这场戏没有参演角色。模型只能凭大纲硬写。
            </p>
          )}
          <ul className="space-y-2">
            {cast.map((id) => {
              const card = summaryOf(id)
              return (
                <li key={id} className="rounded-md border border-neutral-200">
                  <button
                    type="button"
                    onClick={() => openCard(id)}
                    className="block w-full px-3 pb-1.5 pt-2 text-left hover:bg-neutral-50"
                  >
                    {card ? (
                      <>
                        <span className="block truncate text-sm font-medium">{card.name}</span>
                        {card.tags.length > 0 && (
                          <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                            {card.tags.join(' · ')}
                          </span>
                        )}
                        {card.description && (
                          <span className="mt-1 line-clamp-2 block text-[11px] leading-5 text-neutral-500">
                            {card.description}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="block truncate text-sm text-red-600">角色缺失</span>
                        <span className="mt-0.5 block truncate text-[11px] text-neutral-400">{id}</span>
                      </>
                    )}
                  </button>
                  {card && (
                    <StatusPanel
                      cardId={id}
                      items={itemsOf(id)}
                      values={valuesOf(id)}
                      recent={status?.recent ?? []}
                      staleTurns={staleTurns}
                      templateName={templateNameOf(id)}
                      disabled={streaming}
                      onSetValue={(item, value) => void setStatusValue(id, item, value).catch(() => {})}
                      onAddItem={(name, note) => void addStatusItem(id, name, note)}
                      onRemoveItem={(item) => void removeStatusItem(id, item)}
                      onPickTemplate={() => {
                        void loadTemplates()
                        setPickFor(id)
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <div className="border-t border-neutral-200 px-3 py-2">
          <p className="text-[11px] leading-5 text-neutral-400">
            模型只写演员表上的角色。状态由 AI 每回合更新，点一下值可以自己改。
          </p>
        </div>
      </aside>

      <TemplatePickerDialog
        open={pickFor !== null}
        cardName={summaryOf(pickFor ?? '')?.name ?? pickFor ?? ''}
        templates={statusTemplates}
        currentId={pickFor ? (meta?.statusTemplateIds?.[pickFor] ?? null) : null}
        loading={statusTemplatesLoading}
        onClose={() => setPickFor(null)}
        onPick={(templateId) => {
          if (pickFor) void pickTemplate(pickFor, templateId)
        }}
      />
    </>
  )
}
