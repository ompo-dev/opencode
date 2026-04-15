import { showToast } from "@opencode-ai/ui/toast"
import type { Part, SessionStatus } from "@opencode-ai/sdk/v2"
import { createAudioQueue, type AudioQueueState, voiceInput, type VoiceConfigResolved } from "@opencode-ai/voice"
import { createEffect, onCleanup, type Accessor } from "solid-js"
import type { useGlobalSDK } from "@/context/global-sdk"
import { voiceCall } from "@/context/voice-call"
import { voiceDebug } from "@/context/voice-debug"
import { formatServerError } from "@/utils/server-errors"
import { startVoiceStream } from "@/components/prompt-input/voice"
import { createVoiceCtrl, joinVoiceText } from "./message-voice"

const idle = 0.08

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
  let at = 0
  let floor = 0.004
  let gate = 0
  let quiet = 0
  let vad: "idle" | "speech" | "short" | "medium" | "long" = "idle"
  let talk = false
  let busy = false
  let bad = false
  let seed = ""
  let sync: ReturnType<typeof setTimeout> | undefined
  let next = {
    msg: "",
    text: "",
    done: false,
  }

  const clear = () => {
    if (beat !== undefined) {
      clearInterval(beat)
      beat = undefined
    }
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  const clearSync = () => {
    if (sync === undefined) return
    clearTimeout(sync)
    sync = undefined
  }

  const preset = () => input.cfg().tts.default_preset ?? input.cfg().tts.presets[0]?.id
  const on = () => voiceCall.state.active && input.cfg().runtime.enabled
  const bar = (peak: number, rms: number) => Math.max(0.28, Math.min(1, peak * 220 + rms * 140))
  const reset = () => {
    floor = 0.004
    gate = 0
    quiet = 0
    vad = "idle"
    talk = false
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
    }, 120)
  }

  let ctrl: ReturnType<typeof createVoiceCtrl> | undefined
  const queue = createAudioQueue({
    prefer: "htmlaudio",
    muted: input.mute,
    volume: input.volume,
    note: (state: AudioQueueState) => {
      voiceCall.tts(state.pending)
      voiceDebug.queue({
        state: state.state,
        pending: state.pending,
        mode: state.mode,
        muted: state.muted,
        volume: state.volume,
        error: state.error,
      })
      ctrl?.tick()
      if (!voiceCall.state.active) return
      if (state.state === "playing" || state.state === "loading") {
        if (!voiceCall.state.pending_user_turn) voiceCall.phase("assistant_speaking")
        return
      }
      if (state.state === "error") {
        voiceCall.error(state.error || "Audio playback failed.")
        return
      }
      if (state.state !== "idle") return
      if (input.status().type !== "idle") {
        voiceCall.phase("assistant_thinking")
        return
      }
      if (!voiceCall.state.pending_user_turn) voiceCall.phase("listening")
    },
  })

  const speak = (text: string, meta: { seq: number; rank: number; effort: number }) =>
    input.globalSDK.client.global.voice
      .synthesize({
        voiceSynthesizeInput: voiceInput({
          config: input.cfg(),
          text,
          preset: preset(),
          profile: "call",
          rank: meta.rank,
          num_step: Math.max(10, Math.round(input.cfg().tts.call_num_step * meta.effort)),
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
    enabled: on,
    strip: () => input.cfg().tts.call_strip_markdown,
    chunk: "clause",
    width: 1,
    ahead: 1,
    queue,
    synth: speak,
    note: (error) => {
      if (bad) return
      bad = true
      const message = formatServerError(error, undefined, "Voice request failed")
      voiceDebug.tts({
        state: "error",
        preset: preset(),
        error: message,
      })
      voiceCall.error(message)
      showToast({ title: "Call voice failed", description: message })
    },
    event: (event) => {
      if (event.type === "start") {
        voiceDebug.tts({
          state: "running",
          preset: preset(),
          text: event.text,
          error: undefined,
        })
        return
      }
      if (event.type === "queue") {
        voiceCall.phase("assistant_speaking")
        return
      }
    },
  })

  const pulse = () => {
    const state = queue.state()
    if (state.state !== "playing" && state.state !== "loading") {
      voiceCall.assistantWave(0)
      return
    }
    const value = 0.22 + Math.abs(Math.sin(Date.now() / 110)) * 0.68
    voiceCall.assistantWave(value)
  }

  const fail = (error: unknown, fallback = "Voice request failed") => {
    const message = formatServerError(error, undefined, fallback)
    voiceCall.error(message)
    showToast({ title: "Call failed", description: message })
    return message
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
    ctrl.stop()
    queue.clear()
    voiceCall.assistant("")
    await input.abort().catch(() => undefined)
    voiceCall.interrupt(false)
    voiceCall.phase("listening")
  }

  const frame = (input2: { peak: number; rms: number; chunk_ms: number }) => {
    const value = Math.max(input2.rms, input2.peak * 0.7)
    voiceCall.userWave(bar(input2.peak, input2.rms))
    if (!voiceCall.state.active) return
    if (busy) return
    if (!talk && value < floor * 1.5) floor = floor * 0.995 + value * 0.005
    const limit = Math.max(0.009, floor * 2.2)
    const hit = value > limit
    if (hit) {
      gate += input2.chunk_ms
      quiet = 0
      if (vad !== "speech") {
        vad = "speech"
        voiceCall.vad("speech")
      }
      if (!talk && gate >= 90) {
        talk = true
        voiceCall.phase("user_speaking")
        if (
          input.cfg().tts.call_stop_on_interrupt &&
          (input.status().type !== "idle" || queue.state().state === "playing" || queue.state().state === "loading")
        ) {
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
    quiet += input2.chunk_ms
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
      return
    }
  }

  const stop = async () => {
    clear()
    clearSync()
    seed = ""
    const rec = mic
    mic = undefined
    await input.abort().catch(() => undefined)
    await rec?.cancel().catch(() => undefined)
    ctrl.stop()
    queue.clear()
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
    ctrl?.stop()
    queue.clear()
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
    }).catch((error) => {
      fail(error, "Microphone capture could not start")
      return undefined
    })
    if (!rec) {
      voiceCall.stop()
      return
    }
    mic = rec
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
    ctrl.update()
  })

  createEffect(() => {
    if (!voiceCall.state.active) return
    const msg = input.msg()
    if (!msg) return
    if (seed && msg === seed && input.status().type === "idle") return
    if (seed && msg !== seed) seed = ""
    const text = joinVoiceText(input.parts())
    voiceCall.assistant(text)
    push(msg, text)
  })

  createEffect((prev) => {
    const next = input.status().type
    if (!voiceCall.state.active) return next
    if (prev !== "idle" && next === "idle") {
      clearSync()
      const msg = input.msg()
      if (msg) ctrl.sync({ msg, text: joinVoiceText(input.parts()), done: true })
      ctrl.flush()
    }
    if (next !== "idle" && !voiceCall.state.pending_user_turn && queue.state().state === "idle") {
      voiceCall.phase("assistant_thinking")
    }
    if (next === "idle" && queue.state().state === "idle" && !voiceCall.state.pending_user_turn) {
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
      clearSync()
      seed = ""
      ctrl.stop()
      queue.clear()
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
