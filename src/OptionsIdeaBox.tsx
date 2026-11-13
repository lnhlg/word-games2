import type { KeyboardEvent } from 'react'

/**
 * 「换一批」选项时展开的小输入框：写一句想让剧情往哪走，交给模型控制方向。
 * 留空直接提交 = 不限定方向，只按最后一回合的结尾换一批。
 */

interface Props {
  idea: string
  busy: boolean
  onChange: (text: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function OptionsIdeaBox({ idea, busy, onChange, onSubmit, onCancel }: Props) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
      <textarea
        value={idea}
        rows={2}
        autoFocus
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="这一批想往哪走？留空 = 直接换一批"
        className="w-full resize-none rounded border border-neutral-200 px-2 py-1.5 text-xs leading-5 outline-none placeholder:text-neutral-300 focus:border-neutral-400 disabled:bg-white disabled:text-neutral-400"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? '想选项中…' : '生成选项'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
        >
          取消
        </button>
        <span className="text-[11px] text-neutral-400">Enter 生成 · Shift + Enter 换行</span>
      </div>
    </div>
  )
}
