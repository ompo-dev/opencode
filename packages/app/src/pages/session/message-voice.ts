import { showToast } from "@opencode-ai/ui/toast"
import type { Part, SessionStatus, TextPart } from "@opencode-ai/sdk/v2"
import { ClauseChunker, LineChunker, SentenceChunker, createAudioQueue, type AudioQueueState } from "@opencode-ai/voice"
import { createEffect, onCleanup, type Accessor } from "solid-js"
import type { useGlobalSDK } from "@/context/global-sdk"
import { voiceDebug } from "@/context/voice-debug"
import { formatServerError } from "@/utils/server-errors"
import { type VoiceConfigResolved, voiceInput } from "@opencode-ai/voice"

const speakable = (part: Part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored
type AudioQueue = Pick<ReturnType<typeof createAudioQueue>, "enqueue" | "clear" | "update" | "state">

const step = (text: string, base: number, effort: number, low: number, high: number) => {
  const cap = text.trim().length <= 12 ? low + 2 : text.trim().length <= 32 ? high - 2 : high
  return Math.max(low, Math.min(cap, Math.round(base * effort)))
}

export function joinVoiceText(parts: Part[]) {
  return parts
    .filter(speakable)
    .map((part) => part.text)
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

export function createVoiceCtrl(input: {
  enabled: () => boolean
  strip: () => boolean
  chunk?: "line" | "sentence" | "clause"
  width?: number
  ahead?: number
  synth: (text: string, meta: { seq: number; rank: number; effort: number }) => Promise<string | undefined>
  note?: (error: unknown) => void
  event?: (input: { type: "start" | "queue" | "drop" | "error"; msg: string; text: string; error?: unknown }) => void
  queue: AudioQueue
}) {
  let msg = ""
  let rev = 0
  let seq = 0
  let ack = 0
  let run = 0
  const todo: string[] = []
  const out = new Map<number, { text: string; audio?: string }>()
  let chunk = make()

  function make() {
    if (input.chunk === "clause") {
      return new ClauseChunker({
        stripMarkdown: input.strip(),
      })
    }
    if (input.chunk === "sentence") {
      return new SentenceChunker({
        stripMarkdown: input.strip(),
      })
    }
    return new LineChunker({
      stripMarkdown: input.strip(),
    })
  }

  const stop = () => {
    rev += 1
    msg = ""
    seq = 0
    ack = 0
    run = 0
    todo.length = 0
    out.clear()
    chunk = make()
    input.queue.clear()
  }

  const drain = (now: number) => {
    while (out.has(ack)) {
      const item = out.get(ack)
      out.delete(ack)
      ack += 1
      if (now !== rev || !input.enabled() || !item) continue
      if (!item.audio) {
        input.event?.({
          type: "drop",
          msg,
          text: item.text,
        })
        continue
      }
      input.event?.({
        type: "queue",
        msg,
        text: item.text,
      })
      input.queue.enqueue(item.audio)
    }
  }

  const pump = (now: number) => {
    while (run < (input.width ?? 2) && todo.length > 0) {
      const span = input.ahead ?? 3
      const load = input.queue.state().pending + out.size + run
      if (load >= span) return
      const item = todo.shift()
      if (!item) return
      const at = seq
      seq += 1
      run += 1
      const id = msg
      const rank = Math.max(0, at - ack)
      const effort = Math.max(0.125, 1 / 2 ** rank)
      input.event?.({
        type: "start",
        msg: id,
        text: item,
      })
      void input
        .synth(item, {
          seq: at,
          rank,
          effort,
        })
        .then((audio) => {
          run -= 1
          if (now !== rev || !input.enabled()) {
            input.event?.({
              type: "drop",
              msg: id,
              text: item,
            })
            pump(now)
            return
          }
          out.set(at, { text: item, audio })
          drain(now)
          pump(now)
        })
        .catch((error) => {
          run -= 1
          input.event?.({
            type: "error",
            msg: id,
            text: item,
            error,
          })
          input.note?.(error)
          if (now !== rev || !input.enabled()) {
            pump(now)
            return
          }
          out.set(at, { text: item })
          drain(now)
          pump(now)
        })
    }
  }

  const push = (items: string[], now: number) => {
    todo.push(...items)
    pump(now)
  }

  return {
    sync(next: { msg: string; text: string; done?: boolean }) {
      if (!input.enabled()) {
        stop()
        return
      }
      if (msg && msg !== next.msg) stop()
      if (msg !== next.msg) {
        msg = next.msg
        seq = 0
        ack = 0
        run = 0
        todo.length = 0
        out.clear()
        chunk = make()
      }
      const now = rev
      push(chunk.sync(next.text, !!next.done), now)
    },
    flush() {
      if (!input.enabled() || !msg) return
      push(chunk.flush(), rev)
    },
    tick() {
      pump(rev)
    },
    stop,
    update() {
      input.queue.update()
      pump(rev)
    },
  }
}

export function createMessageVoice(input: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  session: Accessor<string | undefined>
  turn: Accessor<string | undefined>
  msg: Accessor<string | undefined>
  parts: Accessor<Part[]>
  status: Accessor<SessionStatus>
  cfg: Accessor<VoiceConfigResolved>
  mute: Accessor<boolean>
  volume: Accessor<number>
  enabled?: Accessor<boolean>
}) {
  let bad = false
  let done = ""
  let mute = ""
  let wait: ReturnType<typeof setTimeout> | undefined
  let rev = 0
  let audio: HTMLAudioElement | undefined
  const preset = () => input.cfg().tts.default_preset ?? input.cfg().tts.presets[0]?.id
  const gain = () => Math.max(0, Math.min(1, input.volume()))
  const clear = () => {
    if (wait === undefined) return
    clearTimeout(wait)
    wait = undefined
  }
  const enabled = () => (input.enabled ? input.enabled() : true) && input.cfg().runtime.enabled && input.cfg().tts.autoplay

  const init = () => {
    if (audio || typeof Audio === "undefined") return
    audio =
      typeof document === "undefined"
        ? new Audio()
        : Object.assign(document.createElement("audio"), {
            preload: "metadata",
            style: "display:none",
          })
    if (typeof document !== "undefined") document.body.append(audio)
    audio.onplay = () => {
      voiceDebug.queue({
        state: "playing",
        pending: 1,
        mode: "htmlaudio",
        muted: input.mute(),
        volume: gain(),
        error: undefined,
      })
    }
    audio.onpause = () => {
      if (!audio?.src) return
      voiceDebug.queue({
        state: "idle",
        pending: 0,
        mode: "htmlaudio",
        muted: input.mute(),
        volume: gain(),
        error: undefined,
      })
    }
    audio.onended = () => {
      if (audio) audio.currentTime = 0
      voiceDebug.queue({
        state: "idle",
        pending: 0,
        mode: "htmlaudio",
        muted: input.mute(),
        volume: gain(),
        error: undefined,
      })
    }
    audio.onerror = () => {
      voiceDebug.queue({
        state: "error",
        pending: 0,
        mode: "htmlaudio",
        muted: input.mute(),
        volume: gain(),
        error: "Audio playback failed.",
      })
    }
  }

  const sync = () => {
    init()
    if (!audio) return
    audio.muted = input.mute()
    audio.volume = input.mute() ? 0 : gain()
    voiceDebug.queue({
      state: audio.paused ? "idle" : "playing",
      pending: audio.src ? 1 : 0,
      mode: "htmlaudio",
      muted: input.mute(),
      volume: gain(),
      error: undefined,
    })
  }

  const reset = () => {
    rev += 1
    clear()
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      audio.removeAttribute("src")
      audio.src = ""
      if (typeof audio.load === "function") audio.load()
    }
    voiceDebug.queue({
      state: "idle",
      pending: 0,
      mode: "htmlaudio",
      muted: input.mute(),
      volume: gain(),
      error: undefined,
    })
  }

  const plan = (msg?: string, text?: string) => {
    clear()
    if (!enabled() || !msg || !text?.trim()) return
    if (mute && mute === msg) return
    const key = `${msg}\n${text}`
    if (done === key) return
    wait = setTimeout(async () => {
      const turn = rev
      wait = undefined
      if (turn !== rev || !enabled()) return
      if (input.msg() !== msg || input.status().type !== "idle") return
      voiceDebug.tts({
        state: "running",
        preset: preset(),
        text,
        error: undefined,
      })
      voiceDebug.queue({
        state: "loading",
        pending: 1,
        mode: "htmlaudio",
        muted: input.mute(),
        volume: gain(),
        error: undefined,
      })
      const res = await input.globalSDK.client.global.voice
        .synthesize({
          voiceSynthesizeInput: voiceInput({
            config: input.cfg(),
            text,
            preset: preset(),
          }),
        })
        .catch((error) => {
          if (turn !== rev || bad) return
          bad = true
          const message = formatServerError(error, undefined, "Voice request failed")
          voiceDebug.tts({
            state: "error",
            preset: preset(),
            error: message,
          })
          voiceDebug.queue({
            state: "error",
            pending: 0,
            mode: "htmlaudio",
            muted: input.mute(),
            volume: gain(),
            error: message,
          })
          showToast({ title: "Voice failed", description: message })
        })
      if (turn !== rev || !res?.data || input.msg() !== msg) return
      const src = res.data.audio ?? ""
      voiceDebug.tts({
        state: src ? "ready" : "empty",
        duration_ms: res.data.duration_ms,
        preset: preset(),
        text,
        error: undefined,
      })
      if (!src) {
        voiceDebug.queue({
          state: "idle",
          pending: 0,
          mode: "htmlaudio",
          muted: input.mute(),
          volume: gain(),
          error: undefined,
        })
        return
      }
      bad = false
      done = key
      init()
      if (!audio) return
      audio.pause()
      audio.currentTime = 0
      audio.src = src
      sync()
      await audio.play().catch((error) => {
        if (turn !== rev || bad) return
        bad = true
        const message = formatServerError(error, undefined, "Audio playback failed")
        voiceDebug.queue({
          state: "error",
          pending: 0,
          mode: "htmlaudio",
          muted: input.mute(),
          volume: gain(),
          error: message,
        })
        showToast({ title: "Voice failed", description: message })
      })
    }, 0)
  }

  createEffect(() => {
    input.mute()
    input.volume()
    sync()
  })

  createEffect((prev) => {
    const next = input.msg()
    if (!prev && next) {
      mute = next
      return next
    }
    if (prev && prev !== next) {
      reset()
      done = ""
    }
    if (next && next !== mute) mute = ""
    return next
  })

  createEffect((prev) => {
    const next = input.session()
    if (prev && prev !== next) {
      reset()
      done = ""
      mute = ""
    }
    return next
  })

  createEffect((prev) => {
    const next = input.turn()
    if (prev && next && prev !== next && input.cfg().tts.stop_on_interrupt) {
      reset()
      done = ""
      mute = ""
      voiceDebug.tts({
        state: "idle",
        error: undefined,
      })
    }
    return next
  })

  createEffect(() => {
    const msg = input.msg()
    if (!msg) return
    const text = joinVoiceText(input.parts())
    if (mute && mute === msg && input.status().type === "idle") {
      voiceDebug.tts({
        state: "idle",
        error: undefined,
      })
      return
    }
    voiceDebug.tts({
      state: text.trim() ? "running" : "idle",
      preset: preset(),
      text,
      error: undefined,
    })
  })

  createEffect((prev) => {
    const next = input.status().type
    if (!enabled()) {
      reset()
      done = ""
      mute = input.msg() ?? ""
      voiceDebug.tts({
        state: "idle",
        error: undefined,
      })
    }
    return next
  })

  createEffect(() => {
    const msg = input.msg()
    if (!msg) return
    if (input.status().type !== "idle") return
    if (mute && mute === msg) return
    plan(msg, joinVoiceText(input.parts()))
  })

  onCleanup(() => {
    reset()
    if (audio && "remove" in audio && typeof audio.remove === "function") audio.remove()
    audio = undefined
    voiceDebug.tts({
      state: "idle",
      error: undefined,
    })
  })
}
