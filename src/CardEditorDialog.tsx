import { useEffect, useState } from 'react'
import type { CharacterCard, CharacterCardData } from './types'

interface Draft {
  name: string
  tags: string
  description: string
  personality: string
  scenario: string
  firstMes: string
  mesExample: string
  systemPrompt: string
  postHistoryInstructions: string
  creatorNotes: string
  alternateGreetings: string
}

const GREETING_SEPARATOR = /\n\s*---\s*\n/

function toDraft(data: CharacterCardData): Draft {
  return {
    name: data.name,
    tags: data.tags.join('，'),
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    firstMes: data.first_mes,
    mesExample: data.mes_example,
    systemPrompt: data.system_prompt,
    postHistoryInstructions: data.post_history_instructions,
    creatorNotes: data.creator_notes,
    alternateGreetings: data.alternate_greetings.join('\n---\n'),
  }
}

function toData(data: CharacterCardData, draft: Draft): CharacterCardData {
  return {
    ...data,
    name: draft.name.trim(),
    tags: draft.tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    first_mes: draft.firstMes,
    mes_example: draft.mesExample,
    system_prompt: draft.systemPrompt,
    post_history_instructions: draft.postHistoryInstructions,
    creator_notes: draft.creatorNotes,
    alternate_greetings: draft.alternateGreetings
      .split(GREETING_SEPARATOR)
      .map((greeting) => greeting.trim())
      .filter(Boolean),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function TextField({
  label,
  hint,
  value,
  rows,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  rows: number
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-neutral-500">
        {label}
        {hint && <span className="ml-1.5 font-normal text-neutral-400">{hint}</span>}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] leading-6 outline-none placeholder:text-neutral-300 focus:border-neutral-400"
      />
    </label>
  )
}

interface Props {
  open: boolean
  card: CharacterCard | null
  onClose: () => void
  onSave: (data: CharacterCardData) => Promise<void>
}

/** 手工编辑弹窗：只改 data 段；extensions、character_book 等额外字段保持原样。 */
export default function CardEditorDialog({ open, card, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !card) return
    setDraft(toDraft(card.data))
    setError(null)
  }, [open, card])

  if (!open || !draft) return null

  function update(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }

  async function save() {
    if (!card || !draft) return
    if (!draft.name.trim()) {
      setError('角色名不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(toData(card.data, draft))
      onClose()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={onClose}>
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <header className="border-b border-neutral-200 px-5 py-3">
          <h2 className="text-sm font-semibold">编辑角色卡</h2>
          <p className="mt-0.5 text-[11px] text-neutral-400">
            改的是这张卡的 data 段；extensions、character_book 等额外字段保持原样。
          </p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-neutral-500">角色名</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none placeholder:text-neutral-300 focus:border-neutral-400"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-neutral-500">
                标签 <span className="font-normal text-neutral-400">逗号分隔</span>
              </span>
              <input
                value={draft.tags}
                onChange={(event) => update({ tags: event.target.value })}
                placeholder="民国，克制"
                className="mt-1 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-[13px] outline-none placeholder:text-neutral-300 focus:border-neutral-400"
              />
            </label>
          </div>

          <TextField
            label="人物设定"
            hint="description"
            value={draft.description}
            rows={8}
            onChange={(description) => update({ description })}
          />
          <TextField
            label="性格"
            hint="personality"
            value={draft.personality}
            rows={4}
            onChange={(personality) => update({ personality })}
          />
          <TextField
            label="处境"
            hint="scenario"
            value={draft.scenario}
            rows={4}
            onChange={(scenario) => update({ scenario })}
          />
          <TextField
            label="首次登场"
            hint="first_mes"
            value={draft.firstMes}
            rows={6}
            onChange={(firstMes) => update({ firstMes })}
          />
          <TextField
            label="对话样例"
            hint="mes_example"
            value={draft.mesExample}
            rows={6}
            onChange={(mesExample) => update({ mesExample })}
          />
          <TextField
            label="角色自带指令"
            hint="system_prompt"
            value={draft.systemPrompt}
            rows={5}
            onChange={(systemPrompt) => update({ systemPrompt })}
          />
          <TextField
            label="附注"
            hint="post_history_instructions"
            value={draft.postHistoryInstructions}
            rows={3}
            onChange={(postHistoryInstructions) => update({ postHistoryInstructions })}
          />
          <TextField
            label="作者备注"
            hint="creator_notes"
            value={draft.creatorNotes}
            rows={3}
            onChange={(creatorNotes) => update({ creatorNotes })}
          />
          <TextField
            label="备用开场"
            hint="多条之间用单独一行的 --- 分隔"
            value={draft.alternateGreetings}
            rows={8}
            onChange={(alternateGreetings) => update({ alternateGreetings })}
          />
        </div>

        <footer className="border-t border-neutral-200 px-5 py-3">
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
