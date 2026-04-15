import { createStore } from "solid-js/store"

type Phase =
  | "idle"
  | "warming"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "user_processing"
  | "assistant_thinking"
  | "assistant_speaking"
  | "interrupted"
  | "error"

type Vad = "idle" | "speech" | "short" | "medium" | "long"

const size = 40
const zeros = () => Array.from({ length: size }, () => 0)
const waveGap = 48
const clockGap = 200
const clip = (value: string) => {
  const text = value.trim()
  if (!text) return ""
  return text.length > 320 ? text.slice(-320) : text
}

const [state, setState] = createStore({
  active: false,
  phase: "idle" as Phase,
  vad: "idle" as Vad,
  interrupting: false,
  elapsed_ms: 0,
  pending_user_turn: false,
  pending_tts: 0,
  user_partial: "",
  assistant_partial: "",
  error: "",
  user_wave: zeros(),
  assistant_wave: zeros(),
})

const fill = (list: number[], value: number) => [...list.slice(-(size - 1)), Math.max(0, Math.min(1, value))]
let userAt = 0
let assistantAt = 0
let clockAt = 0

function wave(key: "user_wave" | "assistant_wave", value: number) {
  const now = Date.now()
  if (key === "user_wave") {
    if (now - userAt < waveGap) return
    userAt = now
  }
  if (key === "assistant_wave") {
    if (now - assistantAt < waveGap) return
    assistantAt = now
  }
  setState(key, (list) => fill(list, value))
}

export const voiceCall = {
  state,
  reset() {
    userAt = 0
    assistantAt = 0
    clockAt = 0
    setState({
      active: false,
      phase: "idle",
      vad: "idle",
      interrupting: false,
      elapsed_ms: 0,
      pending_user_turn: false,
      pending_tts: 0,
      user_partial: "",
      assistant_partial: "",
      error: "",
      user_wave: zeros(),
      assistant_wave: zeros(),
    })
  },
  start() {
    userAt = 0
    assistantAt = 0
    clockAt = 0
    if (!state.active) setState("user_wave", zeros())
    if (!state.active) setState("assistant_wave", zeros())
    setState("active", true)
    setState("error", "")
  },
  stop() {
    userAt = 0
    assistantAt = 0
    clockAt = 0
    setState("active", false)
    setState("phase", "idle")
    setState("vad", "idle")
    setState("interrupting", false)
    setState("elapsed_ms", 0)
    setState("pending_user_turn", false)
    setState("pending_tts", 0)
    setState("user_partial", "")
    setState("assistant_partial", "")
    setState("error", "")
    setState("user_wave", zeros())
    setState("assistant_wave", zeros())
  },
  phase(value: Phase) {
    if (state.phase === value) return
    setState("phase", value)
  },
  vad(value: Vad) {
    if (state.vad === value) return
    setState("vad", value)
  },
  user(value: string) {
    const next = clip(value)
    if (state.user_partial === next) return
    setState("user_partial", next)
  },
  assistant(value: string) {
    const next = clip(value)
    if (state.assistant_partial === next) return
    setState("assistant_partial", next)
  },
  error(value: string) {
    if (state.error === value && state.phase === "error") return
    setState("error", value)
    setState("phase", "error")
  },
  elapsed(value: number) {
    const now = Date.now()
    if (now - clockAt < clockGap) return
    clockAt = now
    setState("elapsed_ms", Math.max(0, value))
  },
  pending(value: boolean) {
    if (state.pending_user_turn === value) return
    setState("pending_user_turn", value)
  },
  tts(value: number) {
    const next = Math.max(0, value)
    if (state.pending_tts === next) return
    setState("pending_tts", next)
  },
  interrupt(value: boolean) {
    if (state.interrupting === value) return
    setState("interrupting", value)
  },
  userWave(value: number) {
    wave("user_wave", value)
  },
  assistantWave(value: number) {
    wave("assistant_wave", value)
  },
}

export type VoiceCallState = typeof state
