import { useEffect, useState } from 'react'
import { useApp } from './store'
import type { StatusItem } from './types'

const field =
  'w-full rounded-md border border-neutral-200 px-2.5 py-2 text-xs outline-none placeholder:text-neutral-300 focus:border-neutral-400'

interface Draft {
  id: string | null
  name: string
  note: string
  items: StatusItem[]
}

const emptyDraft: Draft = { id: null, name: '', note: '', items: [] }
const MAX_ITEMS = 8

/**
 * 状态模板库：工作区级、可复用的一组状态项。
 * 套到角色上是快照复制，因此这里改模板不会动已经开演的戏（ADR 0003）。
 */
export default function StatusTemplatesView() {
  const {
    currentWorkspace,
    statusTemplates,
    statusTemplatesLoading,
    selectedTemplateId,
    selectedTemplate,
    templateLoading,
    cards,
    loadTemplates,
    selectTemplate,
    createTemplateDoc,
    updateTemplateDoc,
    deleteTemplateDoc,
    suggestTemplateItems,
  } = useApp()

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [prompt, setPrompt] = useState('')
  const [refCardId, setRefCardId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // 列表里换了一份模板，就把编辑器切过去；正在新建（id 为 null）时不打断。
  useEffect(() => {
    if (!selectedTemplate) return
    if (selectedTemplate.id === draft.id) return
    setDraft({
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      note: selectedTemplate.note,
      items: selectedTemplate.items,
    })
    setNote(null)
  }, [selectedTemplate, draft.id])

  if (!currentWorkspace) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-400">先打开一个工作区。</p>
      </main>
    )
  }

  const full = draft.items.length >= MAX_ITEMS

  function startNew() {
    setDraft(emptyDraft)
    setPrompt('')
    setRefCardId('')
    setNote(null)
    void selectTemplate(null)
  }

  function setItem(index: number, patch: Partial<StatusItem>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }))
  }

  function addItem() {
    if (full) return
    setDraft((current) => ({ ...current, items: [...current.items, { name: '', note: '' }] }))
  }

  function removeItem(index: number) {
    setDraft((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }))
  }

  async function generate() {
    const text = prompt.trim()
    if (!text || generating) return
    setGenerating(true)
    setNote(null)
    try {
      const items = await suggestTemplateItems(text, refCardId || null)
      setDraft((current) => {
        const merged = [...current.items]
        for (const item of items) {
          if (merged.length >= MAX_ITEMS) break
          if (merged.some((entry) => entry.name === item.name)) continue
          merged.push(item)
        }
        return { ...current, items: merged }
      })
      if (items.length === 0) setNote('没有生成出条目，换个说法再试。')
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    const name = draft.name.trim()
    if (!name) {
      setNote('模板得有个名字。')
      return
    }
    setSaving(true)
    setNote(null)
    try {
      const items = draft.items
        .map((item) => ({ name: item.name.trim(), note: item.note.trim() }))
        .filter((item) => item.name)
      if (draft.id) {
        await updateTemplateDoc(draft.id, { name, note: draft.note, items })
      } else {
        const id = await createTemplateDoc({ name, note: draft.note, items })
        setDraft((current) => ({ ...current, id }))
      }
      await loadTemplates()
      setNote('已保存。')
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft.id) return
    if (!window.confirm(`删掉模板「${draft.name || draft.id}」？已经套用它的戏不受影响（存的是快照）。`)) {
      return
    }
    try {
      await deleteTemplateDoc(draft.id)
      setDraft(emptyDraft)
      setNote(null)
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col border-r border-neutral-200">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">状态模板</h1>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            一组可复用的状态项，套到角色上时复制一份进那场戏。
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
        >
          ＋ 新模板
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {statusTemplatesLoading && <p className="text-xs text-neutral-400">载入模板库…</p>}
          {!statusTemplatesLoading && statusTemplates.length === 0 && !draft.id && (
            <p className="rounded-md border border-dashed border-neutral-200 px-3 py-4 text-xs leading-5 text-neutral-400">
              模板库还是空的。写个名字、加几项，或者让 AI 帮你定一组。
            </p>
          )}

          <section className="space-y-2 rounded-lg border border-neutral-200 p-4">
            <label className="block text-[11px] text-neutral-500">
              模板名
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：毒医验伤"
                className={`${field} mt-1`}
              />
            </label>
            <label className="block text-[11px] text-neutral-500">
              说明（可空）
              <input
                value={draft.note}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="这份模板适合什么样的角色"
                className={`${field} mt-1`}
              />
            </label>
          </section>

          <section className="space-y-1 rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-500">
                状态项（{draft.items.length}/{MAX_ITEMS}）
              </span>
              <button
                type="button"
                onClick={addItem}
                disabled={full}
                className="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
              >
                ＋ 加一项
              </button>
            </div>
            {draft.items.length === 0 && (
              <p className="py-2 text-[11px] text-neutral-400">
                还没有条目。每项只要名称和一句「这一项看什么」，值由剧情推进。
              </p>
            )}
            <ul className="space-y-1.5">
              {draft.items.map((item, index) => (
                <li key={index} className="flex items-start gap-1.5">
                  <input
                    value={item.name}
                    onChange={(event) => setItem(index, { name: event.target.value })}
                    placeholder="名称"
                    className="w-28 shrink-0 rounded border border-neutral-200 px-1.5 py-1 text-xs outline-none focus:border-neutral-400"
                  />
                  <input
                    value={item.note}
                    onChange={(event) => setItem(index, { note: event.target.value })}
                    placeholder="这一项看什么（可空）"
                    className="min-w-0 flex-1 rounded border border-neutral-200 px-1.5 py-1 text-xs outline-none focus:border-neutral-400"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="shrink-0 rounded px-1 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                    title="删掉这一项"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
            <p className="text-[11px] text-neutral-500">让 AI 定一组（只给条目与说明，不给值）</p>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate()
              }}
              rows={2}
              placeholder="例如：毒医，身上带着慢性毒，跟沈砚互相试探。"
              className={`${field} resize-none leading-5`}
            />
            <div className="flex items-center gap-2">
              <select
                value={refCardId}
                onChange={(event) => setRefCardId(event.target.value)}
                className="rounded border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-600 outline-none"
              >
                <option value="">不参考角色（通用模板）</option>
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    参考 {card.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void generate()}
                disabled={generating || !prompt.trim() || full}
                className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
              >
                {generating ? '生成中…' : '生成条目'}
              </button>
            </div>
          </section>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !draft.name.trim()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {saving ? '保存中…' : draft.id ? '保存改动' : '存为新模板'}
            </button>
            {draft.id && (
              <button
                type="button"
                onClick={() => void remove()}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            )}
            {note && <span className="text-[11px] text-neutral-500">{note}</span>}
          </div>
        </div>
      </div>

      {templateLoading && <p className="border-t border-neutral-200 px-3 py-1 text-[10px] text-neutral-400">载入中…</p>}
    </main>
  )
}
