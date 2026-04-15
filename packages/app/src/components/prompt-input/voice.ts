import type { AgentPart, ContentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"

type Result = {
  prompt: Prompt
  cursor: number
}

type Recorder = {
  stop: () => Promise<{ audio: string; duration_ms: number; peak: number }>
  cancel: () => Promise<void>
}

type Stream = {
  stop: () => Promise<void>
  cancel: () => Promise<void>
  snapshot: () => Promise<{ audio: string; duration_ms: number; peak: number } | undefined>
  cut: () => Promise<{ audio: string; duration_ms: number; peak: number } | undefined>
}

function base64(input: Uint8Array) {
  let text = ""
  for (let idx = 0; idx < input.length; idx += 0x8000) {
    const chunk = input.subarray(idx, idx + 0x8000)
    text += String.fromCharCode(...chunk)
  }
  return btoa(text)
}

function len(part: Exclude<ContentPart, ImageAttachmentPart>) {
  return part.content.length
}

function clone(part: Exclude<ContentPart, ImageAttachmentPart>) {
  if (part.type === "text") return { ...part }
  if (part.type === "agent") return { ...part }
  return { ...part, selection: part.selection ? { ...part.selection } : undefined }
}

function text(content: string) {
  return {
    type: "text" as const,
    content,
    start: 0,
    end: content.length,
  }
}

function append(list: Array<Exclude<ContentPart, ImageAttachmentPart>>, part: Exclude<ContentPart, ImageAttachmentPart>) {
  if (part.type !== "text") {
    list.push(part)
    return
  }
  if (!part.content) return
  const last = list[list.length - 1]
  if (last?.type === "text") {
    last.content += part.content
    last.end = last.start + last.content.length
    return
  }
  list.push(part)
}

function index(list: Array<Exclude<ContentPart, ImageAttachmentPart>>) {
  let pos = 0
  return list.map((part) => {
    const size = len(part)
    const next =
      part.type === "file"
        ? ({ ...part, start: pos, end: pos + size } satisfies FileAttachmentPart)
        : part.type === "agent"
          ? ({ ...part, start: pos, end: pos + size } satisfies AgentPart)
          : ({ ...part, start: pos, end: pos + size })
    pos += size
    return next
  })
}

function wrap(raw: string, before: string, after: string) {
  const text = raw.trim()
  if (!text) return ""
  const head = text[0] ?? ""
  const tail = text[text.length - 1] ?? ""
  const prefix = before && !/\s/.test(before) && !/[.,!?;:)\]]/.test(head) ? " " : ""
  const suffix = after && !/\s/.test(after) && !/[\s([{-]/.test(after) && !/[(/[{]$/.test(tail) ? " " : ""
  return prefix + text + suffix
}

export function insertPromptText(prompt: Prompt, raw: string, cursor: number): Result {
  const parts = prompt.filter((part): part is Exclude<ContentPart, ImageAttachmentPart> => part.type !== "image")
  const images = prompt.filter((part): part is ImageAttachmentPart => part.type === "image")
  const flat = parts.map((part) => part.content).join("")
  const pos = Math.max(0, Math.min(cursor, flat.length))
  const value = wrap(raw, flat[pos - 1] ?? "", flat[pos] ?? "")
  if (!value) return { prompt, cursor: pos }

  const out: Array<Exclude<ContentPart, ImageAttachmentPart>> = []
  let idx = 0
  let done = false

  for (const part of parts) {
    const size = len(part)
    if (!done && pos <= idx + size) {
      if (part.type === "text") {
        const cut = Math.max(0, Math.min(size, pos - idx))
        append(out, text(part.content.slice(0, cut)))
        append(out, text(value))
        append(out, text(part.content.slice(cut)))
      } else {
        if (pos <= idx) append(out, text(value))
        append(out, clone(part))
        if (pos > idx) append(out, text(value))
      }
      done = true
      idx += size
      continue
    }

    append(out, clone(part))
    idx += size
  }

  if (!done) append(out, text(value))
  const next = index(out)
  return {
    prompt: [...next, ...images],
    cursor: pos + value.length,
  }
}

function encodeWav(input: Float32Array[], rate: number) {
  const size = input.reduce((sum, item) => sum + item.length, 0)
  const data = new Int16Array(size)
  let offset = 0
  for (const item of input) {
    for (let idx = 0; idx < item.length; idx += 1) {
      const value = Math.max(-1, Math.min(1, item[idx] ?? 0))
      data[offset] = value < 0 ? value * 0x8000 : value * 0x7fff
      offset += 1
    }
  }

  const buf = new ArrayBuffer(44 + data.byteLength)
  const view = new DataView(buf)
  const put = (idx: number, value: string) => {
    for (let off = 0; off < value.length; off += 1) view.setUint8(idx + off, value.charCodeAt(off))
  }

  put(0, "RIFF")
  view.setUint32(4, 36 + data.byteLength, true)
  put(8, "WAVE")
  put(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, "data")
  view.setUint32(40, data.byteLength, true)
  new Int16Array(buf, 44).set(data)
  return new Uint8Array(buf)
}

function encodeClip(input: { list: Float32Array[]; rate: number; peak: number }) {
  const size = input.list.reduce((sum, item) => sum + item.length, 0)
  if (!size) return
  const wav = encodeWav(input.list, input.rate)
  return {
    audio: `data:audio/wav;base64,${base64(wav)}`,
    duration_ms: Math.round((size / input.rate) * 1000),
    peak: input.peak,
  }
}

export async function startVoiceStream(input?: {
  device?: string
  onFrame?: (input: { peak: number; rms: number; duration_ms: number; chunk_ms: number }) => void
}): Promise<Stream> {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) throw new Error("Microphone capture is unavailable")

  const stream = await media.getUserMedia({
    audio: input?.device ? { deviceId: { exact: input.device } } : true,
  })
  const ctx = new AudioContext({ latencyHint: "interactive" })
  const src = ctx.createMediaStreamSource(stream)
  const gain = ctx.createGain()
  const node = ctx.createScriptProcessor(2048, 1, 1)
  let list: Float32Array[] = []
  let size = 0
  let peak = 0
  let closed = false

  gain.gain.value = 0
  node.onaudioprocess = (event) => {
    const data = new Float32Array(event.inputBuffer.getChannelData(0))
    list.push(data)
    size += data.length
    let rms = 0
    let top = 0
    for (let idx = 0; idx < data.length; idx += 1) {
      const value = Math.abs(data[idx] ?? 0)
      top = Math.max(top, value)
      rms += value * value
    }
    peak = Math.max(peak, top)
    input?.onFrame?.({
      peak: top,
      rms: Math.sqrt(rms / Math.max(1, data.length)),
      duration_ms: Math.round((size / ctx.sampleRate) * 1000),
      chunk_ms: Math.round((data.length / ctx.sampleRate) * 1000),
    })
  }

  src.connect(node)
  node.connect(gain)
  gain.connect(ctx.destination)
  await ctx.resume()
  if (ctx.state !== "running") throw new Error("Microphone capture could not start")

  const clear = () => {
    list = []
    size = 0
    peak = 0
  }

  const shutdown = async () => {
    if (closed) return
    closed = true
    node.disconnect()
    gain.disconnect()
    src.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    await ctx.close().catch(() => undefined)
  }

  return {
    async stop() {
      await shutdown()
    },
    async cancel() {
      clear()
      await shutdown()
    },
    async snapshot() {
      return encodeClip({
        list: list.slice(),
        rate: ctx.sampleRate,
        peak,
      })
    },
    async cut() {
      const out = encodeClip({
        list,
        rate: ctx.sampleRate,
        peak,
      })
      clear()
      return out
    },
  }
}

export async function startPromptRecording(input?: { device?: string }): Promise<Recorder> {
  const stream = await startVoiceStream(input)

  return {
    async stop() {
      const out = await stream.snapshot()
      await stream.stop()
      if (out) return out
      return {
        audio: `data:audio/wav;base64,${base64(encodeWav([], 24000))}`,
        duration_ms: 0,
        peak: 0,
      }
    },
    async cancel() {
      await stream.cancel()
    },
  }
}
