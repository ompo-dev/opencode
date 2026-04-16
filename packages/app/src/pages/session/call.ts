import { showToast } from "@opencode-ai/ui/toast"
import type { Part, SessionStatus } from "@opencode-ai/sdk/v2"
import { createAudioQueue, voiceInput, type VoiceConfigResolved } from "@opencode-ai/voice"
import { createEffect, onCleanup, type Accessor } from "solid-js"
import type { useGlobalSDK } from "@/context/global-sdk"
import { voiceCall } from "@/context/voice-call"
import { voiceDebug } from "@/context/voice-debug"
import { startVoiceStream } from "@/components/prompt-input/voice"
import { formatServerError } from "@/utils/server-errors"
import { joinVoiceText } from "./message-voice"

export function createSessionCall(input: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  session: Accessor<string | undefined>
  turn: Accessor<string | undefined>
  msg: Accessor<string | undefined>
  parts: Accessor<Part[]>
  status: Accessor<SessionStatus>
  cfg: Accessor<VoiceConfigResolved>
  mute: Accessor<boolean>
  volume: Accessor<number>
  device: Accessor<string>
  send: (text: string) => Promise<boolean | void>
  abort: () => Promise<void>
}) {
  let mic: Awaited<ReturnType<typeof startVoiceStream>> | undefined
  let beat: ReturnType<typeof setInterval> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let wait: ReturnType<typeof setTimeout> | undefined
  let at = 0
  let floor = 0.004
  let gate = 0
  let quiet = 0
  let vad: "idle" | "speech" | "short" | "medium" | "long" = "idle"
  let talk = false
  let busy = false
  let bad = false
  let play = false
  let load = false
  let seed = ""
  let done = ""
  let mute = ""
  let rev = 0

  const preset = () => input.cfg().tts.default_preset ?? input.cfg().tts.presets[0]?.id
  const on = () => voiceCall.state.active && input.cfg().runtime.enabled
  const gain = () => Math.max(0, Math.min(1, input.volume()))
  const queue = createAudioQueue({
    muted: input.mute,
    volume: gain,
    prefer: "htmlaudio",
    note: (next) => {
      load = next.state === "loading" || next.state === "blocked"
      play = next.state === "playing"
      voiceCall.tts(load || play ? 1 : 0)
      voiceDebug.queue(next)
      if (next.state === "playing" && !voiceCall.state.pending_user_turn) {
        voiceCall.phase("assistant_speaking")
      }
      if (next.state === "idle" && voiceCall.state.active && input.status().type === "idle" && !voiceCall.state.pending_user_turn) {
        voiceCall.phase("listening")
      }
      if (next.state === "error" && next.error) {
        voiceCall.error(next.error)
      }
    },
  })
  const sense = () => Math.max(0.5, Math.min(2, input.cfg().stt.call_sensitivity))
  const base = () => Math.max(0.001, input.cfg().stt.call_floor)
  const bar = (peak: number, rms: number) => {
    const boost = sense()
    return Math.max(0.28, Math.min(1, peak * 220 * boost + rms * 140 * boost))
  }

  const clear = () => {
    if (wait !== undefined) {
      clearTimeout(wait)
      wait = undefined
    }
    if (beat !== undefined) {
      clearInterval(beat)
      beat = undefined
    }
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const note = (state: "idle" | "loading" | "playing" | "error", error?: string) => {
    voiceCall.tts(load || play ? 1 : 0)
    voiceDebug.queue({
      state,
      pending: load || play ? 1 : 0,
      mode: "htmlaudio",
      muted: input.mute(),
      volume: gain(),
      error,
    })
  }

  const sync = () => {
    queue.update()
  }

  const stopAudio = () => {
    rev += 1
    play = false
    load = false
    queue.clear()
  }

  const drop = () => {
    reset()
    voiceCall.vad("idle")
    void mic?.reset()
  }

  const reset = () => {
    floor = base()
    gate = 0
    quiet = 0
    vad = "idle"
    talk = false
  }

  const fail = (error: unknown, fallback = "Voice request failed") => {
    const message = formatServerError(error, undefined, fallback)
    voiceCall.error(message)
    showToast({ title: "Call failed", description: message })
    return message
  }

  const speak = (msg?: string, text?: string) => {
    if (wait !== undefined) {
      clearTimeout(wait)
      wait = undefined
    }
    if (!on() || !msg || !text?.trim()) return
    if (mute && mute === msg) return
    const key = `${msg}\n${text}`
    if (done === key) return
    wait = setTimeout(async () => {
      const turn = rev
      wait = undefined
      if (turn !== rev || !on()) return
      if (input.msg() !== msg || input.status().type !== "idle") return
      load = true
      play = false
      voiceDebug.tts({
        state: "running",
        preset: preset(),
        text,
        error: undefined,
      })
      note("loading")
      const res = await input.globalSDK.client.global.voice
        .synthesize({
          voiceSynthesizeInput: voiceInput({
            config: input.cfg(),
            text,
            preset: preset(),
            profile: "call",
          }),
        })
        .catch((error) => {
          if (turn !== rev || bad) return
          bad = true
          load = false
          const message = formatServerError(error, undefined, "Voice request failed")
          voiceDebug.tts({
            state: "error",
            preset: preset(),
            error: message,
          })
          note("error", message)
          voiceCall.error(message)
          showToast({ title: "Call voice failed", description: message })
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
        load = false
        note("idle")
        return
      }
      bad = false
      done = key
      queue.clear()
      queue.enqueue(src)
    }, 0)
  }

  const finish = async () => {
    if (!mic || busy) return
    const clip = await mic.cut()
    reset()
    if (!clip || clip.duration_ms < 160) {
      voiceCall.vad("idle")
      voiceCall.phase("listening")
      voiceCall.pending(false)
      return
    }
    busy = true
    voiceCall.pending(true)
    voiceCall.phase("user_processing")
    voiceDebug.stt({
      state: "running",
      audio_ms: clip.duration_ms,
      error: undefined,
    })
    await input.globalSDK.client.global.voice
      .transcribe({
        voiceTranscribeInput: {
          audio: clip.audio,
          language: input.cfg().stt.language === "auto" ? undefined : input.cfg().stt.language,
          profile: "call",
        },
      })
      .then(async (res) => {
        const out = res.data
        const text = out?.text?.trim()
        voiceDebug.stt({
          state: text ? "ready" : "empty",
          audio_ms: clip.duration_ms,
          duration_ms: out?.duration_ms,
          words: out?.words.length,
          segments: out?.segments.length,
          text,
          error: undefined,
        })
        if (!text) {
          voiceCall.user("")
          voiceCall.pending(false)
          voiceCall.phase("listening")
          return
        }
        voiceCall.user(text)
        voiceCall.assistant("")
        voiceCall.phase("assistant_thinking")
        const ok = await input.send(text)
        if (ok === false) voiceCall.phase("listening")
      })
      .catch((error) => {
        const message = formatServerError(error, undefined, "Voice request failed")
        voiceDebug.stt({
          state: "error",
          audio_ms: clip.duration_ms,
          error: message,
        })
        fail(error)
      })
    busy = false
    voiceCall.pending(false)
  }

  const interrupt = async () => {
    if (!voiceCall.state.active || voiceCall.state.interrupting) return
    voiceCall.interrupt(true)
    voiceCall.phase("interrupted")
    stopAudio()
    voiceCall.assistant("")
    await input.abort().catch(() => undefined)
    voiceCall.interrupt(false)
    voiceCall.phase("listening")
  }

  const frame = (next: { peak: number; rms: number; chunk_ms: number }) => {
    voiceCall.userWave(bar(next.peak, next.rms))
    if (play || load) {
      if (vad !== "idle") {
        vad = "idle"
        voiceCall.vad("idle")
      }
      return
    }
    if (!voiceCall.state.active || busy) return
    const value = Math.max(next.rms, next.peak * 0.7)
    if (!talk && value < floor * 1.5) floor = Math.max(base(), floor * 0.995 + value * 0.005)
    const limit = Math.max(base() * 1.15, floor * (2.2 / sense()))
    const hit = value > limit
    if (hit) {
      gate += next.chunk_ms
      quiet = 0
      if (vad !== "speech") {
        vad = "speech"
        voiceCall.vad("speech")
      }
      if (!talk && gate >= 40) {
        talk = true
        voiceCall.phase("user_speaking")
        if (input.cfg().tts.call_stop_on_interrupt && (input.status().type !== "idle" || play || load)) {
          void interrupt()
        }
      }
      return
    }
    gate = 0
    if (!talk) {
      if (vad !== "idle") {
        vad = "idle"
        voiceCall.vad("idle")
      }
      return
    }
    quiet += next.chunk_ms
    if (quiet >= input.cfg().stt.long_pause_ms) {
      if (vad !== "long") {
        vad = "long"
        voiceCall.vad("long")
      }
      void finish()
      return
    }
    if (quiet >= input.cfg().stt.medium_pause_ms) {
      if (vad !== "medium" && vad !== "long") {
        vad = "medium"
        voiceCall.vad("medium")
      }
      void finish()
      return
    }
    if (quiet >= input.cfg().stt.short_pause_ms) {
      if (vad !== "short" && vad !== "medium" && vad !== "long") {
        vad = "short"
        voiceCall.vad("short")
      }
    }
  }

  const pulse = () => {
    if (!play && !load) {
      voiceCall.assistantWave(0)
      return
    }
    const next = 0.22 + Math.abs(Math.sin(Date.now() / 110)) * 0.68
    voiceCall.assistantWave(next)
  }

  const stop = async () => {
    clear()
    seed = ""
    done = ""
    busy = false
    const rec = mic
    mic = undefined
    await input.abort().catch(() => undefined)
    await rec?.cancel().catch(() => undefined)
    stopAudio()
    reset()
    voiceCall.reset()
    voiceDebug.stt({
      state: "idle",
      error: undefined,
    })
    voiceDebug.tts({
      state: "idle",
      error: undefined,
    })
  }

  const start = async () => {
    if (voiceCall.state.active) return
    if (!input.session()) {
      showToast({
        title: "Call indisponível",
        description: "Abra uma sessão antes de iniciar a conversa por voz.",
      })
      return
    }
    if (!input.cfg().runtime.enabled) {
      showToast({ title: "Voice disabled", description: "Enable local voice in Settings > Voice." })
      return
    }
    stopAudio()
    reset()
    voiceCall.user("")
    voiceCall.assistant("")
    voiceCall.start()
    seed = input.status().type === "idle" ? (input.msg() ?? "") : ""
    voiceCall.phase("warming")
    const ready = await input.globalSDK.client.global.voice
      .ensure({
        voiceEnsureInput: {
          target: "all",
          preload: true,
        },
      })
      .catch((error) => {
        fail(error)
        return undefined
      })
    if (!ready) {
      voiceCall.stop()
      return
    }
    if (!voiceCall.state.active) return
    voiceCall.phase("connecting")
    const rec = await startVoiceStream({
      device: input.device() || undefined,
      onFrame: frame,
      max_ms: 30_000,
      capture: () => {
        if (busy || voiceCall.state.pending_user_turn) return true
        return talk || gate > 0
      },
    }).catch((error) => {
      fail(error, "Microphone capture could not start")
      return undefined
    })
    if (!rec) {
      voiceCall.stop()
      return
    }
    mic = rec
    sync()
    reset()
    at = Date.now()
    voiceCall.phase("listening")
    timer = setInterval(() => {
      if (!voiceCall.state.active) return
      voiceCall.elapsed(Date.now() - at)
    }, 250)
    beat = setInterval(pulse, 120)
  }

  const toggle = () => (voiceCall.state.active ? stop() : start())

  createEffect(() => {
    input.mute()
    input.volume()
    sync()
  })

  createEffect(() => {
    if (!voiceCall.state.active) return
    const msg = input.msg()
    if (!msg) return
    if (seed && msg === seed && input.status().type === "idle") return
    if (seed && msg !== seed) seed = ""
    if (input.status().type !== "idle") {
      if (!voiceCall.state.pending_user_turn && !play && !load) voiceCall.phase("assistant_thinking")
      return
    }
    const text = joinVoiceText(input.parts())
    voiceCall.assistant(text)
    if (mute && mute === msg) return
    speak(msg, text)
  })

  createEffect((prev) => {
    const next = input.msg()
    if (!prev && next) {
      mute = next
      return next
    }
    if (prev && prev !== next) {
      done = ""
      stopAudio()
    }
    if (next && next !== mute) mute = ""
    return next
  })

  createEffect((prev) => {
    const next = input.status().type
    if (!voiceCall.state.active) return next
    if (prev === "idle" && next !== "idle") drop()
    if (next !== "idle" && !voiceCall.state.pending_user_turn && !play && !load) {
      voiceCall.phase("assistant_thinking")
    }
    if (next === "idle" && !voiceCall.state.pending_user_turn && !play && !load) {
      voiceCall.phase("listening")
    }
    return next
  })

  createEffect((prev) => {
    const next = input.session()
    if (prev && prev !== next) void stop()
    return next
  })

  createEffect((prev) => {
    const next = input.turn()
    if (!voiceCall.state.active) return next
    if (prev && next && prev !== next && input.cfg().tts.call_stop_on_interrupt) {
      seed = ""
      done = ""
      stopAudio()
      voiceCall.assistant("")
    }
    return next
  })

  onCleanup(() => {
    void stop()
    queue.dispose()
  })

  return {
    active: () => voiceCall.state.active,
    start,
    stop,
    toggle,
  }
}
