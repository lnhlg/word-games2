import { useEffect, useState } from 'react'
import CharactersView from './CharactersView'
import NewSessionDialog from './NewSessionDialog'
import PlayView from './PlayView'
import SettingsDialog from './SettingsDialog'
import StatusTemplatesView from './StatusTemplatesView'
import type { SessionMeta } from './api'
import { useApp } from './store'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export default function App() {
  const {
    workspaces,
    currentWorkspace,
    sessions,
    currentId,
    loading,
    error,
    view,
    setView,
    load,
    pick,
    openWorkspace,
    select,
    rename,
    setStatus,
    remove,
    exportMarkdown,
    loadSettings,
    settings,
    saveSettings,
    dismissError,
    retryInput,
    retry,
    streaming,
    cards,
    cardsLoading,
    selectedCardId,
    selectCard,
    loadCards,
    statusTemplates,
    statusTemplatesLoading,
    selectedTemplateId,
    selectTemplate,
    loadTemplates,
  } = useApp()

  const workspace = workspaces.find((w) => w.path === currentWorkspace) ?? null
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    void load()
    void loadSettings()
  }, [load, loadSettings])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuFor])

  async function handlePick() {
    await pick()
    setWorkspaceOpen(false)
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

  function startNewCharacter() {
    useApp.getState().studioReset()
    void selectCard(null)
    setView('characters')
  }

  return (
    <div className="flex h-screen bg-white text-neutral-900">
      {/* 左栏：视图切换 + 工作区 + 列表 */}
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-neutral-200">
        <div className="border-b border-neutral-200 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight">word-games</span>
            {view !== 'status-templates' && (
              <button
                type="button"
                onClick={() => {
                  if (!currentWorkspace) return
                  if (view === 'play') setNewSessionOpen(true)
                  else startNewCharacter()
                }}
                disabled={!currentWorkspace}
                className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {view === 'play' ? '＋ 新建' : '＋ 新角色'}
              </button>
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-neutral-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => setView('play')}
              className={`rounded px-1 py-1.5 font-medium ${
                view === 'play' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              剧场
            </button>
            <button
              type="button"
              onClick={() => setView('characters')}
              className={`rounded px-1 py-1.5 font-medium ${
                view === 'characters' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              角色
            </button>
            <button
              type="button"
              onClick={() => setView('status-templates')}
              className={`rounded px-1 py-1.5 font-medium ${
                view === 'status-templates' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'
              }`}
            >
              模板
            </button>
          </div>

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setWorkspaceOpen((value) => !value)}
              className="flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
            >
              <span className="shrink-0 text-neutral-400">工作区</span>
              <span className="min-w-0 flex-1 truncate text-neutral-700">
                {workspace ? workspace.name : '未打开'}
              </span>
              <span className="shrink-0 text-neutral-400">▾</span>
            </button>

            {workspaceOpen && (
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
                            .then(() => setWorkspaceOpen(false))
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
            <p className="px-2 py-3 text-xs text-neutral-400">先打开一个工作区，再开一场戏。</p>
          )}

          {view === 'play' && (
            <>
              {!loading && currentWorkspace && sessions.length === 0 && (
                <p className="px-2 py-3 text-xs text-neutral-400">这个工作区还没有戏，点右上角新建。</p>
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
                            {session.status === 'ended' && ' · 已落笔'}
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
                            导出小说
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleEnded(session)}
                            className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                          >
                            {session.status === 'ended' ? '重新开演' : '落笔'}
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
            </>
          )}

          {view === 'characters' && (
            <>
              {cardsLoading && <p className="px-2 py-3 text-xs text-neutral-400">载入卡库…</p>}
              {!cardsLoading && currentWorkspace && cards.length === 0 && (
                <p className="px-2 py-3 text-xs text-neutral-400">
                  卡库还是空的。用中间的工坊聊出一个角色，或导入酒馆角色卡。
                </p>
              )}
              <ul className="space-y-1">
                {cards.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => void selectCard(card.id)}
                      className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                        selectedCardId === card.id ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <span className="block truncate text-sm">{card.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-neutral-500">
                        {card.tags.length ? card.tags.join(' · ') : card.id}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {view === 'status-templates' && (
            <>
              {statusTemplatesLoading && <p className="px-2 py-3 text-xs text-neutral-400">载入模板库…</p>}
              {!statusTemplatesLoading && currentWorkspace && statusTemplates.length === 0 && (
                <p className="px-2 py-3 text-xs text-neutral-400">
                  模板库还是空的。在中间写一份状态模板，或者让 AI 定一组。
                </p>
              )}
              <ul className="space-y-1">
                {statusTemplates.map((template) => (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => void selectTemplate(template.id)}
                      className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                        selectedTemplateId === template.id ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <span className="block truncate text-sm">{template.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-neutral-500">
                        {template.itemCount} 项
                        {template.note ? ` · ${template.note}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="border-t border-neutral-200 p-2">
          {view === 'characters' && (
            <button
              type="button"
              onClick={() => void loadCards()}
              className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
            >
              刷新卡库
            </button>
          )}
          {view === 'status-templates' && (
            <button
              type="button"
              onClick={() => void loadTemplates()}
              className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
            >
              刷新模板库
            </button>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-full rounded-md px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
          >
            设置
          </button>
        </div>
      </aside>

      {view === 'play' ? (
        <PlayView onOpenSettings={() => setSettingsOpen(true)} />
      ) : view === 'characters' ? (
        <CharactersView />
      ) : (
        <StatusTemplatesView />
      )}

      <NewSessionDialog open={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
      />

      {error && (
        <div className="fixed bottom-4 left-1/2 z-40 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg">
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          {retryInput && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={streaming}
              className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={dismissError}
            title="关闭"
            className="shrink-0 rounded px-1.5 py-1 text-red-100 hover:bg-red-500"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
