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
  let live = ""
  let busy = ""
  let done = ""
  let mute = ""
  let warm = ""
  let wait: ReturnType<typeof setTimeout> | undefined
  let sync: ReturnType<typeof setTimeout> | undefined
  let next = {
    msg: "",
    text: "",
    done: false,
  }
  const preset = () => input.cfg().tts.default_preset ?? input.cfg().tts.presets[0]?.id
  let ctrl: ReturnType<typeof createVoiceCtrl> | undefined
  const queue = createAudioQueue({
    prefer: "htmlaudio",
    muted: input.mute,
    volume: input.volume,
    note: (state: AudioQueueState) => {
      voiceDebug.queue({
        state: state.state,
        pending: state.pending,
        mode: state.mode,
        muted: state.muted,
        volume: state.volume,
        error: state.error,
      })
      ctrl?.tick()
    },
  })
  const clear = () => {
    if (wait === undefined) return
    clearTimeout(wait)
    wait = undefined
  }
  const clearSync = () => {
    if (sync === undefined) return
    clearTimeout(sync)
    sync = undefined
  }
  const push = (msg: string, text: string, done = false) => {
    next = { msg, text, done }
    if (done) {
      clearSync()
      ctrl?.sync(next)
      return
    }
    if (sync !== undefined) return
    sync = setTimeout(() => {
      sync = undefined
      if (!next.msg) return
      ctrl?.sync(next)
    }, 220)
  }
  const enabled = () => (input.enabled ? input.enabled() : true) && input.cfg().runtime.enabled && input.cfg().tts.autoplay
  const liveEnabled = () => enabled() && input.cfg().tts.live
  const speak = (text: string, meta: { seq: number; rank: number; effort: number }) =>
    input.globalSDK.client.global.voice
      .synthesize({
        voiceSynthesizeInput: voiceInput({
          config: input.cfg(),
          text,
          preset: preset(),
          rank: meta.rank,
          num_step: Math.max(8, Math.round(input.cfg().tts.num_step * meta.effort)),
        }),
      })
      .then((res) => {
        bad = false
        voiceDebug.tts({
          state: res.data?.audio ? "ready" : "empty",
          duration_ms: res.data?.duration_ms,
          preset: preset(),
          text,
          error: undefined,
        })
        return res.data?.audio
      })
  ctrl = createVoiceCtrl({
    enabled: liveEnabled,
    strip: () => input.cfg().tts.strip_markdown,
    chunk: "clause",
    width: 1,
    ahead: 2,
    queue,
    synth: speak,
    note: (error) => {
      busy = ""
      if (bad) return
      bad = true
      const message = formatServerError(error, undefined, "Voice request failed")
      voiceDebug.tts({
        state: "error",
        preset: preset(),
        error: message,
      })
      showToast({ title: "Voice failed", description: message })
    },
    event: (event) => {
      if (event.type === "start") {
        busy = event.msg
        voiceDebug.tts({
          state: "running",
          preset: preset(),
          text: event.text,
          error: undefined,
        })
        return
      }
      if (event.type === "queue") {
        busy = ""
        live = event.msg
        return
      }
      if (busy === event.msg) busy = ""
    },
  })

  const plan = (msg?: string, text?: string) => {
    clear()
    if (!enabled() || !msg || !text?.trim()) return
    if (mute && mute === msg) return
    const key = `${msg}\n${text}`
    if (done === key) return
    wait = setTimeout(async () => {
      wait = undefined
      if (!enabled()) return
      if (input.msg() !== msg) return
      if (input.status().type !== "idle") return
      if (liveEnabled() && live === msg) return
      if (liveEnabled() && busy === msg) {
        plan(msg, text)
        return
      }
      voiceDebug.tts({
        state: "running",
        preset: preset(),
        text,
        error: undefined,
      })
      const audio = await speak(text, {
        seq: 0,
        rank: 0,
        effort: 1,
      }).catch((error) => {
        ctrl.stop()
        throw error
      })
      if (!audio) return
      if (input.msg() !== msg) return
      done = key
      queue.enqueue(audio)
    }, liveEnabled() ? 900 : 0)
  }

  createEffect(() => {
    input.mute()
    input.volume()
    ctrl.update()
  })

  createEffect((prev) => {
    const next = input.msg()
    if (!prev && next) {
      mute = next
      return next
    }
    if (prev && prev !== next) {
      clear()
      clearSync()
      live = ""
      busy = ""
      done = ""
      warm = ""
    }
    if (next && next !== mute) mute = ""
    return next
  })

  createEffect((prev) => {
    const next = input.session()
    if (prev && prev !== next) {
      clear()
      clearSync()
      live = ""
      busy = ""
      done = ""
      mute = ""
      warm = ""
      ctrl.stop()
    }
    return next
  })

  createEffect((prev) => {
    const next = input.turn()
    if (prev && next && prev !== next && input.cfg().tts.stop_on_interrupt) {
      clear()
      clearSync()
      live = ""
      busy = ""
      done = ""
      mute = ""
      warm = ""
      ctrl.stop()
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
    if (warm === msg) return
    if (!enabled()) return
    if (input.status().type === "idle") return
    warm = msg
    void input.globalSDK.client.global.voice
      .ensure({
        voiceEnsureInput: {
          target: "tts",
          preload: true,
        },
      })
      .catch(() => undefined)
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
    if (liveEnabled()) {
      push(msg, text)
      return
    }
    voiceDebug.tts({
      state: text.trim() ? "running" : "idle",
      preset: preset(),
      text,
      error: undefined,
    })
    ctrl.stop()
  })

  createEffect((prev) => {
    const next = input.status().type
    if (prev !== "idle" && next === "idle") {
      clearSync()
      const msg = input.msg()
      if (msg) ctrl.sync({ msg, text: joinVoiceText(input.parts()), done: true })
      ctrl.flush()
    }
    if (!enabled()) {
      clear()
      clearSync()
      live = ""
      busy = ""
      done = ""
      mute = input.msg() ?? ""
      ctrl.stop()
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
    clear()
    clearSync()
    ctrl.stop()
    queue.dispose()
    voiceDebug.tts({
      state: "idle",
      error: undefined,
    })
  })
}
