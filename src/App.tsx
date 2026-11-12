import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { SessionMeta } from './api'
import { useApp, type ToolCard } from './store'
import type { MessageRecord } from './types'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

interface DisplayItem {
  key: string
  kind: 'player' | 'engine' | 'tool' | 'system'
  text?: string
  tool?: ToolCard
  turn?: number
  at?: string
}

/** 回合分隔线的时间戳：HH:mm */
function clockTime(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const TOOL_LABELS: Record<string, string> = {
  move_to: '移动',
  lookup_lore: '查阅',
  roll_check: '判定',
  set_flag: '标记',
  add_item: '获得',
  remove_item: '失去',
  trigger_ending: '结局',
  end_turn: '结束回合',
}

function toDisplay(messages: MessageRecord[]): DisplayItem[] {
  const items: DisplayItem[] = []
  const toolIndex = new Map<string, number>()
  const turnAt = new Map<number, string>()
  for (const message of messages) {
    if (message.role === 'player' && !turnAt.has(message.turn)) turnAt.set(message.turn, message.at)
  }

  messages.forEach((message, index) => {
    const at = 'turn' in message ? turnAt.get(message.turn) : undefined
    if (message.role === 'player') {
      items.push({ key: `p-${index}`, kind: 'player', text: message.text, turn: message.turn, at })
    } else if (message.role === 'engine' && message.kind === 'text') {
      items.push({ key: `e-${index}`, kind: 'engine', text: message.text, turn: message.turn, at })
    } else if (message.role === 'engine' && message.kind === 'tool_call') {
      items.push({
        key: `t-${index}`,
        kind: 'tool',
        tool: { id: message.id, name: message.name, args: message.args },
        turn: message.turn,
        at,
      })
      toolIndex.set(message.id, items.length - 1)
    } else if (message.role === 'tool') {
      const hit = toolIndex.get(message.callId)
      if (hit !== undefined) {
        const previous = items[hit]
        items[hit] = { ...previous, tool: { ...previous.tool!, ok: message.ok, result: message.result } }
      }
    } else if (message.role === 'engine' && message.kind === 'options') {
      // 选项条单独渲染在 composer 上方，这里不重复
    } else if (message.role === 'system') {
      items.push({ key: `s-${index}`, kind: 'system', text: message.text })
    }
  })

  return items
}

function toolSummary(tool: ToolCard): string {
  const result = tool.result as Record<string, unknown> | undefined
  if (tool.ok === undefined) return '进行中…'
  if (tool.name === 'roll_check' && result) {
    return `${result.attribute} ${result.total} vs ${result.dc} · ${result.success ? '成功' : '失败'}`
  }
  if (tool.name === 'move_to' && result) return `→ ${String(result.scene ?? '')}`
  if (tool.name === 'end_turn' && result && Array.isArray(result.options)) {
    return `${result.options.length} 个选项`
  }
  if (tool.name === 'add_item' && result) return `+ ${String(result.item ?? '')}`
  if (tool.name === 'remove_item' && result) return `− ${String(result.item ?? '')}`
  if (tool.name === 'trigger_ending' && result) return `结局：${String(result.ending ?? '')}`
  if (tool.name === 'set_flag' && result) return `${String(result.flag ?? '')} = ${String(result.value ?? '')}`
  return tool.ok ? '完成' : '失败'
}

function ToolCardView({ tool }: { tool: ToolCard }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="shrink-0">{tool.ok === false ? '❌' : tool.ok ? '✅' : '⏳'}</span>
        <span className="shrink-0 font-medium text-neutral-700" title={tool.name}>
          {TOOL_LABELS[tool.name] ?? tool.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-neutral-500">{toolSummary(tool)}</span>
        <span className="shrink-0 text-neutral-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-neutral-200 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-600">
          <div>
            <span className="text-neutral-400">参数 </span>
            {JSON.stringify(tool.args)}
          </div>
          {tool.result !== undefined && (
            <div>
              <span className="text-neutral-400">结果 </span>
              {JSON.stringify(tool.result)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const {
    workspaces,
    currentWorkspace,
    sessions,
    currentId,
    loading,
    creating,
    error,
    meta,
    messages,
    gameState,
    streaming,
    streamText,
    liveTools,
    options,
    load,
    pick,
    openWorkspace,
    create,
    select,
    send,
    cancel,
    rename,
    setStatus,
    remove,
    exportMarkdown,
    rollback,
  } = useApp()

  const current = sessions.find((session) => session.id === currentId) ?? null
  const workspace = workspaces.find((w) => w.path === currentWorkspace) ?? null
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo(() => toDisplay(messages), [messages])
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, streamText, liveTools])

  const lastOptions = useMemo(() => {
    if (options.length > 0) return options
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role === 'engine' && message.kind === 'options') return message.options
    }
    return []
  }, [messages, options])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuFor])

  async function handlePick() {
    await pick()
    setPickerOpen(false)
  }

  function startRename(session: SessionMeta) {
    setEditingId(session.id)
    setEditingTitle(session.title)
    setMenuFor(null)
  }

  async function commitRename(id: string) {
    const title = editingTitle.trim()
    setEditingId(null)
    if (!title) return
    try {
      await rename(id, title)
    } catch {
      // 错误已进 store 的 error
    }
  }

  async function download(session: SessionMeta) {
    setMenuFor(null)
    try {
      const markdown = await exportMarkdown(session.id)
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${session.title}.md`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      // 错误已进 store 的 error
    }
  }

  async function toggleEnded(session: SessionMeta) {
    setMenuFor(null)
    await setStatus(session.id, session.status === 'ended' ? 'active' : 'ended')
  }

  async function confirmRemove(session: SessionMeta) {
    setMenuFor(null)
    if (!window.confirm(`删除「${session.title}」？整个会话文件夹会被移除，无法撤销。`)) return
    await remove(session.id)
  }

  async function rollbackOne(session: SessionMeta) {
    setMenuFor(null)
    const target = session.turn - 2
    if (target < 0) return
    if (!window.confirm(`回到回合 ${target + 1} 结束时的状态？之后的回合会从消息流收起。`)) return
    try {
      await rollback(target)
    } catch {
      // 错误已进 store 的 error
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await send(text)
    composerRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const title = meta?.title ?? current?.title ?? '未选择会话'
  const turn = meta?.turn ?? current?.turn ?? 0
  const model = meta?.model ?? current?.model ?? ''

  return (
    <div className="flex h-screen bg-white text-neutral-900">
      {/* 左栏：工作区 + 会话列表 */}
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight">word-games</span>
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating || !currentWorkspace}
              className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? '新建中…' : '＋ 新建'}
            </button>
          </div>

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setPickerOpen((value) => !value)}
              className="flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
            >
              <span className="shrink-0 text-neutral-400">工作区</span>
              <span className="min-w-0 flex-1 truncate text-neutral-700">
                {workspace ? workspace.name : '未打开'}
              </span>
              <span className="shrink-0 text-neutral-400">▾</span>
            </button>

            {pickerOpen && (
              <div className="mt-2 space-y-2 rounded-md border border-neutral-200 p-2">
                <button
                  type="button"
                  onClick={() => void handlePick()}
                  className="w-full rounded bg-neutral-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                >
                  📂 选择目录…
                </button>

                {workspaces.length > 0 && (
                  <div className="space-y-1 border-t border-neutral-100 pt-2">
                    <p className="text-[11px] text-neutral-400">最近打开</p>
                    {workspaces.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        title={item.path}
                        onClick={() => {
                          void openWorkspace(item.path)
                            .then(() => setPickerOpen(false))
                            .catch(() => {})
                        }}
                        className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-50"
                      >
                        📁 {item.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading && <p className="px-2 py-3 text-xs text-neutral-400">载入中…</p>}
          {!loading && !currentWorkspace && (
            <p className="px-2 py-3 text-xs text-neutral-400">先打开一个工作区，再新建一局。</p>
          )}
          {!loading && currentWorkspace && sessions.length === 0 && (
            <p className="px-2 py-3 text-xs text-neutral-400">这个工作区还没有会话，点右上角新建一局。</p>
          )}
          <ul className="space-y-1">
            {sessions.map((session) => {
              const active = session.id === currentId
              const editing = editingId === session.id
              return (
                <li key={session.id} className="group relative">
                  {editing ? (
                    <div className="rounded-md border border-neutral-300 px-2.5 py-2">
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitRename(session.id)
                          if (event.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => void commitRename(session.id)}
                        className="w-full rounded border border-neutral-200 px-1.5 py-1 text-sm outline-none focus:border-neutral-400"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => select(session.id)}
                      className={`w-full rounded-md px-2.5 py-2 pr-8 text-left transition-colors ${
                        active ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <span
                        className={`block truncate text-sm ${
                          session.status === 'ended' ? 'text-neutral-400' : ''
                        }`}
                      >
                        {session.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        回合 {session.turn} · {relativeTime(session.updatedAt)}
                        {session.status === 'ended' && ' · 已结束'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    title="会话操作"
                    onClick={(event) => {
                      event.stopPropagation()
                      setMenuFor(menuFor === session.id ? null : session.id)
                    }}
                    className="absolute right-1.5 top-1.5 rounded px-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100"
                  >
                    ⋯
                  </button>

                  {menuFor === session.id && (
                    <div className="absolute right-1.5 top-8 z-20 w-40 overflow-hidden rounded-md border border-neutral-200 bg-white text-xs shadow-lg">
                      <button
                        type="button"
                        onClick={() => startRename(session)}
                        className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        onClick={() => void download(session)}
                        className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        导出 Markdown
                      </button>
                      <button
                        type="button"
                        onClick={() => void rollbackOne(session)}
                        disabled={session.turn < 2}
                        title={session.turn < 2 ? '还没有可回滚的回合' : '把状态恢复到上一回合结束'}
                        className="block w-full px-3 py-2 text-left hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-neutral-300"
                      >
                        回到上一回合
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleEnded(session)}
                        className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        {session.status === 'ended' ? '重新打开' : '结束这局'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmRemove(session)}
                        className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
                      >
                        删除
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-400">
          设置 · 模型切换（待接入）
        </div>
      </aside>

      {/* 中栏：消息流 + 选项 + composer */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              {current ? `回合 ${turn} · ${model}` : currentWorkspace ? '从左侧选一局，或新建' : '先打开工作区'}
            </p>
          </div>
          {streaming && (
            <button
              type="button"
              onClick={cancel}
              className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              中断
            </button>
          )}
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
          {!currentWorkspace && (
            <div className="mx-auto mt-16 max-w-md text-center text-sm text-neutral-400">
              还没有工作区。工作区是磁盘上的一个目录，像 DSH 一样先打开它，再在里面新建会话。
            </div>
          )}
          {currentWorkspace && !current && (
            <div className="mx-auto mt-16 max-w-md text-center text-sm text-neutral-400">
              这个工作区还没有会话。点左上角「＋ 新建」开一局。
            </div>
          )}
          {current && items.length === 0 && !streaming && (
            <div className="mx-auto mt-16 max-w-md text-center text-sm text-neutral-400">
              先说一句话，或者等一下开场。
            </div>
          )}

          {current && (
            <div className="mx-auto max-w-2xl space-y-3">
              {items.map((item, index) => {
                const showDivider =
                  item.turn !== undefined && item.turn !== items[index - 1]?.turn
                return (
                  <Fragment key={item.key}>
                    {showDivider && (
                      <div className="flex items-center gap-3 py-2 text-[11px] text-neutral-400">
                        <span className="h-px flex-1 bg-neutral-200" />
                        <span>
                          回合 {(item.turn ?? 0) + 1}
                          {clockTime(item.at) ? ` · ${clockTime(item.at)}` : ''}
                        </span>
                        <span className="h-px flex-1 bg-neutral-200" />
                      </div>
                    )}
                    {item.kind === 'player' && (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-neutral-200 bg-neutral-100 px-4 py-2.5 text-sm text-neutral-900 whitespace-pre-wrap">
                          {item.text}
                        </div>
                      </div>
                    )}
                    {item.kind === 'tool' && item.tool && <ToolCardView tool={item.tool} />}
                    {item.kind === 'system' && (
                      <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{item.text}</div>
                    )}
                    {item.kind === 'engine' && (
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
                        {item.text}
                      </div>
                    )}
                  </Fragment>
                )
              })}

              {streaming && (
                <div className="space-y-2">
                  {streamText && (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
                      {streamText}
                      <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-neutral-400 align-middle" />
                    </div>
                  )}
                  {liveTools.map((tool) => (
                    <ToolCardView key={tool.id} tool={tool} />
                  ))}
                  {!streamText && liveTools.length === 0 && (
                    <div className="text-sm text-neutral-400">引擎思考中…</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {lastOptions.length > 0 && (
          <div className="border-t border-neutral-200 px-5 py-2.5">
            <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
              {lastOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={streaming || !current}
                  onClick={() => void send(option)}
                  className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-neutral-200 p-3">
          <form onSubmit={(event) => void handleSubmit(event)} className="mx-auto max-w-2xl">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={!current}
              placeholder={current ? '你要做什么？（Enter 发送，Shift+Enter 换行）' : '先打开工作区并选一局'}
              className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-neutral-400 disabled:bg-neutral-50"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-neutral-400">Enter 发送 · Shift+Enter 换行</span>
              <button
                type="submit"
                disabled={streaming || !current || !draft.trim()}
                className="rounded-md bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {streaming ? '生成中…' : '发送'}
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* 右栏：真实状态 */}
      <aside className="flex w-[320px] shrink-0 flex-col border-l border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold">状态</div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {!gameState && <p className="text-xs text-neutral-400">暂无状态</p>}
          {gameState && (
            <>
              <section>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">属性</h2>
                <div className="space-y-1.5">
                  {Object.entries(gameState.stats).map(([name, value]) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-neutral-600">{name}</span>
                      <span className="text-neutral-500">{value} / 5</span>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">背包</h2>
                {gameState.inventory.length === 0 ? (
                  <p className="text-xs text-neutral-400">空</p>
                ) : (
                  <ul className="space-y-1">
                    {gameState.inventory.map((item) => (
                      <li key={item} className="text-neutral-700">
                        · {item}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">场景</h2>
                <p className="text-neutral-700">{gameState.scene}</p>
                <p className="mt-0.5 text-xs text-neutral-400">位置：{gameState.location}</p>
              </section>
              {gameState.lastCheck && (
                <section>
                  <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">上次判定</h2>
                  <p className="text-neutral-700">
                    {gameState.lastCheck.attribute} {gameState.lastCheck.total} vs {gameState.lastCheck.dc}
                    <span className={gameState.lastCheck.success ? 'text-green-600' : 'text-red-600'}>
                      {' '}
                      {gameState.lastCheck.success ? '成功' : '失败'}
                    </span>
                  </p>
                </section>
              )}
              {gameState.ending && (
                <section className="rounded-md bg-amber-50 p-3">
                  <h3 className="text-xs font-medium text-amber-700">结局</h3>
                  <p className="mt-1 text-sm text-amber-900">{gameState.ending}</p>
                </section>
              )}
            </>
          )}
        </div>
      </aside>

      {error && (
        <div className="fixed bottom-4 left-1/2 max-w-md -translate-x-1/2 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg">
          {error}
        </div>
      )}
    </div>
  )
}
