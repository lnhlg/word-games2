import { useRef } from 'react'

/**
 * 选中情节正文里的一小段之后浮出来的工具条：
 * 四个预设各是一句完整的改写要求，点一下填进输入框；也可以自己写。
 * 留空提交 = 润色。见 docs/adr/0003-selection-rewrite.md。
 */

export interface ToolbarAnchor {
  /** 浮条要贴的纵向位置（视口坐标）。 */
  top: number
  /** 选区水平中心。 */
  left: number
  /** true 时向下展开（选区贴着屏幕顶部）。 */
  below: boolean
}

const PRESETS: Array<{ label: string; prompt: string }> = [
  { label: '润色', prompt: '把这段润色一遍：改掉别扭的措辞，保持原意。' },
  { label: '更紧凑', prompt: '把这段改紧凑些：删掉多余的字和重复的修辞，意思不变。' },
  { label: '写细一点', prompt: '把这段写细一点：补上动作、神态或环境的具体细节，不要增加新的情节。' },
  { label: '换个语气', prompt: '换一种语气：比原来更冷、更克制，意思不变。' },
]

interface Props {
  anchor: ToolbarAnchor | null
  instruction: string
  busy: boolean
  onChange: (text: string) => void
  onSubmit: () => void
  onClose: () => void
}

export default function SelectionToolbar({
  anchor,
  instruction,
  busy,
  onChange,
  onSubmit,
  onClose,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  if (!anchor) return null

  return (
    <div
      data-selection-toolbar
      className="fixed z-40 w-[420px] max-w-[90vw] rounded-lg border border-neutral-200 bg-white p-2 shadow-xl"
      style={{
        top: anchor.top,
        left: anchor.left,
        transform: anchor.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={busy}
            onClick={() => {
              onChange(preset.prompt)
              input.current?.focus()
            }}
            className="rounded-full border border-neutral-200 px-2.5 py-0.5 text-[11px] text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-40"
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          title="关掉"
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ×
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          ref={input}
          value={instruction}
          disabled={busy}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onSubmit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder="想怎么改？留空 = 润色"
          className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-xs outline-none placeholder:text-neutral-300 focus:border-neutral-400 disabled:bg-neutral-50"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="shrink-0 rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? '改写中…' : '改写'}
        </button>
      </div>
    </div>
  )
}
