import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useSettings } from "@/context/settings"
import { voiceDebug } from "@/context/voice-debug"
import { formatServerError } from "@/utils/server-errors"
import { startPromptRecording } from "./prompt-input/voice"
import { SettingsList } from "./settings-list"
import {
  type VoiceConfigResolved,
  type VoicePreset,
  type VoiceStatus,
  voiceCfg,
  voiceDesignText,
  voiceInput,
  voiceTags,
} from "@opencode-ai/voice/schema"

const devices = [
  { value: "auto", label: "Auto" },
  { value: "cuda", label: "CUDA" },
  { value: "cpu", label: "CPU" },
  { value: "mps", label: "MPS" },
] as const

const dtypes = [
  { value: "auto", label: "Auto" },
  { value: "float16", label: "Float16" },
  { value: "float32", label: "Float32" },
  { value: "int8", label: "Int8" },
] as const

const ctypes = dtypes.filter((item) => item.value !== "auto")

const stamps = [
  { value: "none", label: "Sem timestamps" },
  { value: "segment", label: "Por segmento" },
  { value: "word", label: "Por palavra" },
] as const

const sttlangs = [
  { value: "auto", label: "Automático" },
  { value: "pt", label: "Português (pt)" },
  { value: "en", label: "Inglês (en)" },
  { value: "es", label: "Espanhol (es)" },
  { value: "fr", label: "Francês (fr)" },
  { value: "de", label: "Alemão (de)" },
  { value: "it", label: "Italiano (it)" },
  { value: "ja", label: "Japonês (ja)" },
  { value: "ko", label: "Coreano (ko)" },
  { value: "zh", label: "Chinês (zh)" },
  { value: "ru", label: "Russo (ru)" },
] as const

const sttmodels = [
  { value: "tiny", label: "tiny" },
  { value: "tiny.en", label: "tiny.en" },
  { value: "base", label: "base" },
  { value: "base.en", label: "base.en" },
  { value: "small", label: "small" },
  { value: "small.en", label: "small.en" },
  { value: "medium", label: "medium" },
  { value: "medium.en", label: "medium.en" },
  { value: "large-v1", label: "large-v1" },
  { value: "large-v2", label: "large-v2" },
  { value: "large-v3", label: "large-v3" },
  { value: "large", label: "large" },
  { value: "distil-large-v2", label: "distil-large-v2" },
  { value: "distil-large-v3", label: "distil-large-v3" },
] as const

const modes = [
  { value: "auto", label: "Auto" },
  { value: "clone", label: "Clonagem" },
  { value: "design", label: "Design de voz" },
] as const

const chunk = [
  { value: "clause", label: "Por oração" },
  { value: "sentence", label: "Por frase" },
] as const
const pauses = [
  { value: "balanced", label: "Balanceado" },
  { value: "aggressive", label: "Agressivo" },
  { value: "conservative", label: "Conservador" },
] as const
const autos = [{ value: "", label: "Auto" }] as const
const genders = [...autos, { value: "female", label: "Feminino" }, { value: "male", label: "Masculino" }] as const
const ages = [
  ...autos,
  { value: "child", label: "Criança" },
  { value: "teenager", label: "Adolescente" },
  { value: "young adult", label: "Jovem adulto" },
  { value: "middle-aged", label: "Meia-idade" },
  { value: "elderly", label: "Idoso" },
] as const
const pitches = [
  ...autos,
  { value: "very low pitch", label: "Muito grave" },
  { value: "low pitch", label: "Grave" },
  { value: "moderate pitch", label: "Médio" },
  { value: "high pitch", label: "Agudo" },
  { value: "very high pitch", label: "Muito agudo" },
] as const
const styles = [...autos, { value: "whisper", label: "Sussurro" }] as const
const accents = [
  ...autos,
  { value: "american accent", label: "American" },
  { value: "australian accent", label: "Australian" },
  { value: "british accent", label: "British" },
  { value: "canadian accent", label: "Canadian" },
  { value: "chinese accent", label: "Chinese" },
  { value: "indian accent", label: "Indian" },
  { value: "japanese accent", label: "Japanese" },
  { value: "korean accent", label: "Korean" },
  { value: "portuguese accent", label: "Portuguese" },
  { value: "russian accent", label: "Russian" },
] as const
const dialects = [
  ...autos,
  { value: "东北话", label: "Dongbei" },
  { value: "云南话", label: "Yunnan" },
  { value: "四川话", label: "Sichuan" },
  { value: "宁夏话", label: "Ningxia" },
  { value: "桂林话", label: "Guilin" },
  { value: "河南话", label: "Henan" },
  { value: "济南话", label: "Jinan" },
  { value: "甘肃话", label: "Gansu" },
  { value: "石家庄话", label: "Shijiazhuang" },
  { value: "贵州话", label: "Guizhou" },
  { value: "陕西话", label: "Shaanxi" },
  { value: "青岛话", label: "Qingdao" },
] as const

void accents
void dialects
const source = (value: unknown) => voiceCfg(value as VoiceConfigResolved)

const presetName = (item: VoicePreset) => `${item.name} (${item.mode})`
const leaf = (value?: string) => value?.split(/[/\\]/).pop() ?? ""
const clock = (value?: number) => {
  const next = Math.max(0, Math.round(value ?? 0))
  const min = Math.floor(next / 60)
  const sec = String(next % 60).padStart(2, "0")
  return `${min}:${sec}`
}

const wave = (value?: string, size = 72) => {
  const idle = Array.from({ length: size }, (_, idx) => 0.18 + ((idx % 9) / 24))
  if (!value?.startsWith("data:audio/")) return idle
  const body = value.split(",", 2)[1]
  if (!body) return idle
  try {
    const raw = atob(body)
    const buf = new Uint8Array(raw.length)
    for (let idx = 0; idx < raw.length; idx += 1) buf[idx] = raw.charCodeAt(idx)
    if (String.fromCharCode(...buf.slice(0, 4)) !== "RIFF") return idle
    const view = new DataView(buf.buffer)
    let fmt = 1
    let channels = 1
    let bits = 16
    let off = 12
    let start = 44
    let bytes = Math.max(0, buf.length - 44)
    while (off + 8 <= view.byteLength) {
      const id = String.fromCharCode(buf[off] ?? 0, buf[off + 1] ?? 0, buf[off + 2] ?? 0, buf[off + 3] ?? 0)
      const len = view.getUint32(off + 4, true)
      if (id === "fmt ") {
        fmt = view.getUint16(off + 8, true)
        channels = Math.max(1, view.getUint16(off + 10, true))
        bits = view.getUint16(off + 22, true)
      }
      if (id === "data") {
        start = off + 8
        bytes = len
        break
      }
      off += 8 + len + (len % 2)
    }
    if (fmt !== 1 || bits !== 16 || bytes <= 0) return idle
    const samples = Math.floor(bytes / 2 / channels)
    if (samples <= 0) return idle
    const out = Array.from({ length: size }, (_, idx) => {
      const from = Math.floor((samples * idx) / size)
      const to = Math.max(from + 1, Math.floor((samples * (idx + 1)) / size))
      let peak = 0
      let energy = 0
      for (let pos = from; pos < to; pos += 1) {
        let sample = 0
        for (let channel = 0; channel < channels; channel += 1) {
          const at = start + (pos * channels + channel) * 2
          sample = Math.max(sample, Math.abs(view.getInt16(at, true)) / 32768)
        }
        peak = Math.max(peak, sample)
        energy += sample * sample
      }
      const rms = Math.sqrt(energy / Math.max(1, to - from))
      const amp = Math.max(peak * 0.72, rms)
      return Math.max(0.08, Math.min(1, 0.08 + Math.pow(amp, 0.72) * 0.92))
    })
    return out.some((item) => item > 0.14) ? out : idle
  } catch {
    return idle
  }
}

const saveAudio = (audio: string, name: string) => {
  const link = document.createElement("a")
  link.href = audio
  link.download = name || "voice.wav"
  link.click()
}

