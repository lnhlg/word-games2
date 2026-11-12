import { useEffect, useRef, useState } from 'react'
import ModelPicker from './ModelPicker'
import { useApp } from './store'
import type { CharacterCard } from './types'

function Field({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <section>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</h3>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-neutral-700">{value}</p>
    </section>
  )
}

function CardPreview({ card }: { card: CharacterCard }) {
  const data = card.data
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-base font-semibold">{data.name}</h2>
        <p className="mt-1 text-[11px] text-neutral-400">
          {card.spec} · {card.spec_version}
        </p>
        {data.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <Field label="人物设定" value={data.description} />
      <Field label="性格" value={data.personality} />
      <Field label="处境" value={data.scenario} />
      <Field label="首次登场" value={data.first_mes} />
      <Field label="对话样例" value={data.mes_example} />
      <Field label="角色自带指令" value={data.system_prompt} />
      <Field label="附注（对话末尾注入）" value={data.post_history_instructions} />
      <Field label="作者备注" value={data.creator_notes} />

      {data.alternate_greetings.length > 0 && (
        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            备用开场 · {data.alternate_greetings.length}
          </h3>
          <ul className="mt-1 space-y-1">
            {data.alternate_greetings.map((greeting, index) => (
              <li key={index} className="whitespace-pre-wrap text-[13px] leading-6 text-neutral-600">
                {greeting}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.creator || data.character_version) && (
        <p className="text-[11px] text-neutral-400">
          {[data.creator, data.character_version].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

export default function CharactersView() {
  const {
    currentWorkspace,
    cardsLoading,
    selectedCard,
    selectedCardId,
    cardLoading,
    studioMessages,
    studioStreaming,
    studioText,
    studioSend,
    studioCancel,
    studioReset,
    settings,
    studioSelection,
    setStudioSelection,
    importCard,
    deleteCard,
  } = useApp()

  const [draft, setDraft] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [studioMessages.length, studioText])

  if (!currentWorkspace) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-400">先打开一个工作区。</p>
      </main>
    )
  }

  async function submit() {
    const text = draft.trim()
    if (!text || studioStreaming) return
    setDraft('')
    await studioSend(text)
  }

  async function tryDelete() {
    if (!selectedCard || !selectedCardId) return
    if (!window.confirm(`删除「${selectedCard.data.name}」？这个角色的卡文件会被移除。`)) return
    try {
      await deleteCard(selectedCardId)
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      if (text.includes('引用') && window.confirm('这张卡还有戏在用，那些会话会显示「角色缺失」。仍然删除？')) {
        await deleteCard(selectedCardId, true)
      }
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      await importCard(file)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col border-r border-neutral-200">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">工坊</h1>
            <p className="mt-0.5 truncate text-[11px] text-neutral-400">
              聊出一个人设，模型会把成品卡存进卡库
            </p>
          </div>
          {studioSelection && (
            <ModelPicker
              selection={studioSelection}
              settings={settings}
              onSelect={async (selection) => setStudioSelection(selection)}
            />
          )}
          <button
            type="button"
            onClick={studioReset}
            disabled={studioMessages.length === 0 || studioStreaming}
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
          >
            清空对话
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-2xl space-y-4">
            {studioMessages.length === 0 && !studioStreaming && (
              <div className="space-y-2 rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center">
                <p className="text-xs text-neutral-500">
                  从一句想法开始，比如「一个嘴上不饶人、其实心软的旧书店老板，民国背景」。
                </p>
                <p className="text-[11px] text-neutral-400">
                  设定聊得差不多，模型会自己落卡；之后每次改设定都会更新同一张卡。
                </p>
              </div>
            )}

            {studioMessages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13px] leading-6 ${
                    message.role === 'user'
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-700'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {studioStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-3.5 py-2.5 text-[13px] leading-6 text-neutral-700">
                  {studioText || '…'}
                  <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-neutral-400 align-middle" />
                </div>
              </div>
            )}

            <div ref={bottom} />
          </div>
        </div>

        <div className="border-t border-neutral-200 px-6 py-3">
          <div className="mx-auto max-w-2xl">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={3}
              disabled={studioStreaming}
              placeholder="想一个什么样的角色？"
              className="w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm leading-6 outline-none placeholder:text-neutral-300 focus:border-neutral-400 disabled:bg-neutral-50"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-neutral-400">Enter 发送，Shift + Enter 换行</p>
              {studioStreaming ? (
                <button
                  type="button"
                  onClick={studioCancel}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  停住
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!draft.trim()}
                  className="rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      <aside className="flex w-[340px] shrink-0 flex-col">
        <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-500">
            {selectedCard ? '卡片预览' : cardsLoading ? '载入卡库…' : '卡库'}
          </h2>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.png,application/json,image/png"
            className="hidden"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
          >
            导入卡
          </button>
          {selectedCard && (
            <button
              type="button"
              onClick={() => void tryDelete()}
              className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
            >
              删除
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {cardLoading && <p className="text-xs text-neutral-400">载入…</p>}

          {!cardLoading && !selectedCard && (
            <div className="space-y-3 rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center">
              <p className="text-xs text-neutral-500">卡库还是空的。</p>
              <p className="text-[11px] leading-5 text-neutral-400">
                在工坊里聊出一个角色，或者「导入卡」选一个酒馆 V2 的 .json / 带 chara 数据的 .png。
              </p>
            </div>
          )}

          {!cardLoading && selectedCard && <CardPreview card={selectedCard} />}

          {!cardLoading && selectedCard && (
            <p className="mt-6 border-t border-neutral-100 pt-3 text-[11px] leading-5 text-neutral-400">
              卡存在 <code className="text-neutral-500">characters/{selectedCardId}.json</code>，是酒馆 V2
              原样格式。要改设定，直接编辑这个文件。
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
