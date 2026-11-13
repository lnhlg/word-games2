import { useEffect, useRef, useState } from 'react'
import AddCastDialog from './AddCastDialog'
import ModelPicker, { type PickerSelection } from './ModelPicker'
import OptionsIdeaBox from './OptionsIdeaBox'
import SelectionToolbar, { type ToolbarAnchor } from './SelectionToolbar'
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

/** 选区起点之前的文字（相对于整段情节节点）。 */
function textBefore(node: HTMLElement, range: Range): string {
  const pre = document.createRange()
  pre.selectNodeContents(node)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString()
}

/** 选区终点之后的文字。 */
function textAfter(node: HTMLElement, range: Range): string {
  const post = document.createRange()
  post.selectNodeContents(node)
  post.setStart(range.endContainer, range.endOffset)
  return post.toString()
}

interface SelectionState {
  turn: number
  /** 选中的文字。 */
  text: string
  /** 选区前 40 字，用于后端消歧定位。 */
  before: string
  /** 选区后 40 字。 */
  after: string
  anchor: ToolbarAnchor
}

interface NarrativeProps {
  message: Extract<MessageRecord, { role: 'narrative' }>
  editing: boolean
  editText: string
  busy: boolean
  canPickOptions: boolean
  /** 正在为这一回合重新想选项。 */
  optionsBusy: boolean
  /** 这一回合的「想往哪走」输入框是否展开。 */
  optionsPromptOpen: boolean
  optionsIdea: string
  /** 刚被 AI 改写过多，显示一次「撤销」。 */
  undoable: boolean
  onEditText: (text: string) => void
  onSave: () => void
  onCancel: () => void
  onPickOption: (text: string) => void
  onOpenOptionsPrompt: () => void
  onOptionsIdea: (text: string) => void
  onSubmitOptions: () => void
  onCancelOptions: () => void
  onUndo: () => void
}

