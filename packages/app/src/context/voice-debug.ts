import { createStore } from "solid-js/store"

type MicState = "idle" | "preparing" | "recording" | "transcribing" | "error"
type JobState = "idle" | "running" | "ready" | "empty" | "error"
type QueueState = "idle" | "loading" | "playing" | "blocked" | "error"

type State = {
  mic: {
    state: MicState
    at: number
    device?: string
    duration_ms?: number
    peak?: number
    error?: string
  }
  stt: {
    state: JobState
    at: number
    duration_ms?: number
    audio_ms?: number
    words?: number
    segments?: number
    text?: string
    error?: string
  }
  tts: {
    state: JobState
    at: number
    duration_ms?: number
    preset?: string
    text?: string
    error?: string
  }
  queue: {
    state: QueueState
    at: number
    pending: number
    mode: "webaudio" | "htmlaudio" | "none"
    muted: boolean
    volume: number
    error?: string
  }
}

const now = () => Date.now()

const init: State = {
  mic: {
    state: "idle",
    at: 0,
  },
  stt: {
    state: "idle",
    at: 0,
  },
  tts: {
    state: "idle",
    at: 0,
  },
  queue: {
    state: "idle",
    at: 0,
    pending: 0,
    mode: "none",
    muted: false,
    volume: 1,
  },
}

const [state, setState] = createStore(init)

const text = (input?: string) => {
  const next = input?.trim()
  if (!next) return
  return next.length > 120 ? `${next.slice(0, 117)}...` : next
}

function patch<K extends keyof State>(key: K, next: Partial<State[K]>) {
  setState(key, (prev) => ({
    ...prev,
    ...next,
    at: now(),
  }))
}

export const voiceDebug = {
  state,
  reset() {
    setState(init)
  },
  mic(next: Partial<State["mic"]>) {
    patch("mic", next)
  },
  stt(next: Partial<State["stt"]>) {
    patch("stt", {
      ...next,
      text: text(next.text),
    })
  },
  tts(next: Partial<State["tts"]>) {
    patch("tts", {
      ...next,
      text: text(next.text),
    })
  },
  queue(next: Partial<State["queue"]>) {
    patch("queue", next)
  },
}

export type VoiceDebugState = typeof state
