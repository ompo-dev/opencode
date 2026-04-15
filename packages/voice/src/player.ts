type Mode = "webaudio" | "htmlaudio" | "none"
type State = "idle" | "loading" | "playing" | "blocked" | "error"
type Item = {
  src: string
  audio?: HTMLAudioElement
}

export type AudioQueueState = {
  state: State
  pending: number
  mode: Mode
  muted: boolean
  volume: number
  error?: string
}

const clamp = (input?: number) => Math.max(0, Math.min(1, input ?? 1))

const errorText = (input: unknown) => {
  if (input instanceof Error) return input.message
  return String(input)
}

const ctor = () => {
  if (typeof window === "undefined") return
  const root = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return root.AudioContext ?? root.webkitAudioContext
}

const decode = (src: string) => {
  const match = src.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/)
  if (!match) throw new Error("Invalid audio payload")

  if (!match[2]) {
    return new TextEncoder().encode(decodeURIComponent(match[3] ?? "")).buffer
  }

  const raw = atob(match[3] ?? "")
  const out = new Uint8Array(raw.length)
  for (let idx = 0; idx < raw.length; idx += 1) out[idx] = raw.charCodeAt(idx)
  return out.buffer
}

export function createAudioQueue(input?: {
  muted?: () => boolean
  volume?: () => number
  note?: (state: AudioQueueState) => void
  prefer?: Extract<Mode, "webaudio" | "htmlaudio">
}) {
  let ctx: AudioContext | undefined
  let gain: GainNode | undefined
  let node: AudioBufferSourceNode | undefined
  let html: HTMLAudioElement | undefined
  let item: Item | undefined
  let dead = false
  let rev = 0
  const list: string[] = []
  const prefer = input?.prefer ?? "webaudio"
  const canWeb = !!ctor()
  const canHtml = typeof Audio !== "undefined"
  const mode = prefer === "htmlaudio" ? (canHtml ? "htmlaudio" : canWeb ? "webaudio" : "none") : canWeb ? "webaudio" : canHtml ? "htmlaudio" : "none"
  let snap: AudioQueueState = {
    state: "idle",
    pending: 0,
    mode,
    muted: input?.muted?.() ?? false,
    volume: clamp(input?.volume?.()),
  }

  const emit = (next: Partial<AudioQueueState> = {}) => {
    snap = {
      ...snap,
      ...next,
      pending: list.length + (item ? 1 : 0),
      muted: input?.muted?.() ?? snap.muted,
      volume: clamp(input?.volume?.() ?? snap.volume),
    }
    input?.note?.(snap)
  }

  const apply = () => {
    const volume = clamp(input?.volume?.())
    const muted = input?.muted?.() ?? false
    if (gain) gain.gain.value = muted ? 0 : volume
    if (html) html.volume = muted ? 0 : volume
    emit({ muted, volume })
  }

  const ensureHtml = () => {
    if (html) return html
    if (typeof Audio === "undefined") return
    html =
      typeof document === "undefined"
        ? new Audio()
        : Object.assign(document.createElement("audio"), {
            preload: "auto",
            style: "display:none",
          })
    if (typeof document !== "undefined") document.body.append(html)
    return html
  }

  const stopItem = (current?: Item) => {
    if (current?.audio) {
      current.audio.onended = null
      current.audio.onerror = null
      current.audio.pause()
      current.audio.currentTime = 0
      current.audio.removeAttribute("src")
      current.audio.src = ""
      if (typeof current.audio.load === "function") current.audio.load()
    }
    if (node) {
      node.onended = null
      try {
        node.stop()
      } catch {}
      try {
        node.disconnect()
      } catch {}
      node = undefined
    }
  }

  const done = (current: Item) => {
    if (item !== current) return
    stopItem(current)
    item = undefined
    emit({ state: list.length ? "loading" : "idle", error: undefined })
    void pump()
  }

  const ensure = async () => {
    const Ctor = ctor()
    if (!Ctor) return
    if (!ctx) {
      ctx = new Ctor()
      gain = ctx.createGain()
      gain.connect(ctx.destination)
    }
    const audio = ctx
    if (!audio) return
    apply()
    if (audio.state !== "running") {
      await audio.resume().catch(() => undefined)
    }
    return audio
  }

  const playWeb = async (current: Item, turn: number) => {
    const audio = await ensure()
    if (!audio || audio.state !== "running") {
      emit({
        state: "blocked",
        mode: ctx ? "webaudio" : "none",
        error: "Audio output is waiting for user interaction.",
      })
      return false
    }

    emit({
      state: "loading",
      mode: "webaudio",
      error: undefined,
    })
    const raw = decode(current.src)
    const buf = await audio.decodeAudioData(raw.slice(0) as ArrayBuffer)
    if (dead || turn !== rev || item !== current) return true

    const src = audio.createBufferSource()
    src.buffer = buf
    src.connect(gain!)
    src.onended = () => done(current)
    node = src
    src.start(0)
    emit({
      state: "playing",
      mode: "webaudio",
      error: undefined,
    })
    return true
  }

  const playHtml = async (current: Item) => {
    const audio = current.audio ?? ensureHtml()
    if (!audio) return false
    current.audio = audio
    audio.src = current.src
    audio.onended = () => done(current)
    audio.onerror = () => {
      emit({
        state: "error",
        mode: "htmlaudio",
        error: "Audio playback failed.",
      })
      done(current)
    }
    apply()
    emit({
      state: "loading",
      mode: "htmlaudio",
      error: undefined,
    })
    await audio.play()
    emit({
      state: "playing",
      mode: "htmlaudio",
      error: undefined,
    })
    return true
  }

  const pump = async () => {
    if (dead) return
    if (item && (snap.state === "playing" || snap.state === "loading")) return
    if (!item) {
      const src = list.shift()
      if (!src) {
        emit({
          state: "idle",
          error: undefined,
        })
        return
      }
      item = { src }
    }

    const current = item
    if (!current) return
    const turn = rev
    const steps: Array<{
      mode: Extract<Mode, "webaudio" | "htmlaudio">
      blocked: boolean
      play: () => Promise<boolean>
    }> =
      prefer === "htmlaudio"
        ? [
            { mode: "htmlaudio" as const, blocked: true, play: async () => playHtml(current) },
            { mode: "webaudio" as const, blocked: false, play: async () => playWeb(current, turn) },
          ]
        : [
            { mode: "webaudio" as const, blocked: false, play: async () => playWeb(current, turn) },
            { mode: "htmlaudio" as const, blocked: true, play: async () => playHtml(current) },
          ]

    for (const step of steps) {
      try {
        if (await step.play()) return
      } catch (error) {
        emit({
          state: step.blocked ? "blocked" : "error",
          mode: step.mode,
          error: errorText(error),
        })
      }
    }
    emit({
      state: "error",
      mode: "none",
      error: "Audio playback is unavailable in this runtime.",
    })
    done(current)
  }

  const unlock = () => {
    void ensure().finally(() => {
      if (snap.state !== "blocked") return
      void pump()
    })
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", unlock, { passive: true })
    window.addEventListener("keydown", unlock, { passive: true })
  }

  emit()

  return {
    enqueue(src: string) {
      list.push(src)
      emit({
        state: item ? snap.state : "loading",
        error: snap.state === "blocked" ? snap.error : undefined,
      })
      void pump()
    },
    clear() {
      rev += 1
      list.length = 0
      if (item) stopItem(item)
      item = undefined
      emit({
        state: "idle",
        error: undefined,
      })
    },
    update() {
      apply()
      if (snap.state === "blocked") void pump()
    },
    dispose() {
      if (dead) return
      dead = true
      rev += 1
      list.length = 0
      if (typeof window !== "undefined") {
        window.removeEventListener("pointerdown", unlock)
        window.removeEventListener("keydown", unlock)
      }
      if (item) stopItem(item)
      item = undefined
      const audio = ctx
      if (audio && audio.state !== "closed") {
        void audio.close().catch(() => undefined)
      }
      if (html && "remove" in html && typeof html.remove === "function") html.remove()
      html = undefined
      ctx = undefined
      gain = undefined
      node = undefined
      emit({
        state: "idle",
        error: undefined,
      })
    },
    state() {
      return snap
    },
  }
}
