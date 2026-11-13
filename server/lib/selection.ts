/**
 * 选区改写的定位：把界面上拖选的那段文字映射回磁盘原文的区间。
 *
 * 界面渲染文本与磁盘原文并不字面相同：段首缩进被剥掉、跨段时换行数量也不同，
 * 所以不能直接 indexOf。这里把原文与「选区前文 + 选区 + 选区后文」一起做去空白归一，
 * 在归一后的原文里找选区；命中唯一才返回原文区间，找不到或不唯一就放弃——
 * 宁可让导演重新选一次，也不能把改写拼到错误的位置。见 docs/adr/0003-selection-rewrite.md。
 */

export interface LocateInput {
  /** 磁盘上的原文全文。 */
  text: string
  /** 界面上选中的文字。 */
  selected: string
  /** 选区紧邻的前文（界面文本，取末尾若干字）；没有就省略。 */
  before?: string
  /** 选区紧邻的后文（界面文本，取开头若干字）；没有就省略。 */
  after?: string
}

export interface Located {
  /** 原文里的起始下标（含）。 */
  start: number
  /** 原文里的结束下标（不含）。 */
  end: number
}

/** 去空白时保留的原文下标：命中第 i 个字，对应 text 里的 map[i]。 */
interface Normalized {
  norm: string
  map: number[]
}

function normalize(text: string): Normalized {
  const chars: string[] = []
  const map: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (/\s/.test(char)) continue
    chars.push(char)
    map.push(i)
  }
  return { norm: chars.join(''), map }
}

function findAll(haystack: string, needle: string): number[] {
  const hits: number[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index < 0) break
    hits.push(index)
    from = index + 1
  }
  return hits
}

/** 前后文各取这么多个非空白字符来做消歧。 */
const NEARBY = 40

/**
 * 在原文里定位选区；返回的是原文区间（原文里的空白与缩进原样保留在区间之外）。
 * 找不到、或出现多次且前后文也分不出是哪一处，返回 null。
 */
export function locateSelection(input: LocateInput): Located | null {
  const { norm: textNorm, map } = normalize(input.text)
  const { norm: selectedNorm } = normalize(input.selected)
  if (!selectedNorm) return null

  const beforeNorm = normalize(input.before ?? '').norm.slice(-NEARBY)
  const afterNorm = normalize(input.after ?? '').norm.slice(0, NEARBY)

  const hits = findAll(textNorm, selectedNorm)
  if (hits.length === 0) return null
  if (hits.length === 1) return rangeOf(hits[0], selectedNorm.length, map)

  // 同一段文字出现多次：用前后文打分，只有唯一的最高分才算数。
  let best = -1
  let bestHit = -1
  let bestCount = 0
  for (const hit of hits) {
    const beforeOk =
      !beforeNorm || textNorm.slice(Math.max(0, hit - beforeNorm.length), hit).endsWith(beforeNorm)
    const afterEnd = hit + selectedNorm.length
    const afterOk =
      !afterNorm || textNorm.slice(afterEnd, afterEnd + afterNorm.length).startsWith(afterNorm)
    const score = (beforeOk ? 1 : 0) + (afterOk ? 1 : 0)
    if (score > best) {
      best = score
      bestHit = hit
      bestCount = 1
    } else if (score === best) {
      bestCount += 1
    }
  }

  // 前后文一个字都对不上，说明这几个候选都不是导演选中的那一处。
  if (best <= 0 || bestCount !== 1) return null
  return rangeOf(bestHit, selectedNorm.length, map)
}

function rangeOf(start: number, length: number, map: number[]): Located {
  return { start: map[start], end: map[start + length - 1] + 1 }
}