export const SettingsVoice: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const settings = useSettings()
  const br = createMemo(() => language.locale() === "br")
  const tx = (pt: string, en = pt) => (br() ? pt : en)
  const [status, setStatus] = createSignal<VoiceStatus>()
  const [store, setStore] = createStore({
    saving: false,
    ensuring: false,
    canceling: false,
    preset: "",
    custom: false,
  })
  const [draft, setDraft] = createStore<VoiceConfigResolved>(source(globalSync.data.config.voice))
  const [inputs, setInputs] = createStore({
    tags: "",
  })
  const [preview, setPreview] = createStore({
    text: tx("Olá do OpenCode.", "Hello from OpenCode."),
    audio: "",
    status: tx("Pronto para sintetizar uma prévia.", "Ready to synthesize a preview."),
    busy: false,
  })
  const [capture, setCapture] = createStore({
    mode: "idle" as "idle" | "preparing" | "recording" | "saving" | "error",
    status: tx("Pronto para capturar um áudio de referência.", "Ready to capture a reference voice clip."),
    duration_ms: 0,
  })
  const [ref, setRef] = createStore({
    audio: "",
    name: "",
    loading: false,
    error: "",
  })
  const [audio, setAudio] = createSignal<Array<{ value: string; label: string }>>([
    { value: "", label: tx("Padrão do sistema", "System default") },
  ])
  let rec: Awaited<ReturnType<typeof startPromptRecording>> | undefined

  const current = createMemo(() => source(globalSync.data.config.voice))
  const dirty = createMemo(() => JSON.stringify(draft) !== JSON.stringify(current()))
  const preset = createMemo(() => draft.tts.presets.find((item) => item.id === store.preset))
  const clone = createMemo(() => preset()?.mode === "clone")
  const design = createMemo(() => preset()?.mode === "design")
  const models = createMemo(() => sttmodels.map((item) => ({ ...item })))
  const modelMap = createMemo(() => new Map((status()?.engines.stt.models ?? []).map((item) => [item.id, item])))
  const modelList = createMemo(() =>
    models().map((item) => {
      const hit = modelMap().get(item.value)
      return {
        ...item,
        downloaded: !!hit?.downloaded,
        loading: !!hit?.loading,
        progress: hit?.progress,
        active: draft.stt.model === item.value,
        note: hit?.note,
      }
    }),
  )
  const modelOptions = createMemo(() =>
    modelList().map((item) => ({
      ...item,
      state: item.loading
        ? tx(`baixando ${item.progress ?? 0}%`, `downloading ${item.progress ?? 0}%`)
        : item.downloaded
          ? tx("baixado", "downloaded")
          : tx("não baixado", "not downloaded"),
    })),
  )
  const customModel = createMemo(() => !sttmodels.some((item) => item.value === draft.stt.model) || store.custom)
  const runtimeReady = createMemo(() => status()?.engines.stt.standby && status()?.engines.tts.standby)
  const activity = createMemo(() => status()?.activity)
  const phaseText = createMemo(() => {
    const value = status()?.phase
    const map: Record<string, string> = {
      disabled: tx("desativado", "disabled"),
      idle: tx("ocioso", "idle"),
      ensuring: tx("preparando", "ensuring"),
      starting: tx("iniciando", "starting"),
      ready: tx("pronto", "ready"),
      busy: tx("ocupado", "busy"),
      error: tx("erro", "error"),
    }
    return map[value ?? "idle"] ?? value ?? tx("ocioso", "idle")
  })
  const activityText = createMemo(() => {
    const item = activity()
    if (!item?.stage) return
    const map: Record<string, string> = {
      dirs: tx("Preparando pastas", "Preparing directories"),
      ffmpeg: tx("Verificando FFmpeg", "Checking FFmpeg"),
      "install:stt": tx("Instalando runtime do WhisperX", "Installing WhisperX runtime"),
      "install:tts": tx("Instalando runtime do OmniVoice", "Installing OmniVoice runtime"),
      "start:stt": tx("Iniciando WhisperX", "Starting WhisperX"),
      "start:tts": tx("Iniciando OmniVoice", "Starting OmniVoice"),
      "warm:stt": tx("Aquecendo WhisperX", "Warming WhisperX"),
      "warm:tts": tx("Aquecendo OmniVoice", "Warming OmniVoice"),
      ready: tx("Pronto", "Ready"),
    }
    return map[item.stage] ?? item.stage
  })
  const busy = createMemo(() => ["ensuring", "starting"].includes(status()?.phase ?? "idle"))
  const running = (target: "all" | "stt" | "tts") => {
    const item = activity()?.target
    if (!item) return false
    if (item === "all") return true
    return item === target
  }
  const sttActive = createMemo(() => modelMap().get(draft.stt.model))
  const sttReady = createMemo(() => !!sttActive()?.downloaded)
  const whisperText = createMemo(() => {
    if (running("stt")) return tx("Pausar", "Pause")
    if (!status()?.engines.stt.installed) return tx("Baixar WhisperX", "Download WhisperX")
    if (!sttReady()) return tx("Baixar modelo atual", "Download current model")
    if (!status()?.engines.stt.warmed) return tx("Ativar WhisperX", "Warm WhisperX")
    return tx("Revalidar WhisperX", "Recheck WhisperX")
  })
  const omnivoiceText = createMemo(() => {
    if (running("tts")) return tx("Pausar", "Pause")
    if (!status()?.engines.tts.installed) return tx("Baixar OmniVoice", "Download OmniVoice")
    if (!status()?.engines.tts.warmed) return tx("Ativar OmniVoice", "Warm OmniVoice")
    return tx("Revalidar OmniVoice", "Recheck OmniVoice")
  })
  const runtimeText = createMemo(() => {
    if (running("all")) return tx("Pausar tudo", "Pause all")
    return tx("Preparar tudo", "Prepare all")
  })

  const syncDraft = () => {
    const next = current()
    setDraft(reconcile(next))
    const fallback = next.tts.default_preset ?? next.tts.presets[0]?.id ?? ""
    setStore("preset", fallback)
    setStore("custom", !sttmodels.some((item) => item.value === next.stt.model))
    setInputs("tags", next.tts.presets.find((item) => item.id === fallback)?.tags?.join(", ") ?? "")
  }

  const load = async () => {
    const res = await globalSDK.client.global.voice.status()
    if (res.data) setStatus(res.data)
  }

  const notify = (error: unknown) => {
    const message = formatServerError(error, undefined, tx("A requisição de voz falhou", "Voice request failed"))
    showToast({ title: tx("Falha nas configurações de voz", "Voice settings failed"), description: message })
  }

  const save = async () => {
    if (store.saving) return
    setStore("saving", true)
    try {
      await globalSync.updateConfig({ voice: draft })
      await load()
    } catch (error) {
      notify(error)
    } finally {
      setStore("saving", false)
    }
  }

  const ensure = async (target: "all" | "stt" | "tts" = "all", preload = true) => {
    if (store.ensuring || store.canceling) return
    setStore("ensuring", true)
    try {
      if (dirty()) {
        await globalSync.updateConfig({ voice: draft })
      }
      const res = await globalSDK.client.global.voice.ensure({
        voiceEnsureInput: { preload, target },
      })
      if (res.data) setStatus(res.data)
    } catch (error) {
      notify(error)
    } finally {
      setStore("ensuring", false)
    }
  }

  const cancel = async (target: "all" | "stt" | "tts" = "all") => {
    if (store.canceling) return
    setStore("canceling", true)
    try {
      const res = await globalSDK.client.global.voice.cancel({
        voiceCancelInput: { target },
      })
      if (res.data) setStatus(res.data)
    } catch (error) {
      notify(error)
    } finally {
      setStore("canceling", false)
    }
  }

  const patchPreset = <K extends keyof VoicePreset>(field: K, value: VoicePreset[K]) => {
    const idx = draft.tts.presets.findIndex((item) => item.id === store.preset)
    if (idx === -1) return
    const item = draft.tts.presets[idx]
    if (!item) return
    if (field === "id") {
      const next = String(value ?? "").trim() || item.id
      setDraft("tts", "presets", idx, "id", next)
      if (store.preset === item.id) setStore("preset", next)
      if (draft.tts.default_preset === item.id) setDraft("tts", "default_preset", next)
      return
    }
    setDraft("tts", "presets", idx, field, value)
  }

  const patchDesign = (
    field: "gender" | "age" | "pitch" | "style",
    value: string | undefined,
  ) => {
    const idx = draft.tts.presets.findIndex((item) => item.id === store.preset)
    if (idx === -1) return
    const next = {
      ...draft.tts.presets[idx]?.design,
      [field]: value || undefined,
    }
    if (!Object.values(next).some(Boolean)) {
      setDraft("tts", "presets", idx, "design", undefined)
      return
    }
    setDraft("tts", "presets", idx, "design", next)
  }

  const addPreset = () => {
    const item: VoicePreset = {
      id: `preset-${Date.now()}`,
      name: `Preset ${draft.tts.presets.length + 1}`,
      mode: "clone",
    }
    setDraft("tts", "presets", (list) => [...list, item])
    setStore("preset", item.id)
    setInputs("tags", "")
  }

  const removePreset = () => {
    const id = store.preset
    if (!id) return
    setDraft("tts", "presets", (list) => list.filter((item) => item.id !== id))
    if (draft.tts.default_preset === id) setDraft("tts", "default_preset", undefined)
    const next = draft.tts.presets.find((item) => item.id !== id)?.id ?? ""
    setStore("preset", next)
    setInputs("tags", "")
  }

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const next = list
      .filter((item) => item.kind === "audioinput")
      .map((item, idx) => ({
        value: item.deviceId,
        label: item.label || tx(`Entrada ${idx + 1}`, `Input ${idx + 1}`),
      }))
    setAudio([{ value: "", label: tx("Padrão do sistema", "System default") }, ...next])
  }

  const previewVoice = async () => {
    if (preview.busy) return
    setPreview("busy", true)
    setPreview("status", tx("Sintetizando prévia...", "Synthesizing preview..."))
    try {
      const res = await globalSDK.client.global.voice.synthesize({
        voiceSynthesizeInput: voiceInput({
          config: draft,
          text: preview.text,
          preset: store.preset || draft.tts.default_preset,
        }),
      })
      const audio = res.data?.audio ?? ""
      setPreview("audio", audio)
      setPreview("status", audio ? tx("Prévia pronta.", "Preview ready.") : tx("Nenhum áudio foi retornado.", "No audio returned."))
      voiceDebug.tts({
        state: audio ? "ready" : "empty",
        duration_ms: res.data?.duration_ms,
        preset: store.preset || draft.tts.default_preset,
        text: preview.text,
        error: undefined,
      })
    } catch (error) {
      const message = formatServerError(error, undefined, tx("A requisição de voz falhou", "Voice request failed"))
      setPreview("status", message)
      voiceDebug.tts({
        state: "error",
        preset: store.preset || draft.tts.default_preset,
        text: preview.text,
        error: message,
      })
      notify(error)
    } finally {
      setPreview("busy", false)
    }
  }

  const startCapture = async () => {
    if (capture.mode === "preparing" || capture.mode === "recording" || capture.mode === "saving") return
    const device = settings.voice.device() || undefined
    setCapture("mode", "preparing")
    setCapture("status", tx("Iniciando microfone...", "Starting microphone..."))
    try {
      rec = await startPromptRecording({ device })
      setCapture("mode", "recording")
      setCapture("status", tx("Gravando áudio de referência...", "Recording reference audio..."))
    } catch (error) {
      rec = undefined
      const message = formatServerError(error, undefined, tx("A captura de voz falhou", "Voice capture failed"))
      setCapture("mode", "error")
      setCapture("status", message)
      notify(error)
    }
  }

  const stopCapture = async () => {
    if (!rec) return
    const item = preset()
    const clip = await rec.stop().finally(() => {
      rec = undefined
    })
    setCapture("mode", "saving")
    setCapture("duration_ms", clip.duration_ms)
    setCapture("status", tx("Salvando áudio de referência...", "Saving reference audio..."))
    try {
      const res = await globalSDK.client.global.voice.reference({
        voiceReferenceInput: {
          audio: clip.audio,
          duration_ms: clip.duration_ms,
          language: item?.language,
          name: item?.name || item?.id,
          transcribe: true,
        },
      })
      const out = res.data
      if (out?.path) patchPreset("ref_audio_path", out.path)
      if (out?.text) patchPreset("ref_text", out.text)
      setRef({
        audio: clip.audio,
        name: out?.name ?? `${item?.name || item?.id || "reference"}.wav`,
        loading: false,
        error: "",
      })
      const status = out?.transcript_error
        ? tx(`Referência salva. A transcrição falhou: ${out.transcript_error}`, `Reference saved. Transcription failed: ${out.transcript_error}`)
        : out?.text
          ? tx("Referência salva e transcrita.", "Reference saved and transcribed.")
          : tx("Referência salva.", "Reference saved.")
      setCapture("mode", "idle")
      setCapture("status", status)
      showToast({
        title: tx("Áudio de referência salvo", "Reference audio saved"),
        description: out?.transcript_error ? status : out?.path,
      })
    } catch (error) {
      const message = formatServerError(error, undefined, tx("A captura de voz falhou", "Voice capture failed"))
      setCapture("mode", "error")
      setCapture("status", message)
      notify(error)
    }
  }

  const clearCapture = () => {
    patchPreset("ref_audio_path", undefined)
    patchPreset("ref_text", undefined)
    setCapture("duration_ms", 0)
    setCapture("mode", "idle")
    setCapture("status", tx("Referência limpa.", "Reference cleared."))
    setRef({
      audio: "",
      name: "",
      loading: false,
      error: "",
    })
  }

  onMount(() => {
    syncDraft()
    void load()
    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices)
  })

  createEffect(() => {
    current()
    syncDraft()
  })

  const off = globalSDK.event.on("global", (event) => {
    if (event.type !== "voice.updated") return
    setStatus(event.properties as VoiceStatus)
  })

  onCleanup(() => {
    off?.()
    void rec?.cancel()
    navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices)
  })

  createEffect(() => {
    const next = preset()
    setInputs("tags", next?.tags?.join(", ") ?? "")
    setPreview("audio", "")
    setPreview(
      "status",
      next
        ? next.mode === "clone" && !next.ref_audio_path
          ? tx("Grave um trecho de referência para testar esta voz clonada.", "Record a reference clip to preview this cloned voice.")
          : tx(`Editando ${next.name}.`, `Editing ${next.name}.`)
        : tx("Pronto para sintetizar uma prévia.", "Ready to synthesize a preview."),
    )
    setCapture("duration_ms", 0)
    setCapture("mode", "idle")
    setCapture(
      "status",
      next
        ? tx("Pronto para capturar um áudio de referência.", "Ready to capture a reference voice clip.")
        : tx("Selecione um preset para capturar uma referência.", "Select a preset to capture a reference."),
    )
    setRef({
      audio: "",
      name: "",
      loading: false,
      error: "",
    })
  })

  createEffect(() => {
    const file = preset()?.ref_audio_path
    if (!file) return
    let dead = false
    setRef({
      audio: "",
      name: leaf(file),
      loading: true,
      error: "",
    })
    void globalSDK.client.global.voice
      .asset({
        voiceAssetInput: {
          path: file,
        },
      })
      .then((res) => {
        if (dead) return
        setRef({
          audio: res.data?.audio ?? "",
          name: res.data?.name ?? leaf(file),
          loading: false,
          error: "",
        })
      })
      .catch((error: unknown) => {
        if (dead) return
        setRef({
          audio: "",
          name: leaf(file),
          loading: false,
          error: formatServerError(
            error,
            undefined,
            tx("Não foi possível carregar o áudio de referência", "Reference audio could not be loaded"),
          ),
        })
      })
    onCleanup(() => {
      dead = true
    })
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-3 pt-6 pb-8 max-w-[860px]">
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-1">
              <h2 class="text-16-medium text-text-strong">{tx("Voz", "Voice")}</h2>
              <div class="text-12-regular text-text-weak">
                {tx("Fase", "Phase")}: {phaseText()} | {tx("Dispositivo", "Device")}:{" "}
                {status()?.device ?? tx("desconhecido", "unknown")} | {tx("Motores", "Workers")}:{" "}
                {status()?.worker ? tx("online", "online") : tx("offline", "offline")}
              </div>
              <div class="text-12-regular text-text-weak">
                STT: {status()?.engines.stt.standby ? tx("em espera", "standby") : tx("frio", "cold")} | TTS:{" "}
                {status()?.engines.tts.standby ? tx("em espera", "standby") : tx("frio", "cold")}
                <Show when={runtimeReady()}>
                  <> | {tx("standby ativo", "standby active")}</>
                </Show>
                <Show when={activityText()}>
                  {(value) => <> | {value()}{activity()?.progress != null ? ` ${activity()?.progress}%` : ""}</>}
                </Show>
              </div>
              <Show when={status()?.error}>
                {(error) => <div class="text-12-regular text-status-error-base">{error()}</div>}
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <Button size="small" variant="secondary" onClick={() => void load()} disabled={busy()}>
                {tx("Atualizar status", "Refresh status")}
              </Button>
              <Button
                size="small"
                variant="secondary"
                onClick={() => void (busy() ? cancel(activity()?.target ?? "all") : ensure("all", true))}
                disabled={store.canceling}
              >
                {busy() ? tx("Pausar instalacao", "Pause install") : tx("Preparar tudo", "Prepare all")}
              </Button>
              <Button size="small" variant="primary" onClick={save} disabled={!dirty() || store.saving}>
                {store.saving ? tx("Salvando", "Saving") : tx("Salvar voz", "Save voice")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[860px]">
        <Section title={tx("Central de instalacao", "Install center")}>
          <div class="grid gap-3 md:grid-cols-3">
            <InstallCard
              title={tx("Runtime compartilhado", "Shared runtime")}
              description={tx(
                "Prepara Python, FFmpeg e o runtime local para um usuario leigo ligar voz sem setup manual.",
                "Prepare Python, FFmpeg, and the local runtime so a first-time user can enable voice without manual setup.",
              )}
              state={activityText() ?? tx("Pronto para preparar todos os componentes.", "Ready to prepare every component.")}
              progress={running("all") ? activity()?.progress : undefined}
              action={runtimeText()}
              busy={running("all")}
              onAction={() => void (running("all") ? cancel("all") : ensure("all", true))}
              tone={status()?.deps.python && status()?.deps.ffmpeg ? "good" : "warn"}
              tags={[
                {
                  label: `Python ${status()?.deps.python ? tx("ok", "ok") : tx("ausente", "missing")}`,
                  tone: status()?.deps.python ? "good" : "warn",
                },
                {
                  label: `FFmpeg ${status()?.deps.ffmpeg ? tx("ok", "ok") : tx("ausente", "missing")}`,
                  tone: status()?.deps.ffmpeg ? "good" : "warn",
                },
                {
                  label: `${tx("Dispositivo", "Device")}: ${draft.runtime.device}`,
                  tone: "muted",
                },
              ]}
            />
            <InstallCard
              title="WhisperX"
              description={tx(
                "Transcreve microfone e audio local. O modelo padrao para novos usuarios e small.",
                "Transcribe microphone and local audio. The default model for new users is small.",
              )}
              state={
                running("stt")
                  ? activityText() ?? tx("Instalando WhisperX...", "Installing WhisperX...")
                  : status()?.engines.stt.warmed
                    ? tx("WhisperX em espera e pronto para transcrever.", "WhisperX is warm and ready to transcribe.")
                    : status()?.engines.stt.installed
                      ? tx("WhisperX instalado. Falta aquecer o modelo selecionado.", "WhisperX is installed. Warm the selected model.")
                      : tx("WhisperX ainda nao foi instalado neste app.", "WhisperX is not installed in this app yet.")
              }
              progress={running("stt") ? status()?.engines.stt.progress ?? activity()?.progress : undefined}
              action={whisperText()}
              busy={running("stt")}
              onAction={() => void (running("stt") ? cancel("stt") : ensure("stt", true))}
              tone={status()?.engines.stt.warmed ? "good" : status()?.engines.stt.installed ? "warn" : "muted"}
              tags={[
                {
                  label: `${tx("Modelo", "Model")}: ${draft.stt.model}`,
                  tone: sttReady() ? "good" : "muted",
                },
                {
                  label: sttReady() ? tx("Modelo baixado", "Model downloaded") : tx("Modelo pendente", "Model pending"),
                  tone: sttReady() ? "good" : "warn",
                },
                {
                  label: status()?.engines.stt.standby ? tx("Em espera", "Standby") : tx("Frio", "Cold"),
                  tone: status()?.engines.stt.standby ? "good" : "muted",
                },
              ]}
              note={sttActive()?.note}
            />
            <InstallCard
              title="OmniVoice"
              description={tx(
                "Sintese local da voz do assistente com clone e design de voz. Usa o preset padrao salvo abaixo.",
                "Local assistant speech synthesis with voice clone and voice design. Uses the default preset saved below.",
              )}
              state={
                running("tts")
                  ? activityText() ?? tx("Instalando OmniVoice...", "Installing OmniVoice...")
                  : status()?.engines.tts.warmed
                    ? tx("OmniVoice em espera e pronto para falar.", "OmniVoice is warm and ready to speak.")
                    : status()?.engines.tts.installed
                      ? tx("OmniVoice instalado. Falta aquecer o motor.", "OmniVoice is installed. Warm the engine.")
                      : tx("OmniVoice ainda nao foi instalado neste app.", "OmniVoice is not installed in this app yet.")
              }
              progress={running("tts") ? status()?.engines.tts.progress ?? activity()?.progress : undefined}
              action={omnivoiceText()}
              busy={running("tts")}
              onAction={() => void (running("tts") ? cancel("tts") : ensure("tts", true))}
              tone={status()?.engines.tts.warmed ? "good" : status()?.engines.tts.installed ? "warn" : "muted"}
              tags={[
                {
                  label: status()?.engines.tts.installed ? tx("Runtime instalado", "Runtime installed") : tx("Runtime pendente", "Runtime pending"),
                  tone: status()?.engines.tts.installed ? "good" : "warn",
                },
                {
                  label: status()?.engines.tts.standby ? tx("Em espera", "Standby") : tx("Frio", "Cold"),
                  tone: status()?.engines.tts.standby ? "good" : "muted",
                },
                {
                  label: `${tx("Preset padrao", "Default preset")}: ${draft.tts.default_preset ?? tx("nenhum", "none")}`,
                  tone: "muted",
                },
              ]}
              note={status()?.engines.tts.note}
            />
          </div>
        </Section>

        <Section title={tx("Runtime", "Runtime")}>
          <SettingsList>
            <Row title={tx("Ativado", "Enabled")} description={tx("Expõe os recursos de voz local no aplicativo.", "Expose local voice features in the app.")}>
              <Switch checked={draft.runtime.enabled} onChange={(value) => setDraft("runtime", "enabled", value)} />
            </Row>
            <Row
              title={tx("Instalar sob demanda", "Install on demand")}
              description={tx(
                "Permite que a primeira chamada de STT/TTS prepare o runtime local automaticamente.",
                "Allow the first STT/TTS call to bootstrap the local runtime automatically.",
              )}
            >
              <Switch
                checked={draft.runtime.install_on_demand}
                onChange={(value) => setDraft("runtime", "install_on_demand", value)}
              />
            </Row>
            <Row
              title={tx("Python", "Python")}
              description={tx(
                "Executável local do Python usado para criar e gerenciar a venv de voz.",
                "Local Python executable used to create and manage the voice venv.",
              )}
            >
              <div class="w-full sm:w-[320px]">
                <TextField value={draft.runtime.python} onChange={(value) => setDraft("runtime", "python", value)} />
              </div>
            </Row>
            <Row title={tx("Dispositivo", "Device")} description={tx("Backend preferido para WhisperX e OmniVoice.", "Preferred execution backend for WhisperX and OmniVoice.")}>
              <Select
                options={[...devices]}
                current={devices.find((item) => item.value === draft.runtime.device)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setDraft("runtime", "device", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row title={tx("Precisao", "Dtype")} description={tx("Tipo principal do torch para o runtime de TTS.", "Primary torch dtype for the TTS runtime.")}>
              <Select
                options={[...dtypes]}
                current={dtypes.find((item) => item.value === draft.runtime.dtype)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setDraft("runtime", "dtype", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row title={tx("Token do Hugging Face", "HF token")} description={tx("Necessario para diarizacao e assets protegidos do Hugging Face.", "Required for diarization and gated Hugging Face assets.")}>
              <div class="w-full sm:w-[320px]">
                <TextField
                  type="password"
                  value={draft.runtime.hf_token ?? ""}
                  onChange={(value) => setDraft("runtime", "hf_token", value || undefined)}
                />
              </div>
            </Row>
          </SettingsList>
        </Section>

        <Section title="WhisperX">
          <SettingsList>
            <Row
              title={tx("Modelo", "Model")}
              description={tx(
                "Escolha um preset do WhisperX. O modelo selecionado pode ser pré-carregado agora e fica marcado quando já estiver baixado.",
                "Choose a WhisperX model preset. The selected model can be preloaded now and is marked when already downloaded.",
              )}
            >
                <div class="flex w-full flex-col gap-2 sm:w-[280px]">
                  <Select
                    options={modelOptions()}
                    current={modelOptions().find((item) => item.value === draft.stt.model)}
                    value={(item) => item.value}
                    label={(item) => `${item.label} • ${item.state}`}
                    children={(item) =>
                      item && (
                        <div class="flex min-w-0 items-center justify-between gap-3">
                          <span class="truncate">{item.label}</span>
                          <span
                            class="shrink-0 text-11-regular"
                            classList={{
                              "text-status-warning-base": item.loading,
                              "text-status-success-base": item.downloaded && !item.loading,
                              "text-text-weak": !item.downloaded && !item.loading,
                            }}
                          >
                            {item.state}
                          </span>
                        </div>
                      )
                    }
                    onSelect={(item) => {
                      if (!item) return
                      setStore("custom", false)
                      setDraft("stt", "model", item.value)
                    }}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                  <div class="flex items-center gap-2">
                    <Button size="small" variant="secondary" onClick={() => setStore("custom", !store.custom)}>
                      {store.custom ? tx("Fechar modelo customizado", "Hide custom model") : tx("Usar modelo customizado", "Use custom model")}
                    </Button>
                    <span class="text-12-regular text-text-weak">
                      {modelMap().get(draft.stt.model)?.loading ? `${activityText() ?? ""}${modelMap().get(draft.stt.model)?.progress != null ? ` ${modelMap().get(draft.stt.model)?.progress}%` : ""}`.trim() : ""}
                    </span>
                  </div>
                  <Show when={customModel()}>
                    <TextField
                      value={draft.stt.model}
                      placeholder={tx("Digite o id do modelo", "Type the model id")}
                      onChange={(value) => setDraft("stt", "model", value || "small")}
                    />
                  </Show>
                </div>
            </Row>
            <Row
              title={tx("Idioma", "Language")}
              description={tx(
                "Use automático para detecção de idioma ou fixe um código para acelerar a transcrição.",
                "Use auto for language detection or set a fixed language code.",
              )}
            >
              <div class="w-full sm:w-[180px]">
                <Select
                  options={[...sttlangs]}
                  current={sttlangs.find((item) => item.value === draft.stt.language) ?? sttlangs[0]}
                  value={(item) => item.value}
                  label={(item) => item.label}
                  onSelect={(item) => item && setDraft("stt", "language", item.value)}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </div>
            </Row>
            <Row title={tx("Timestamps", "Timestamps")} description={tx("Escolha a resolução temporal retornada pelo WhisperX.", "Choose the timestamp resolution returned by WhisperX.")}>
              <Select
                options={[...stamps]}
                current={stamps.find((item) => item.value === draft.stt.timestamps)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setDraft("stt", "timestamps", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row title={tx("Tipo de computação", "Compute type")} description={tx("Tipo de computação usado pelo WhisperX na inferência.", "WhisperX compute type for inference.")}>
              <Select
                options={ctypes}
                current={ctypes.find((item) => item.value === draft.stt.compute_type)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setDraft("stt", "compute_type", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row title={tx("Diarização", "Diarization")} description={tx("Atribui rótulos de falante quando houver um token válido do Hugging Face.", "Assign speaker labels when a valid Hugging Face token is configured.")}>
              <Switch checked={draft.stt.diarization} onChange={(value) => setDraft("stt", "diarization", value)} />
            </Row>
            <Row title={tx("Detector de voz", "VAD")} description={tx("Executa deteccao de atividade de voz antes da transcricao.", "Run voice activity detection before transcription.")}>
              <Switch checked={draft.stt.vad} onChange={(value) => setDraft("stt", "vad", value)} />
            </Row>
            <Row title={tx("Tamanho do lote", "Batch size")} description={tx("Tamanho do lote da transcrição. Valores maiores usam mais memória.", "Transcription batch size. Higher values use more memory.")}>
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.batch_size)}
                  onChange={(value) => setDraft("stt", "batch_size", Math.max(1, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row title={tx("Largura do beam", "Beam size")} description={tx("Largura do beam usada na decodificação do WhisperX.", "Beam width for WhisperX decoding.")}>
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.beam_size)}
                  onChange={(value) => setDraft("stt", "beam_size", Math.max(1, Number(value) || 1))}
                />
              </div>
            </Row>
          </SettingsList>
        </Section>

        <Section title="OmniVoice">
          <SettingsList>
            <Row title={tx("Fala em tempo real", "Live playback")} description={tx("Sintetiza o texto do assistente enquanto a resposta ainda está chegando.", "Synthesize assistant text while the answer is still streaming.")}>
              <Switch checked={draft.tts.live} onChange={(value) => setDraft("tts", "live", value)} />
            </Row>
            <Row title={tx("Reprodução automática", "Autoplay")} description={tx("Reproduz automaticamente o áudio sintetizado do assistente.", "Play synthesized assistant audio automatically.")}>
              <Switch checked={draft.tts.autoplay} onChange={(value) => setDraft("tts", "autoplay", value)} />
            </Row>
            <Row title={tx("Parar ao interromper", "Stop on interrupt")} description={tx("Cancela o áudio enfileirado do assistente quando chegar uma nova interrupção.", "Cancel queued assistant audio when a new interruption arrives.")}>
              <Switch checked={draft.tts.stop_on_interrupt} onChange={(value) => setDraft("tts", "stop_on_interrupt", value)} />
            </Row>
            <Row title={tx("Limpar markdown", "Strip markdown")} description={tx("Normaliza textos com muito markdown antes da síntese.", "Normalize markdown-heavy assistant text before synthesis.")}>
              <Switch checked={draft.tts.strip_markdown} onChange={(value) => setDraft("tts", "strip_markdown", value)} />
            </Row>
            <Row title={tx("Chunking", "Chunking")} description={tx("Estratégia de divisão usada na fala em tempo real.", "Chunking strategy for live playback.")}>
              <Select
                options={[...chunk]}
                current={chunk[0]}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setDraft("tts", "chunking", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row title={tx("Velocidade padrão", "Default speed")} description={tx("Velocidade padrão de fala enviada ao OmniVoice.", "Default speech speed passed to OmniVoice.")}>
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.tts.speed)}
                  onChange={(value) => setDraft("tts", "speed", Math.max(0.1, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row title={tx("Duração padrão", "Default duration")} description={tx("Dica opcional de duração para a síntese.", "Optional duration hint for synthesis.")}>
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={draft.tts.duration ? String(draft.tts.duration) : ""}
                  onChange={(value) => setDraft("tts", "duration", value ? Math.max(0.1, Number(value) || 0.1) : undefined)}
                />
              </div>
            </Row>
            <Row title={tx("Passos de difusão", "Diffusion steps")} description={tx("Passos de difusão do OmniVoice para balancear qualidade e latência.", "OmniVoice diffusion steps for generation quality and latency.")}>
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.tts.num_step)}
                  onChange={(value) => setDraft("tts", "num_step", Math.max(1, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row title={tx("Preset padrão", "Default preset")} description={tx("Preset usado na fala do assistente e em sínteses avulsas.", "Preset used for assistant playback and ad hoc synthesis.")}>
              <Select
                options={draft.tts.presets}
                current={draft.tts.presets.find((item) => item.id === draft.tts.default_preset)}
                value={(item) => item.id}
                label={presetName}
                onSelect={(item) => setDraft("tts", "default_preset", item?.id)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder={tx("Nenhum", "None")}
              />
            </Row>
          </SettingsList>
        </Section>

        <Section title={tx("Presets", "Presets")}>
          <SettingsList>
            <Row title={tx("Preset", "Preset")} description={tx("Selecione qual preset do OmniVoice você quer editar.", "Select which OmniVoice preset to edit.")}>
              <div class="flex items-center gap-2">
                <Select
                  options={draft.tts.presets}
                  current={preset()}
                  value={(item) => item.id}
                  label={presetName}
                  onSelect={(item) => setStore("preset", item?.id ?? "")}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                  placeholder={tx("Sem presets", "No presets")}
                />
                <Button size="small" variant="secondary" onClick={addPreset}>
                  {tx("Adicionar", "Add")}
                </Button>
                <Button size="small" variant="ghost" onClick={removePreset} disabled={!preset()}>
                  {tx("Remover", "Remove")}
                </Button>
              </div>
            </Row>
            <Show when={preset()}>
              {(item) => (
                <>
                  <Row title="Preset ID" description={tx("Identificador estável salvo na configuração do servidor.", "Stable identifier saved in server config.")}>
                    <div class="w-full sm:w-[220px]">
                      <TextField value={item().id} onChange={(value) => patchPreset("id", value)} />
                    </div>
                  </Row>
                  <Row title={tx("Nome", "Name")} description={tx("Nome amigável exibido nas configurações e no playback.", "Human-friendly name shown in settings and playback config.")}>
                    <div class="w-full sm:w-[220px]">
                      <TextField value={item().name} onChange={(value) => patchPreset("name", value)} />
                    </div>
                  </Row>
                  <Row title={tx("Modo", "Mode")} description={tx("Modo automático, clonagem de voz ou design de voz.", "Auto, voice clone, or design preset mode.")}>
                    <Select
                      options={[...modes]}
                      current={modes.find((entry) => entry.value === item().mode)}
                      value={(entry) => entry.value}
                      label={(entry) => entry.label}
                      onSelect={(entry) => entry && patchPreset("mode", entry.value)}
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </Row>
                  <Row title={tx("Usar como padrão", "Use as default")} description={tx("Define este preset como voz padrão do assistente.", "Make this preset the default voice for assistant playback and ad hoc synthesis.")}>
                    <Button size="small" variant="secondary" onClick={() => setDraft("tts", "default_preset", item().id)}>
                      {draft.tts.default_preset === item().id ? tx("Preset padrão", "Default preset") : tx("Definir como padrão", "Set as default")}
                    </Button>
                  </Row>
                  <Show when={clone()}>
                    <Row
                      title={tx("Audio de referencia", "Reference audio")}
                      description={tx(
                        "Grave um audio curto de ate 15 segundos aqui para clonar esta voz no OpenCode.",
                        "Record a short clip up to 15 seconds here to clone this voice in OpenCode.",
                      )}
                    >
                      <div class="w-full sm:w-[420px]">
                        <AudioCard
                          src={ref.audio}
                          name={ref.name || leaf(item().ref_audio_path) || `${item().name}.wav`}
                          ms={capture.duration_ms}
                          busy={capture.mode === "preparing" || capture.mode === "saving"}
                          empty={
                            ref.loading
                              ? tx("Carregando o audio de referencia salvo...", "Loading saved reference audio...")
                              : tx(
                                  "Grave um trecho curto de ate 15 segundos para clonar esta voz.",
                                  "Record a short clip up to 15 seconds to clone this voice.",
                                )
                          }
                          note={
                            ref.error ||
                            `${capture.status}${capture.duration_ms > 0 ? ` ${Math.round(capture.duration_ms / 1000)}s` : ""}${
                              item().ref_audio_path ? ` | ${leaf(item().ref_audio_path)}` : ""
                            }`
                          }
                          controls={
                            <>
                              <IconButton
                                size="small"
                                variant="ghost"
                                icon={capture.mode === "recording" ? "stop" : "mic"}
                                aria-label={capture.mode === "recording" ? tx("Parar gravação", "Stop recording") : tx("Gravar referência", "Record reference")}
                                onClick={capture.mode === "recording" ? stopCapture : startCapture}
                                disabled={capture.mode === "preparing" || capture.mode === "saving"}
                              />
                              <IconButton
                                size="small"
                                variant="ghost"
                                icon="trash"
                                aria-label={tx("Limpar referência", "Clear reference")}
                                onClick={clearCapture}
                                disabled={!item().ref_audio_path && !ref.audio}
                              />
                            </>
                          }
                        />
                      </div>
                    </Row>
                    <Row title={tx("Texto de referência", "Reference text")} description={tx("Transcrição usada junto da voz clonada.", "Transcript used with the cloned voice.")}>
                      <div class="w-full sm:w-[420px]">
                        <TextField
                          multiline
                          value={item().ref_text ?? ""}
                          onChange={(value) => patchPreset("ref_text", value || undefined)}
                        />
                      </div>
                    </Row>
                  </Show>
                  <Show when={!clone()}>
                    <>
                      <Row
                        title={tx("Instrução", "Instruction")}
                        description={tx("Orientação extra opcional do OmniVoice somada aos controles de design.", "Optional extra OmniVoice guidance layered on top of the design controls.")}
                      >
                        <div class="w-full sm:w-[320px]">
                          <TextField
                            multiline
                            value={item().instruct ?? ""}
                            onChange={(value) => patchPreset("instruct", value || undefined)}
                          />
                        </div>
                      </Row>
                      <Show when={design()}>
                        <>
                          <Row title={tx("Gênero", "Gender")} description={tx("Dica estruturada de design de voz incorporada à instrução do OmniVoice.", "Structured voice design hint folded into the OmniVoice instruction.")}>
                            <Select
                              options={[...genders]}
                              current={genders.find((entry) => entry.value === (item().design?.gender ?? "")) ?? genders[0]}
                              value={(entry) => entry.value}
                              label={(entry) => entry.label}
                              onSelect={(entry) => patchDesign("gender", entry?.value)}
                              variant="secondary"
                              size="small"
                              triggerVariant="settings"
                            />
                          </Row>
                          <Row title={tx("Idade", "Age")} description={tx("Dica estruturada de idade para o modo design de voz.", "Structured age hint for voice design mode.")}>
                            <Select
                              options={[...ages]}
                              current={ages.find((entry) => entry.value === (item().design?.age ?? "")) ?? ages[0]}
                              value={(entry) => entry.value}
                              label={(entry) => entry.label}
                              onSelect={(entry) => patchDesign("age", entry?.value)}
                              variant="secondary"
                              size="small"
                              triggerVariant="settings"
                            />
                          </Row>
                          <Row title={tx("Tom", "Pitch")} description={tx("Dica estruturada de tom para o modo design de voz.", "Structured pitch hint for voice design mode.")}>
                            <Select
                              options={[...pitches]}
                              current={pitches.find((entry) => entry.value === (item().design?.pitch ?? "")) ?? pitches[0]}
                              value={(entry) => entry.value}
                              label={(entry) => entry.label}
                              onSelect={(entry) => patchDesign("pitch", entry?.value)}
                              variant="secondary"
                              size="small"
                              triggerVariant="settings"
                            />
                          </Row>
                          <Row title={tx("Estilo", "Style")} description={tx("Dica estruturada de estilo para o modo design de voz.", "Structured style hint for voice design mode.")}>
                            <Select
                              options={[...styles]}
                              current={styles.find((entry) => entry.value === (item().design?.style ?? "")) ?? styles[0]}
                              value={(entry) => entry.value}
                              label={(entry) => entry.label}
                              onSelect={(entry) => patchDesign("style", entry?.value)}
                              variant="secondary"
                              size="small"
                              triggerVariant="settings"
                            />
                          </Row>
                        </>
                      </Show>
                      <Row title={tx("Tags", "Tags")} description={tx(`Tags do OmniVoice separadas por vírgula. Suportadas: ${voiceTags.join(", ")}`, `Comma-separated OmniVoice tags. Supported: ${voiceTags.join(", ")}`)}>
                        <div class="w-full sm:w-[320px]">
                          <TextField
                            value={inputs.tags}
                            onChange={(value) => {
                              setInputs("tags", value)
                              const next = value
                                .split(",")
                                .map((item) => item.trim())
                                .filter((item): item is (typeof voiceTags)[number] =>
                                  voiceTags.includes(item as (typeof voiceTags)[number]),
                                )
                              patchPreset("tags", next.length ? next : undefined)
                            }}
                          />
                        </div>
                      </Row>
                      <Row
                        title={tx("Instrução resolvida", "Resolved instruction")}
                        description={tx("Instrução final do OmniVoice após combinar controles estruturados e texto livre.", "Effective OmniVoice instruction after combining structured design controls and freeform instruction.")}
                      >
                        <div class="w-full sm:w-[320px]">
                          <TextField
                            multiline
                            readOnly
                            value={[voiceDesignText(item().design), item().instruct].filter(Boolean).join(" ").trim()}
                          />
                        </div>
                      </Row>
                      <Row title={tx("Idioma", "Language")} description={tx("Identificador opcional de idioma enviado ao OmniVoice.", "Optional language id passed to OmniVoice.")}>
                        <div class="w-full sm:w-[180px]">
                          <TextField
                            value={item().language ?? ""}
                            onChange={(value) => patchPreset("language", value || undefined)}
                          />
                        </div>
                      </Row>
                      <Row title={tx("Sobrescrever velocidade", "Speed override")} description={tx("Velocidade opcional só para este preset.", "Optional speed override for this preset only.")}>
                        <div class="w-full sm:w-[120px]">
                          <TextField
                            type="number"
                            value={item().speed ? String(item().speed) : ""}
                            onChange={(value) =>
                              patchPreset("speed", value ? Math.max(0.1, Number(value) || 0.1) : undefined)
                            }
                          />
                        </div>
                      </Row>
                    </>
                  </Show>
                  <Row title={tx("Texto da prévia", "Preview text")} description={tx("Valide rapidamente o preset selecionado sem sair das configurações.", "Quickly validate the selected OmniVoice preset without leaving Settings.")}>
                    <div class="flex w-full flex-col gap-3 sm:w-[420px]">
                      <TextField multiline value={preview.text} onChange={(value) => setPreview("text", value)} />
                      <div class="flex items-center gap-2">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={previewVoice}
                          disabled={preview.busy || (clone() && !item().ref_audio_path)}
                        >
                          {preview.busy ? tx("Sintetizando", "Synthesizing") : tx("Sintetizar prévia", "Synthesize preview")}
                        </Button>
                        <span class="text-12-regular text-text-weak">{preview.status}</span>
                      </div>
                      <AudioCard
                        src={preview.audio}
                        name={`${item().name || "preview"}.wav`}
                        busy={preview.busy}
                        empty={tx("Sintetize uma previa para ouvir o preset atual.", "Synthesize a preview to hear the current preset.")}
                        note={preview.status}
                      />
                    </div>
                  </Row>
                </>
              )}
            </Show>
          </SettingsList>
        </Section>

        <Section title={tx("Playback", "Playback")}>
          <SettingsList>
            <Row
              title={tx("Modelo da call", "Call model")}
              description={tx(
                "Modelo do WhisperX usado na conversa por voz em tempo real. O padrao e small por latencia.",
                "WhisperX model used by the realtime call flow. Defaults to small for latency.",
              )}
            >
              <Select
                options={modelOptions()}
                current={modelOptions().find((item) => item.value === draft.stt.call_model) ?? modelOptions()[0]}
                value={(item) => item.value}
                label={(item) => `${item.label} - ${item.state}`}
                onSelect={(item) => item && setDraft("stt", "call_model", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row
              title={tx("Perfil de pausa", "Pause profile")}
              description={tx(
                "Preset base de endpointing da call. Ao trocar o perfil, os tempos abaixo sao atualizados.",
                "Base call endpointing preset. Changing the profile updates the pause timings below.",
              )}
            >
              <Select
                options={[...pauses]}
                current={pauses.find((item) => item.value === draft.stt.call_pause_profile) ?? pauses[0]}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => {
                  if (!item) return
                  setDraft("stt", "call_pause_profile", item.value)
                  if (item.value === "aggressive") {
                    setDraft("stt", "call_partial_interval_ms", 500)
                    setDraft("stt", "short_pause_ms", 140)
                    setDraft("stt", "medium_pause_ms", 320)
                    setDraft("stt", "long_pause_ms", 700)
                    return
                  }
                  if (item.value === "conservative") {
                    setDraft("stt", "call_partial_interval_ms", 900)
                    setDraft("stt", "short_pause_ms", 240)
                    setDraft("stt", "medium_pause_ms", 600)
                    setDraft("stt", "long_pause_ms", 1200)
                    return
                  }
                  setDraft("stt", "call_partial_interval_ms", 700)
                  setDraft("stt", "short_pause_ms", 180)
                  setDraft("stt", "medium_pause_ms", 450)
                  setDraft("stt", "long_pause_ms", 900)
                }}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row
              title={tx("Parcial da call", "Call partial interval")}
              description={tx(
                "Intervalo minimo entre parciais durante a call, em milissegundos.",
                "Minimum interval between partial call transcriptions, in milliseconds.",
              )}
            >
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.call_partial_interval_ms)}
                  onChange={(value) => setDraft("stt", "call_partial_interval_ms", Math.max(100, Number(value) || 700))}
                />
              </div>
            </Row>
            <Row
              title={tx("Pausa curta", "Short pause")}
              description={tx("Limite de pausa curta para estabilizar parcial.", "Short pause threshold for partial stabilization.")}
            >
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.short_pause_ms)}
                  onChange={(value) => setDraft("stt", "short_pause_ms", Math.max(60, Number(value) || 180))}
                />
              </div>
            </Row>
            <Row
              title={tx("Pausa media", "Medium pause")}
              description={tx("Limite de pausa media para fechar o turno da fala.", "Medium pause threshold to close the spoken turn.")}
            >
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.medium_pause_ms)}
                  onChange={(value) => setDraft("stt", "medium_pause_ms", Math.max(120, Number(value) || 450))}
                />
              </div>
            </Row>
            <Row
              title={tx("Pausa longa", "Long pause")}
              description={tx("Limite de pausa longa para forcar o fechamento do turno.", "Long pause threshold to force-close the turn.")}
            >
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.long_pause_ms)}
                  onChange={(value) => setDraft("stt", "long_pause_ms", Math.max(240, Number(value) || 900))}
                />
              </div>
            </Row>
            <Row
              title={tx("Velocidade da call", "Call speed")}
              description={tx("Velocidade padrao do OmniVoice na call.", "Default OmniVoice speed during calls.")}
            >
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.tts.call_speed)}
                  onChange={(value) => setDraft("tts", "call_speed", Math.max(0.5, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row
              title={tx("Passos da call", "Call steps")}
              description={tx("Numero de passos do OmniVoice na call. Menor = menos latencia.", "OmniVoice steps during calls. Lower means less latency.")}
            >
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.tts.call_num_step)}
                  onChange={(value) => setDraft("tts", "call_num_step", Math.max(8, Number(value) || 24))}
                />
              </div>
            </Row>
            <Row
              title={tx("Remover markdown na call", "Strip markdown in calls")}
              description={tx("Normaliza listas, titulos e links antes da fala na call.", "Normalizes lists, headings, and links before speech in calls.")}
            >
              <Switch checked={draft.tts.call_strip_markdown} onChange={(value) => setDraft("tts", "call_strip_markdown", value)} />
            </Row>
            <Row
              title={tx("Parar ao interromper", "Stop on interruption")}
              description={tx("Corta a fala da IA quando voce comeca a falar na call.", "Cuts assistant speech when you start talking during a call.")}
            >
              <Switch checked={draft.tts.call_stop_on_interrupt} onChange={(value) => setDraft("tts", "call_stop_on_interrupt", value)} />
            </Row>
          </SettingsList>
        </Section>

        <Section title={tx("Playback", "Playback")}>
          <SettingsList>
            <Row title={tx("Mudo", "Mute")} description={tx("Silencia a fala do assistente sem desabilitar a sintese.", "Mute assistant playback without disabling synthesis.")}>
              <Switch checked={settings.voice.mute()} onChange={(value) => settings.voice.setMute(value)} />
            </Row>
            <Row title={tx("Volume", "Volume")} description={tx("Ganho local de reproducao do audio sintetizado.", "Local playback gain for synthesized assistant audio.")}>
              <div class="flex items-center gap-3 w-full sm:w-[220px]">
                <input
                  class="w-full"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.voice.volume()}
                  onInput={(event) => settings.voice.setVolume(Number(event.currentTarget.value))}
                />
                <span class="text-12-regular text-text-weak w-8 text-right">
                  {Math.round(settings.voice.volume() * 100)}
                </span>
              </div>
            </Row>
            <Row title={tx("Dispositivo de entrada", "Input device")} description={tx("Dispositivo preferido de gravacao para o botao de microfone do prompt.", "Preferred recording device for the prompt microphone button.")}>
              <Select
                options={audio()}
                current={audio().find((item) => item.value === settings.voice.device())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => settings.voice.setDevice(item?.value ?? "")}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </Row>
            <Row title={tx("Mostrar timings", "Show timings")} description={tx("Mantém os dados detalhados de tempo visíveis para debug e ferramentas futuras.", "Keep detailed timing data visible for debugging and future karaoke-style tools.")}>
              <Switch checked={settings.voice.timings()} onChange={(value) => settings.voice.setTimings(value)} />
            </Row>
          </SettingsList>
        </Section>
      </div>
    </div>
  )
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{props.title}</h3>
      {props.children}
    </div>
  )
}

function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

function InstallCard(props: {
  title: string
  description: string
  state: string
  action: string
  onAction: () => void
  tags: Array<{ label: string; tone: "good" | "warn" | "muted" }>
  tone?: "good" | "warn" | "muted"
  note?: string
  progress?: number
  busy?: boolean
}) {
  const bar = () => Math.max(0, Math.min(100, props.progress ?? 0))
  const fill = () =>
    props.tone === "good"
      ? "var(--icon-success-base)"
      : props.tone === "warn"
        ? "var(--icon-warning-base)"
        : "var(--icon-info-base)"

  return (
    <div class="flex min-h-[220px] flex-col gap-3 rounded-[14px] border border-border-weak-base bg-surface-base p-4">
      <div class="flex flex-col gap-1">
        <div class="text-14-medium text-text-strong">{props.title}</div>
        <div class="text-12-regular text-text-weak">{props.description}</div>
      </div>
      <div class="rounded-[10px] bg-surface-raised-base px-3 py-2">
        <div class="text-12-medium text-text-strong">{props.state}</div>
        <Show when={props.note}>
          {(note) => <div class="pt-1 text-11-regular text-text-weak">{note()}</div>}
        </Show>
        <Show when={props.progress != null}>
          <div class="pt-2">
            <div class="h-1.5 overflow-hidden rounded-full bg-background-strong">
              <div
                class="h-full rounded-full transition-all"
                style={{
                  width: `${bar()}%`,
                  "background-color": fill(),
                }}
              />
            </div>
            <div class="pt-1 text-11-regular text-text-weak">{bar()}%</div>
          </div>
        </Show>
      </div>
      <div class="flex flex-wrap gap-2">
        <For each={props.tags}>
          {(item) => (
            <span
              class="rounded-full px-2.5 py-1 text-11-medium"
              style={{
                color:
                  item.tone === "good"
                    ? "var(--status-success-base)"
                    : item.tone === "warn"
                      ? "var(--status-warning-base)"
                      : "var(--text-weak)",
                "background-color":
                  item.tone === "good"
                    ? "color-mix(in oklab, var(--status-success-base) 14%, transparent)"
                    : item.tone === "warn"
                      ? "color-mix(in oklab, var(--status-warning-base) 16%, transparent)"
                      : "color-mix(in oklab, var(--text-weak) 12%, transparent)",
              }}
            >
              {item.label}
            </span>
          )}
        </For>
      </div>
      <div class="mt-auto pt-1">
        <Button size="small" variant={props.busy ? "secondary" : "primary"} onClick={props.onAction}>
          {props.action}
        </Button>
      </div>
    </div>
  )
}

function AudioCard(props: {
  src?: string
  name?: string
  empty: string
  note?: string
  ms?: number
  busy?: boolean
  controls?: JSX.Element
}) {
  const bars = createMemo(() => wave(props.src))
  const [state, setState] = createStore({
    now: 0,
    len: props.ms ? props.ms / 1000 : 0,
    playing: false,
  })
  const ratio = createMemo(() => (state.len > 0 ? state.now / state.len : 0))
  let audio: HTMLAudioElement | undefined

  const stop = () => {
    audio?.pause()
    if (audio) audio.currentTime = 0
    setState("now", 0)
    setState("playing", false)
  }

  const toggle = async () => {
    if (!audio || !props.src) return
    if (state.playing) {
      audio.pause()
      setState("playing", false)
      return
    }
    await audio.play().catch(() => undefined)
  }

  const step = (delta: number) => {
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta))
    setState("now", audio.currentTime)
  }

  const seek = (event: MouseEvent) => {
    if (!audio || !state.len) return
    const box = (event.currentTarget as HTMLButtonElement | null)?.getBoundingClientRect()
    if (!box) return
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width)))
    audio.currentTime = ratio * state.len
    setState("now", audio.currentTime)
  }

  createEffect(() => {
    props.src
    stop()
    setState("len", props.ms ? props.ms / 1000 : 0)
  })

  onCleanup(stop)

  return (
    <div class="flex w-full flex-col gap-2">
      <div class="overflow-hidden rounded-[12px] border border-border-weak-base bg-surface-raised-base">
        <audio
          ref={audio}
          src={props.src}
          preload="metadata"
          onLoadedMetadata={(event) => setState("len", event.currentTarget.duration || (props.ms ? props.ms / 1000 : 0))}
          onTimeUpdate={(event) => setState("now", event.currentTarget.currentTime)}
          onPlay={() => setState("playing", true)}
          onPause={() => setState("playing", false)}
          onEnded={() => {
            setState("playing", false)
            setState("now", state.len)
          }}
        />
        <button
          type="button"
          class="relative flex h-24 w-full items-center overflow-hidden bg-background-strong px-3 py-3 text-left"
          onClick={seek}
          disabled={!props.src}
        >
          <div class="absolute inset-y-3 left-3 right-3">
            <div class="relative flex h-full items-center gap-[3px]">
              <For each={bars()}>
                {(item, idx) => (
                  <div
                    class="min-w-0 flex-1 self-center rounded-full transition-colors"
                    style={{
                      height: `${Math.max(8, Math.round(item * 44))}px`,
                      "background-color":
                        !!props.src && (idx() + 0.5) / Math.max(1, bars().length) <= ratio()
                          ? "var(--icon-warning-base)"
                          : "color-mix(in oklab, var(--text-weak) 48%, transparent)",
                    }}
                  />
                )}
              </For>
              <Show when={props.src && state.len > 0}>
                <div
                  class="pointer-events-none absolute inset-y-0 w-px bg-text-strong"
                  style={{ left: `calc(${Math.max(0, Math.min(100, ratio() * 100))}% - 0.5px)` }}
                />
              </Show>
            </div>
          </div>
        </button>
        <div class="flex items-center justify-between border-t border-border-weak-base px-3 py-2">
          <div class="flex items-center gap-2">
            <Button size="small" variant="secondary" onClick={() => step(-5)} disabled={!props.src}>
              -5s
            </Button>
            <Button size="small" variant="secondary" onClick={toggle} disabled={!props.src || props.busy}>
              {state.playing ? "Pausar" : "Reproduzir"}
            </Button>
            <Button size="small" variant="secondary" onClick={() => step(5)} disabled={!props.src}>
              +5s
            </Button>
          </div>
          <div class="flex items-center gap-2 text-12-regular text-text-weak">
            <span>{clock(state.now)}</span>
            <span>/</span>
            <span>{clock(state.len)}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="truncate text-12-medium text-text-strong">{props.name || "Clipe de voz"}</div>
          <div class="text-12-regular text-text-weak">{props.note || props.empty}</div>
        </div>
        <div class="flex items-center gap-1">
          <Show when={props.src}>
            <IconButton
              size="small"
              variant="ghost"
              icon="download"
              aria-label="Baixar áudio"
              onClick={() => props.src && saveAudio(props.src, props.name || "voice.wav")}
            />
          </Show>
          {props.controls}
        </div>
      </div>
    </div>
  )
}

