import { useEffect, useState, type FormEvent } from 'react'
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
    creating,
    error,
    load,
    openWorkspace,
    create,
    select,
  } = useApp()
  const current = sessions.find((s) => s.id === currentId) ?? null
  const workspace = workspaces.find((w) => w.path === currentWorkspace) ?? null
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftPath, setDraftPath] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  async function submitWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!draftPath.trim()) return
    try {
      await openWorkspace(draftPath.trim())
      setPickerOpen(false)
      setDraftPath('')
    } catch {
      // store 已记录错误，输入框留着让用户改
    }
  }

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
              onClick={() => setPickerOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-left text-xs hover:bg-neutral-50"
            >
              <span className="shrink-0 text-neutral-400">工作区</span>
              <span className="min-w-0 flex-1 truncate text-neutral-700">
                {workspace ? workspace.name : '未打开'}
              </span>
              <span className="shrink-0 text-neutral-400">▾</span>
            </button>

            {pickerOpen && (
              <form
                onSubmit={submitWorkspace}
                className="mt-2 space-y-2 rounded-md border border-neutral-200 p-2"
              >
                <input
                  autoFocus
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder="目录绝对路径，如 D:\\games\\雾港"
                  className="w-full rounded border border-neutral-200 px-2 py-1.5 text-xs outline-none focus:border-neutral-400"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-700"
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                  >
                    取消
                  </button>
                </div>

                {workspaces.length > 0 && (
                  <div className="space-y-1 border-t border-neutral-100 pt-2">
                    <p className="text-[11px] text-neutral-400">最近打开</p>
                    {workspaces.map((w) => (
                      <button
                        key={w.path}
                        type="button"
                        title={w.path}
                        onClick={() => {
                          setDraftPath(w.path)
                          void openWorkspace(w.path)
                            .then(() => setPickerOpen(false))
                            .catch(() => {})
                        }}
                        className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-neutral-600 hover:bg-neutral-50"
                      >
                        📁 {w.name}
                      </button>
                    ))}
                  </div>
                )}
              </form>
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
            {sessions.map((s) => {
              const active = s.id === currentId
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => select(s.id)}
                    className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                      active ? 'bg-neutral-100' : 'hover:bg-neutral-50'
                    }`}
                  >
                    <span className="block truncate text-sm">{s.title}</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">
                      回合 {s.turn} · {relativeTime(s.updatedAt)}
                      {s.status === 'ended' && ' · 已结束'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-400">
          设置 · 模型切换（待接入）
        </div>
      </aside>

      {/* 中栏：消息流 + composer */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{current ? current.title : '未选择会话'}</h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              {current
                ? `回合 ${current.turn} · ${current.model}`
                : currentWorkspace
                  ? '从左侧选一局，或新建'
                  : '先打开工作区'}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6">
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
          {current && (
            <div className="mx-auto max-w-2xl rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500">
              <p className="font-medium text-neutral-700">会话已就绪</p>
              <p className="mt-2">
                会话文件夹：{' '}
                <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
                  {currentWorkspace}/{current.id}/
                </code>
              </p>
              <p className="mt-1">下一张票接入叙事引擎：玩家输入 → 真模型 → 流式叙事 + 工具卡 + 选项。</p>
            </div>
          )}
        </div>

        <div className="border-t border-neutral-200 p-3">
          <div className="mx-auto max-w-2xl">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-400">
              输入框待下一张票接入（#3 第一回合）
            </div>
          </div>
        </div>
      </main>

      {/* 右栏：状态面板 */}
      <aside className="flex w-[320px] shrink-0 flex-col border-l border-neutral-200">
        <div className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold">状态</div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">属性</h2>
            <div className="space-y-1.5">
              {['洞察', '胆识', '共情'].map((name) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-neutral-600">{name}</span>
                  <span className="text-neutral-400">— / 5</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">背包</h2>
            <p className="text-xs text-neutral-400">空</p>
          </section>
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">场景</h2>
            <p className="text-xs text-neutral-400">—</p>
          </section>
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