function Narrative({
  message,
  editing,
  editText,
  busy,
  canPickOptions,
  optionsBusy,
  optionsPromptOpen,
  optionsIdea,
  undoable,
  onEditText,
  onSave,
  onCancel,
  onPickOption,
  onOpenOptionsPrompt,
  onOptionsIdea,
  onSubmitOptions,
  onCancelOptions,
  onUndo,
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
    <article className="space-y-1.5" data-narrative-turn={message.turn}>
      <NarrativeText text={message.text} />
      {message.instruction && (
        <p className="line-clamp-2 text-[11px] text-neutral-400" title={message.instruction}>
          按「{message.instruction}」重写
        </p>
      )}
      {message.edited && (
        <p className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          {undoable ? (
            <>
              <span>已改写</span>
              <button
                type="button"
                disabled={busy}
                onClick={onUndo}
                className="underline underline-offset-2 hover:text-neutral-700 disabled:opacity-40"
              >
                撤销
              </button>
            </>
          ) : (
            <span>已编辑</span>
          )}
        </p>
      )}
      {message.interrupted && (
        <p className="text-xs italic text-neutral-400">（写到一半被打断了）</p>
      )}
      {message.nextOptions && message.nextOptions.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-neutral-400">接下来可以这么演</p>
            {canPickOptions && (
              <button
                type="button"
                disabled={optionsBusy}
                onClick={onOpenOptionsPrompt}
                title="按最后一回合的结尾再想一批，可先写一句想往哪走"
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
              >
                {optionsBusy ? '想选项中…' : '换一批'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {message.nextOptions.map((option, index) =>
              canPickOptions ? (
                <button
                  key={index}
                  type="button"
                  disabled={optionsBusy}
                  onClick={() => onPickOption(option)}
                  className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40"
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
      {canPickOptions && (!message.nextOptions || message.nextOptions.length === 0) && (
        <div className="pt-1">
          <button
            type="button"
            disabled={optionsBusy}
            onClick={onOpenOptionsPrompt}
            className="rounded-full border border-dashed border-neutral-300 px-3 py-1 text-[11px] text-neutral-500 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40"
          >
            {optionsBusy ? '想选项中…' : '＋ 想几条接下来可以这么演'}
          </button>
        </div>
      )}
      {optionsPromptOpen && (
        <OptionsIdeaBox
          idea={optionsIdea}
          busy={optionsBusy}
          onChange={onOptionsIdea}
          onSubmit={onSubmitOptions}
          onCancel={onCancelOptions}
        />
      )}
    </article>
  )
}

interface DirectorProps {
  message: Extract<MessageRecord, { role: 'director' }>
  isLast: boolean
  hasNarrative: boolean
  busy: boolean
  /** 这一回合正在编辑重写要求：在导演条下方展开输入框。 */
  regenOpen: boolean
  regenText: string
  regenBusy: boolean
  onOpenRegenerate: () => void
  onRegenText: (text: string) => void
  onRegenSubmit: () => void
  onRegenCancel: () => void
  onEdit: () => void
  onDelete: () => void
}

function Director({
  message,
  isLast,
  hasNarrative,
  busy,
  regenOpen,
  regenText,
  regenBusy,
  onOpenRegenerate,
  onRegenText,
  onRegenSubmit,
  onRegenCancel,
  onEdit,
  onDelete,
}: DirectorProps) {
  return (
    <div className="group border-l-2 border-neutral-300 pl-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          导演 · 第 {message.turn} 回合
        </p>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {isLast && (
            <button
              type="button"
              disabled={busy}
              onClick={onOpenRegenerate}
              className={manageButton}
            >
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
      {regenOpen && (
        <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
          <textarea
            value={regenText}
            onChange={(event) => onRegenText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onRegenCancel()
              } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onRegenSubmit()
              }
            }}
            rows={2}
            autoFocus
            disabled={regenBusy}
            placeholder="这一遍想怎么改？留空 = 按原大纲再写一遍"
            className="w-full resize-none rounded border border-neutral-200 px-2 py-1.5 text-xs leading-5 outline-none placeholder:text-neutral-300 focus:border-neutral-400 disabled:bg-white disabled:text-neutral-400"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onRegenSubmit}
              disabled={regenBusy}
              className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {regenBusy ? '重写中…' : '重写'}
            </button>
            <button
              type="button"
              onClick={onRegenCancel}
              disabled={regenBusy}
              className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              取消
            </button>
            <span className="text-[11px] text-neutral-400">Enter 重写 · Shift + Enter 换行</span>
          </div>
        </div>
      )}
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
    refreshOptions,
    editNarrative,
    rewriteSelection,
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
    loadCards,
    addCast,
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
  /** 当前划中的一小段；非空时浮出改写工具条。 */
  const [selection, setSelectionState] = useState<SelectionState | null>(null)
  const [instruction, setInstruction] = useState('')
  const [rewriting, setRewriting] = useState(false)
  /** 正在展开「重新生成」输入框的那一回合；null 表示没展开。 */
  const [regenFor, setRegenFor] = useState<number | null>(null)
  const [regenText, setRegenText] = useState('')
  const [regenBusy, setRegenBusy] = useState(false)
  const [addCastOpen, setAddCastOpen] = useState(false)
  /** 正在加入的那张卡；加入期间对话框里的列表整体禁用。 */
  const [addingCast, setAddingCast] = useState<string | null>(null)
  /** 正在重新想选项的那一回合；null 表示没有在跑。 */
  const [optionsFor, setOptionsFor] = useState<number | null>(null)
  /** 正在写「想往哪走」的那一回合；null 表示输入框没开。 */
  const [optionsPromptFor, setOptionsPromptFor] = useState<number | null>(null)
  const [optionsIdea, setOptionsIdea] = useState('')
  /** 刚被改写的那一回合的替换前全文；只留最近一次，刷新即失效。 */
  const [undo, setUndo] = useState<{ turn: number; text: string } | null>(null)
  const lastInstruction = useRef('')
  const composer = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPerspectiveDraft(meta?.perspective ?? '第三人称限知')
    setPickFor(null)
    // 换了一场戏，上一场没提交的重写要求与选项想法都不该跟过来。
    setRegenFor(null)
    setRegenText('')
    setOptionsPromptFor(null)
    setOptionsIdea('')
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

  /** 读当前 DOM 选区：必须完整落在同一段情节里、并且含实际文字。 */
  function readSelection(): SelectionState | null {
    const active = window.getSelection()
    if (!active || active.isCollapsed || active.rangeCount === 0) return null
    const range = active.getRangeAt(0)
    const start = range.startContainer
    const startEl = start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element | null)
    const article = startEl?.closest('[data-narrative-turn]') as HTMLElement | null
    // 跨消息、跨回合的选区不认。
    if (!article || !article.contains(range.endContainer)) return null

    const text = active.toString()
    if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(text)) return null
    const turn = Number(article.dataset.narrativeTurn)
    if (!Number.isInteger(turn)) return null

    const rect = range.getBoundingClientRect()
    const below = rect.top < 96
    return {
      turn,
      text,
      before: textBefore(article, range).slice(-40),
      after: textAfter(article, range).slice(0, 40),
      anchor: {
        top: below ? rect.bottom + 8 : rect.top - 8,
        left: Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)),
        below,
      },
    }
  }

  function handleSelectionEnd() {
    const blocked =
      streaming ||
      editingTurn !== null ||
      rewriting ||
      regenFor !== null ||
      optionsFor !== null ||
      optionsPromptFor !== null
    if (blocked) return
    window.setTimeout(() => {
      const next = readSelection()
      setSelectionState(next)
      // 记住上一次用过的指令，下次选中同一场戏的段落时预填。
      if (next) setInstruction(lastInstruction.current)
    }, 0)
  }

  async function submitRewrite() {
    if (!selection || rewriting || streaming) return
    const target = selection
    // 先记下替换前的整段原文：撤销就是把它写回去（不恢复「已编辑」与选项）。
    const previousText = narrativeOf(target.turn)?.text ?? ''
    setRewriting(true)
    try {
      const result = await rewriteSelection(
        target.turn,
        target.text,
        target.before,
        target.after,
        instruction.trim(),
      )
      lastInstruction.current = instruction.trim()
      setUndo({ turn: target.turn, text: previousText })
      setSelectionState(null)
      setNotice(result.memoryStale ? '这一回合的原文已经压进摘要，改动不会同步进旧摘要。' : null)
    } catch {
      // 错误已经写进 store.error；浮条与指令都留着，方便换个说法再试。
    } finally {
      setRewriting(false)
    }
  }

  async function undoRewrite() {
    if (!undo || rewriting) return
    const target = undo
    setRewriting(true)
    try {
      await editNarrative(target.turn, target.text)
      setUndo(null)
    } catch {
      // 错误已经写进 store.error
    } finally {
      setRewriting(false)
    }
  }

  /** 点「重新生成」先展开输入框，问一句这一遍想怎么改。 */
  function openRegenerate(turn: number) {
    if (streaming || editBusy || rewriting) return
    // 已经开着就别重开，免得把写了半句的要求清掉。
    if (regenFor === turn) return
    setSelectionState(null)
    setEditingTurn(null)
    setRegenFor(turn)
    setRegenText('')
    // 两个输入框不同时开。
    setOptionsPromptFor(null)
    setOptionsIdea('')
  }

  function cancelRegenerate() {
    if (regenBusy) return
    setRegenFor(null)
    setRegenText('')
  }

  /** 提交重写；失败或中断时留着输入框，改一句还能再试。 */
  async function submitRegenerate() {
    if (regenBusy || streaming) return
    const text = regenText.trim()
    setRegenBusy(true)
    try {
      const ok = await regenerate(text)
      if (ok) {
        setRegenFor(null)
        setRegenText('')
      }
    } finally {
      setRegenBusy(false)
    }
  }

  function startEdit(turn: number) {
    const narrative = narrativeOf(turn)
    if (!narrative) return
    setSelectionState(null)
    setRegenFor(null)
    setRegenText('')
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
    setRegenFor(null)
    setRegenText('')
    try {
      await deleteLastTurn()
    } catch {
      // 错误已经写进 store.error
    }
  }

  /** 把卡库里的一张卡加进本场演员表；加完给一句提示，说明从下一回合起生效。 */
  async function addCastCard(cardId: string) {
    if (addingCast) return
    setAddingCast(cardId)
    try {
      await addCast(cardId)
      const name = cards.find((card) => card.id === cardId)?.name ?? cardId
      setNotice(
        `「${name}」已经加入，从下一回合起进入演员表；想让它出场，下一句大纲里交代一下。`,
      )
    } catch {
      // 错误已经写进 store.error
    } finally {
      setAddingCast(null)
    }
  }

  /** 点「换一批」先展开输入框，问一句这一批想往哪走；留空就是直接换。 */
  function openOptionsPrompt(turn: number) {
    if (optionsFor !== null || streaming) return
    // 已经开着就别重开，免得把写了半句的想法清掉。
    if (optionsPromptFor === turn) return
    setOptionsPromptFor(turn)
    setOptionsIdea('')
    // 两个输入框不同时开。
    setRegenFor(null)
    setRegenText('')
  }

  function cancelOptionsPrompt() {
    if (optionsFor !== null) return
    setOptionsPromptFor(null)
    setOptionsIdea('')
  }

  /** 提交想法；失败时输入框留着，改一句还能再试。 */
  async function submitOptionsPrompt(turn: number) {
    if (optionsFor !== null || streaming) return
    const idea = optionsIdea.trim()
    setOptionsFor(turn)
    try {
      await refreshOptions(turn, idea)
      setOptionsPromptFor(null)
      setOptionsIdea('')
    } catch {
      // 错误已经写进 store.error；输入框留着，改一句还能再试
    } finally {
      setOptionsFor(null)
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

        <div
          className="flex-1 overflow-y-auto px-6 py-6"
          onMouseUp={handleSelectionEnd}
          onScroll={() => setSelectionState(null)}
        >
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
                  busy={streaming || editBusy || rewriting || regenBusy || optionsFor !== null}
                  regenOpen={regenFor === message.turn}
                  regenText={regenText}
                  regenBusy={regenBusy}
                  onOpenRegenerate={() => openRegenerate(message.turn)}
                  onRegenText={setRegenText}
                  onRegenSubmit={() => void submitRegenerate()}
                  onRegenCancel={cancelRegenerate}
                  onEdit={() => startEdit(message.turn)}
                  onDelete={() => void handleDelete(narrativeOf(message.turn) !== null)}
                />
              ) : message.role === 'narrative' ? (
                <Narrative
                  key={index}
                  message={message}
                  editing={editingTurn === message.turn}
                  editText={editText}
                  busy={editBusy || rewriting || regenBusy || optionsFor !== null}
                  canPickOptions={message.turn === lastTurn && !streaming && !ended && !regenBusy}
                  optionsBusy={optionsFor === message.turn}
                  optionsPromptOpen={optionsPromptFor === message.turn}
                  optionsIdea={optionsIdea}
                  undoable={undo?.turn === message.turn && !streaming}
                  onEditText={setEditText}
                  onSave={() => void saveEdit(message.turn)}
                  onCancel={cancelEdit}
                  onPickOption={pickOption}
                  onOpenOptionsPrompt={() => openOptionsPrompt(message.turn)}
                  onOptionsIdea={setOptionsIdea}
                  onSubmitOptions={() => void submitOptionsPrompt(message.turn)}
                  onCancelOptions={cancelOptionsPrompt}
                  onUndo={() => void undoRewrite()}
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
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2.5">
          <h2 className="text-xs font-semibold text-neutral-500">参演角色</h2>
          <button
            type="button"
            onClick={() => {
              void loadCards()
              setAddCastOpen(true)
            }}
            disabled={streaming}
            title="从卡库里加一个还没参演的角色"
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
          >
            ＋ 加角色
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {cast.length === 0 && (
            <p className="px-1 py-2 text-xs text-neutral-400">
              这场戏没有参演角色。模型只能凭大纲硬写。点右上角「＋ 加角色」从卡库里挑人。
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

      <AddCastDialog
        open={addCastOpen}
        cast={cast}
        cards={cards}
        addingId={addingCast}
        onClose={() => setAddCastOpen(false)}
        onAdd={(cardId) => void addCastCard(cardId)}
        onGoCharacters={() => {
          setAddCastOpen(false)
          setView('characters')
        }}
      />

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

      <SelectionToolbar
        anchor={selection?.anchor ?? null}
        instruction={instruction}
        busy={rewriting}
        onChange={setInstruction}
        onSubmit={() => void submitRewrite()}
        onClose={() => setSelectionState(null)}
      />
    </>
  )
}
