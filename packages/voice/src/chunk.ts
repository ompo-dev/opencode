const guard = /```[\s\S]*?```/g
const code = /`([^`]+)`/g
const link = /\[([^\]]+)\]\(([^)]+)\)/g
const html = /<\/?[^>]+>/g
const emphasis = /[*_~]+/g
const tag = /\[(laughter|sigh|confirmation-en|question-en|question-ah|question-oh|question-ei|question-yi|surprise-ah|surprise-oh|surprise-wa|surprise-yo|dissatisfaction-hnn)\]/g

function prefix(a: string, b: string) {
  const len = Math.min(a.length, b.length)
  let idx = 0
  while (idx < len && a[idx] === b[idx]) idx += 1
  return idx
}

function protect(input: string) {
  const map: string[] = []
  const text = input.replace(tag, (hit) => {
    const key = `\u0000${map.length}\u0000`
    map.push(hit)
    return key
  })
  return { map, text }
}

function restore(input: string, map: string[]) {
  return map.reduce((acc, item, idx) => acc.replaceAll(`\u0000${idx}\u0000`, item), input)
}

function clean(input: string) {
  return input.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim()
}

function lead(input: string, idx: number) {
  const text = clean(input.slice(0, idx))
  if (!text) return false
  if (text.length > 16) return false
  return text.split(/\s+/).filter(Boolean).length <= 2
}

function head(input: string, done = false) {
  const hits: Array<{ at: number; char: string }> = []
  for (let idx = 0; idx < input.length; idx += 1) {
    const char = input[idx]
    if (char === "\n") hits.push({ at: idx + 1, char })
    if (".!?;:".includes(char)) {
      const next = input[idx + 1]
      if (!next || /\s|\n/.test(next)) hits.push({ at: idx + 1, char })
    }
  }
  const hit = hits.at(-1)
  if (!hit) return -1
  if (!done && "!?".includes(hit.char) && lead(input, hit.at)) {
    return hits.at(-2)?.at ?? -1
  }
  return hit.at
}

function soft(input: string, max: number) {
  if (input.length <= max) return input.length
  const idx = input.lastIndexOf(" ", max)
  if (idx > Math.floor(max / 2)) return idx
  return max
}

export function normalizeSpeechText(input: string, opts?: { stripMarkdown?: boolean }) {
  const { map, text } = protect(input.replace(/\r\n?/g, "\n"))
  if (opts?.stripMarkdown === false) return clean(restore(text, map))
  return clean(
    restore(text.replace(guard, " ").replace(code, "$1").replace(link, "$1").replace(html, " ").replace(emphasis, ""), map),
  )
}

export class SentenceChunker {
  private raw = ""
  private sent = ""
  private seen = 0

  constructor(
    private readonly opts: {
      limit?: number
      idle?: number
      stripMarkdown?: boolean
    } = {},
  ) {}

  sync(input: string, done = false, now = Date.now()) {
    const text = normalizeSpeechText(input, { stripMarkdown: this.opts.stripMarkdown })
    if (text.length > this.raw.length) this.seen = now
    this.raw = text
    const same = text.startsWith(this.sent)
    const base = same ? this.sent : text.slice(0, Math.min(text.length, prefix(text, this.sent)))
    const out: string[] = []
    let tail = text.slice(base.length)

    while (true) {
      const idx = head(tail, done)
      if (idx <= 0) break
      const raw = tail.slice(0, idx)
      const next = clean(raw)
      if (next) out.push(next)
      this.sent = base + tail.slice(0, idx)
      tail = text.slice(this.sent.length)
    }

    if (!done && tail.length < (this.opts.limit ?? 140)) return out
    if (!done && now - this.seen < (this.opts.idle ?? 500)) return out
    if (!tail.trim()) return out

    const cut = done ? tail.length : soft(tail, this.opts.limit ?? 140)
    const raw = tail.slice(0, cut)
    const next = clean(raw)
    if (!next) return out
    this.sent += raw
    out.push(next)
    return out
  }

  flush(now = Date.now()) {
    return this.sync(this.raw, true, now)
  }

  reset() {
    this.raw = ""
    this.sent = ""
    this.seen = 0
  }
}
