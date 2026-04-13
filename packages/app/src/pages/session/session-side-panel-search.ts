import type { FindTextResponse } from "@opencode-ai/sdk/v2"

export type Hit = {
  path: string
  line: string
  num: number
  end: number
  subs: {
    start: number
    end: number
  }[]
}

export function squash(text: string) {
  return text.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim()
}

export function has(text: string, query: string, cs = false) {
  const left = squash(text)
  const right = squash(query)
  if (!right) return false
  if (cs) return left.includes(right)
  return left.toLowerCase().includes(right.toLowerCase())
}

export function pats(text: string) {
  if (!text.trim()) return [] as string[]
  return [text]
}

export function rows(text: string) {
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function flat(list: FindTextResponse | undefined, norm: (path: string) => string) {
  if (!list?.length) return [] as Hit[]

  return list
    .map((item) => {
      const line = item.lines.text.replace(/\r?\n$/, "")
      return {
        path: norm(item.path.text),
        line,
        num: item.line_number,
        end: item.line_number + line.split(/\r?\n/).length - 1,
        subs: item.submatches.map((item) => ({
          start: item.start,
          end: item.end,
        })),
      }
    })
    .filter((item) => item.path)
}

export function uniq(list: readonly Hit[]) {
  const map = new Map<string, Hit>()

  list.forEach((item) => {
    const key = `${item.path}:${item.num}:${item.line}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        path: item.path,
        line: item.line,
        num: item.num,
        end: item.end,
        subs: [...item.subs],
      })
      return
    }

    prev.end = Math.max(prev.end, item.end)
    prev.subs.push(...item.subs)
  })

  return [...map.values()].map((item) => ({
    ...item,
    subs: item.subs
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .filter((sub, i, list) => i === 0 || sub.start !== list[i - 1]?.start || sub.end !== list[i - 1]?.end),
  }))
}

export function stitch(list: readonly (readonly Hit[])[]) {
  if (list.length === 0) return [] as Hit[]
  if (list.length === 1) return uniq(list[0] ?? [])

  const map = new Map<string, Map<number, Hit>>()

  list.forEach((hits) => {
    hits.forEach((hit) => {
      const prev = map.get(hit.path)
      if (prev) {
        prev.set(hit.num, hit)
        return
      }
      map.set(hit.path, new Map([[hit.num, hit]]))
    })
  })

  const out: Hit[] = []

  for (const hit of list[0] ?? []) {
    const file = map.get(hit.path)
    if (!file) continue

    const seq = [hit]
    let ok = true
    for (const [i] of list.slice(1).entries()) {
      const next = file.get(hit.num + i + 1)
      if (!next) {
        ok = false
        break
      }
      seq.push(next)
    }
    if (!ok) continue

    let at = 0
    const subs: Hit["subs"] = []
    seq.forEach((item, i) => {
      item.subs.forEach((sub) => {
        subs.push({
          start: at + sub.start,
          end: at + sub.end,
        })
      })
      at += item.line.length
      if (i < seq.length - 1) at += 1
    })

    out.push({
      path: hit.path,
      line: seq.map((item) => item.line).join("\n"),
      num: hit.num,
      end: seq[seq.length - 1]?.end ?? hit.end,
      subs,
    })
  }

  return uniq(out)
}

export function group(list: readonly Hit[]) {
  const map = new Map<string, Hit[]>()

  list.forEach((item) => {
    const prev = map.get(item.path)
    if (prev) {
      prev.push(item)
      return
    }
    map.set(item.path, [item])
  })

  return [...map.entries()].map(([path, hits]) => ({ path, hits }))
}

export function parts(text: string, subs: readonly { start: number; end: number }[]) {
  if (subs.length === 0) return text ? [{ text, hit: false }] : []

  const out: {
    text: string
    hit: boolean
  }[] = []
  let at = 0

  ;[...subs]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .forEach((item) => {
      const start = Math.max(0, Math.min(text.length, item.start))
      const end = Math.max(start, Math.min(text.length, item.end))

      if (start > at) out.push({ text: text.slice(at, start), hit: false })
      if (end > start) out.push({ text: text.slice(start, end), hit: true })
      at = end
    })

  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out.filter((item) => item.text)
}
