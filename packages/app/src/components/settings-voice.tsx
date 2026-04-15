import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
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
  { value: "none", label: "None" },
  { value: "segment", label: "Segment" },
  { value: "word", label: "Word" },
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
  { value: "clone", label: "Clone" },
  { value: "design", label: "Design" },
] as const

const chunk = [{ value: "sentence", label: "Sentence" }] as const
const autos = [{ value: "", label: "Auto" }] as const
const genders = [...autos, { value: "female", label: "Female" }, { value: "male", label: "Male" }] as const
const ages = [
  ...autos,
  { value: "child", label: "Child" },
  { value: "teenager", label: "Teenager" },
  { value: "young adult", label: "Young adult" },
  { value: "middle-aged", label: "Middle-aged" },
  { value: "elderly", label: "Elderly" },
] as const
const pitches = [
  ...autos,
  { value: "very low pitch", label: "Very low" },
  { value: "low pitch", label: "Low" },
  { value: "moderate pitch", label: "Moderate" },
  { value: "high pitch", label: "High" },
  { value: "very high pitch", label: "Very high" },
] as const
const styles = [...autos, { value: "whisper", label: "Whisper" }] as const
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
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const settings = useSettings()
  const [status, setStatus] = createSignal<VoiceStatus>()
  const [store, setStore] = createStore({
    saving: false,
    ensuring: false,
    preset: "",
  })
  const [draft, setDraft] = createStore<VoiceConfigResolved>(source(globalSync.data.config.voice))
  const [inputs, setInputs] = createStore({
    tags: "",
  })
  const [preview, setPreview] = createStore({
    text: "Hello from OpenCode.",
    audio: "",
    status: "Ready to synthesize a preview.",
    busy: false,
  })
  const [capture, setCapture] = createStore({
    mode: "idle" as "idle" | "preparing" | "recording" | "saving" | "error",
    status: "Ready to capture a reference voice clip.",
    duration_ms: 0,
  })
  const [ref, setRef] = createStore({
    audio: "",
    name: "",
    loading: false,
    error: "",
  })
  const [audio, setAudio] = createSignal<Array<{ value: string; label: string }>>([{ value: "", label: "System default" }])
  let rec: Awaited<ReturnType<typeof startPromptRecording>> | undefined

  const current = createMemo(() => source(globalSync.data.config.voice))
  const dirty = createMemo(() => JSON.stringify(draft) !== JSON.stringify(current()))
  const preset = createMemo(() => draft.tts.presets.find((item) => item.id === store.preset))
  const clone = createMemo(() => preset()?.mode === "clone")
  const design = createMemo(() => preset()?.mode === "design")
  const models = createMemo(() => {
    const list = sttmodels.map((item) => ({ ...item }))
    if (list.some((item) => item.value === draft.stt.model)) return list
    if (!draft.stt.model.trim()) return list
    return [{ value: draft.stt.model, label: `Custom (${draft.stt.model})` }, ...list]
  })

  const syncDraft = () => {
    const next = current()
    setDraft(reconcile(next))
    const fallback = next.tts.default_preset ?? next.tts.presets[0]?.id ?? ""
    setStore("preset", fallback)
    setInputs("tags", next.tts.presets.find((item) => item.id === fallback)?.tags?.join(", ") ?? "")
  }

  const load = async () => {
    const res = await globalSDK.client.global.voice.status()
    if (res.data) setStatus(res.data)
  }

  const notify = (error: unknown) => {
    const message = formatServerError(error, undefined, "Voice request failed")
    showToast({ title: "Voice settings failed", description: message })
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

  const ensure = async (preload = false) => {
    if (store.ensuring) return
    setStore("ensuring", true)
    try {
      if (preload && dirty()) {
        await globalSync.updateConfig({ voice: draft })
      }
      const res = await globalSDK.client.global.voice.ensure({
        voiceEnsureInput: { preload },
      })
      if (res.data) setStatus(res.data)
    } catch (error) {
      notify(error)
    } finally {
      setStore("ensuring", false)
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
        label: item.label || `Input ${idx + 1}`,
      }))
    setAudio([{ value: "", label: "System default" }, ...next])
  }

  const previewVoice = async () => {
    if (preview.busy) return
    setPreview("busy", true)
    setPreview("status", "Synthesizing preview...")
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
      setPreview("status", audio ? "Preview ready." : "No audio returned.")
      voiceDebug.tts({
        state: audio ? "ready" : "empty",
        duration_ms: res.data?.duration_ms,
        preset: store.preset || draft.tts.default_preset,
        text: preview.text,
        error: undefined,
      })
    } catch (error) {
      const message = formatServerError(error, undefined, "Voice request failed")
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
    setCapture("status", "Starting microphone...")
    try {
      rec = await startPromptRecording({ device })
      setCapture("mode", "recording")
      setCapture("status", "Recording reference audio...")
    } catch (error) {
      rec = undefined
      const message = formatServerError(error, undefined, "Voice capture failed")
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
    setCapture("status", "Saving reference audio...")
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
        ? `Reference saved. Transcription failed: ${out.transcript_error}`
        : out?.text
          ? "Reference saved and transcribed."
          : "Reference saved."
      setCapture("mode", "idle")
      setCapture("status", status)
      showToast({
        title: "Reference audio saved",
        description: out?.transcript_error ? status : out?.path,
      })
    } catch (error) {
      const message = formatServerError(error, undefined, "Voice capture failed")
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
    setCapture("status", "Reference cleared.")
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
          ? "Record a reference clip to preview this cloned voice."
          : `Editing ${next.name}.`
        : "Ready to synthesize a preview.",
    )
    setCapture("duration_ms", 0)
    setCapture("mode", "idle")
    setCapture("status", next ? "Ready to capture a reference voice clip." : "Select a preset to capture a reference.")
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
          error: formatServerError(error, undefined, "Reference audio could not be loaded"),
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
              <h2 class="text-16-medium text-text-strong">Voice</h2>
              <div class="text-12-regular text-text-weak">
                Phase: {status()?.phase ?? "idle"} | Device: {status()?.device ?? "unknown"} | Worker:{" "}
                {status()?.worker ? "online" : "offline"}
              </div>
              <Show when={status()?.error}>
                {(error) => <div class="text-12-regular text-status-error-base">{error()}</div>}
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <Button size="small" variant="secondary" onClick={() => void ensure()} disabled={store.ensuring}>
                {store.ensuring ? "Preparing runtime" : "Ensure runtime"}
              </Button>
              <Button size="small" variant="secondary" onClick={() => void ensure(true)} disabled={store.ensuring}>
                {store.ensuring ? "Preloading" : "Preload models"}
              </Button>
              <Button size="small" variant="primary" onClick={save} disabled={!dirty() || store.saving}>
                {store.saving ? "Saving" : "Save voice"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[860px]">
        <Section title="Runtime">
          <SettingsList>
            <Row title="Enabled" description="Expose local voice features in the app.">
              <Switch checked={draft.runtime.enabled} onChange={(value) => setDraft("runtime", "enabled", value)} />
            </Row>
            <Row title="Install on demand" description="Allow the first STT/TTS call to bootstrap the local runtime automatically.">
              <Switch
                checked={draft.runtime.install_on_demand}
                onChange={(value) => setDraft("runtime", "install_on_demand", value)}
              />
            </Row>
            <Row title="Python" description="Local Python executable used to create and manage the voice venv.">
              <div class="w-full sm:w-[320px]">
                <TextField value={draft.runtime.python} onChange={(value) => setDraft("runtime", "python", value)} />
              </div>
            </Row>
            <Row title="Device" description="Preferred execution backend for WhisperX and OmniVoice.">
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
            <Row title="Dtype" description="Primary torch dtype for the TTS runtime.">
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
            <Row title="HF token" description="Required for diarization and gated Hugging Face assets.">
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

          <Section title="STT">
            <SettingsList>
              <Row title="Model" description="Choose a WhisperX model preset or type a custom model id. Preload models to download the current one now.">
                <div class="flex w-full flex-col gap-2 sm:w-[280px]">
                  <Select
                    options={models()}
                    current={models().find((item) => item.value === draft.stt.model)}
                    value={(item) => item.value}
                    label={(item) => item.label}
                    onSelect={(item) => item && setDraft("stt", "model", item.value)}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                  />
                  <TextField value={draft.stt.model} onChange={(value) => setDraft("stt", "model", value || "small")} />
                </div>
              </Row>
            <Row title="Language" description="Use auto for language detection or set a fixed language code.">
              <div class="w-full sm:w-[180px]">
                <TextField value={draft.stt.language} onChange={(value) => setDraft("stt", "language", value || "auto")} />
              </div>
            </Row>
            <Row title="Timestamps" description="Choose the timestamp resolution returned by WhisperX.">
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
            <Row title="Compute type" description="WhisperX compute type for inference.">
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
            <Row title="Diarization" description="Assign speaker labels when a valid Hugging Face token is configured.">
              <Switch checked={draft.stt.diarization} onChange={(value) => setDraft("stt", "diarization", value)} />
            </Row>
            <Row title="VAD" description="Run voice activity detection before transcription.">
              <Switch checked={draft.stt.vad} onChange={(value) => setDraft("stt", "vad", value)} />
            </Row>
            <Row title="Batch size" description="Transcription batch size. Higher values use more memory.">
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.stt.batch_size)}
                  onChange={(value) => setDraft("stt", "batch_size", Math.max(1, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row title="Beam size" description="Beam width for WhisperX decoding.">
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

        <Section title="TTS">
          <SettingsList>
            <Row title="Live playback" description="Synthesize assistant text while the answer is still streaming.">
              <Switch checked={draft.tts.live} onChange={(value) => setDraft("tts", "live", value)} />
            </Row>
            <Row title="Autoplay" description="Play synthesized assistant audio automatically.">
              <Switch checked={draft.tts.autoplay} onChange={(value) => setDraft("tts", "autoplay", value)} />
            </Row>
            <Row title="Stop on interrupt" description="Cancel queued assistant audio when a new interruption arrives.">
              <Switch checked={draft.tts.stop_on_interrupt} onChange={(value) => setDraft("tts", "stop_on_interrupt", value)} />
            </Row>
            <Row title="Strip markdown" description="Normalize markdown-heavy assistant text before synthesis.">
              <Switch checked={draft.tts.strip_markdown} onChange={(value) => setDraft("tts", "strip_markdown", value)} />
            </Row>
            <Row title="Chunking" description="Chunking strategy for live playback.">
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
            <Row title="Default speed" description="Default speech speed passed to OmniVoice.">
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.tts.speed)}
                  onChange={(value) => setDraft("tts", "speed", Math.max(0.1, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row title="Default duration" description="Optional duration hint for synthesis.">
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={draft.tts.duration ? String(draft.tts.duration) : ""}
                  onChange={(value) => setDraft("tts", "duration", value ? Math.max(0.1, Number(value) || 0.1) : undefined)}
                />
              </div>
            </Row>
            <Row title="Diffusion steps" description="OmniVoice diffusion steps for generation quality and latency.">
              <div class="w-full sm:w-[120px]">
                <TextField
                  type="number"
                  value={String(draft.tts.num_step)}
                  onChange={(value) => setDraft("tts", "num_step", Math.max(1, Number(value) || 1))}
                />
              </div>
            </Row>
            <Row title="Default preset" description="Preset used for assistant playback and ad hoc synthesis.">
              <Select
                options={draft.tts.presets}
                current={draft.tts.presets.find((item) => item.id === draft.tts.default_preset)}
                value={(item) => item.id}
                label={presetName}
                onSelect={(item) => setDraft("tts", "default_preset", item?.id)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder="None"
              />
            </Row>
          </SettingsList>
        </Section>

        <Section title="Presets">
          <SettingsList>
            <Row title="Preset" description="Select which OmniVoice preset to edit.">
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
                  placeholder="No presets"
                />
                <Button size="small" variant="secondary" onClick={addPreset}>
                  Add
                </Button>
                <Button size="small" variant="ghost" onClick={removePreset} disabled={!preset()}>
                  Remove
                </Button>
              </div>
            </Row>
            <Show when={preset()}>
              {(item) => (
                <>
                  <Row title="Preset ID" description="Stable identifier saved in server config.">
                    <div class="w-full sm:w-[220px]">
                      <TextField value={item().id} onChange={(value) => patchPreset("id", value)} />
                    </div>
                  </Row>
                  <Row title="Name" description="Human-friendly name shown in settings and playback config.">
                    <div class="w-full sm:w-[220px]">
                      <TextField value={item().name} onChange={(value) => patchPreset("name", value)} />
                    </div>
                  </Row>
                  <Row title="Mode" description="Auto, voice clone, or design preset mode.">
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
                  <Row title="Use as default" description="Make this preset the default voice for assistant playback and ad hoc synthesis.">
                    <Button size="small" variant="secondary" onClick={() => setDraft("tts", "default_preset", item().id)}>
                      {draft.tts.default_preset === item().id ? "Default preset" : "Set as default"}
                    </Button>
                  </Row>
                  <Show when={clone()}>
                    <Row title="Reference audio" description="Record 3 to 10 seconds here to clone this voice directly in OpenCode.">
                      <div class="w-full sm:w-[420px]">
                        <AudioCard
                          src={ref.audio}
                          name={ref.name || leaf(item().ref_audio_path) || `${item().name}.wav`}
                          ms={capture.duration_ms}
                          busy={capture.mode === "preparing" || capture.mode === "saving"}
                          empty={ref.loading ? "Loading saved reference audio..." : "Record a short reference clip to clone this voice."}
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
                                aria-label={capture.mode === "recording" ? "Stop recording" : "Record reference"}
                                onClick={capture.mode === "recording" ? stopCapture : startCapture}
                                disabled={capture.mode === "preparing" || capture.mode === "saving"}
                              />
                              <IconButton
                                size="small"
                                variant="ghost"
                                icon="trash"
                                aria-label="Clear reference"
                                onClick={clearCapture}
                                disabled={!item().ref_audio_path && !ref.audio}
                              />
                            </>
                          }
                        />
                      </div>
                    </Row>
                    <Row title="Reference text" description="Transcript used with the cloned voice.">
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
                        title="Instruction"
                        description="Optional extra OmniVoice guidance layered on top of the design controls."
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
                          <Row title="Gender" description="Structured voice design hint folded into the OmniVoice instruction.">
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
                          <Row title="Age" description="Structured age hint for voice design mode.">
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
                          <Row title="Pitch" description="Structured pitch hint for voice design mode.">
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
                          <Row title="Style" description="Structured style hint for voice design mode.">
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
                      <Row title="Tags" description={`Comma-separated OmniVoice tags. Supported: ${voiceTags.join(", ")}`}>
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
                        title="Resolved instruction"
                        description="Effective OmniVoice instruction after combining structured design controls and freeform instruction."
                      >
                        <div class="w-full sm:w-[320px]">
                          <TextField
                            multiline
                            readOnly
                            value={[voiceDesignText(item().design), item().instruct].filter(Boolean).join(" ").trim()}
                          />
                        </div>
                      </Row>
                      <Row title="Language" description="Optional language id passed to OmniVoice.">
                        <div class="w-full sm:w-[180px]">
                          <TextField
                            value={item().language ?? ""}
                            onChange={(value) => patchPreset("language", value || undefined)}
                          />
                        </div>
                      </Row>
                      <Row title="Speed override" description="Optional speed override for this preset only.">
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
                  <Row title="Preview text" description="Quickly validate the selected OmniVoice preset without leaving Settings.">
                    <div class="flex w-full flex-col gap-3 sm:w-[420px]">
                      <TextField multiline value={preview.text} onChange={(value) => setPreview("text", value)} />
                      <div class="flex items-center gap-2">
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={previewVoice}
                          disabled={preview.busy || (clone() && !item().ref_audio_path)}
                        >
                          {preview.busy ? "Synthesizing" : "Synthesize preview"}
                        </Button>
                        <span class="text-12-regular text-text-weak">{preview.status}</span>
                      </div>
                      <AudioCard
                        src={preview.audio}
                        name={`${item().name || "preview"}.wav`}
                        busy={preview.busy}
                        empty="Synthesize a preview to hear the current preset."
                        note={preview.status}
                      />
                    </div>
                  </Row>
                </>
              )}
            </Show>
          </SettingsList>
        </Section>

        <Section title="Playback">
          <SettingsList>
            <Row title="Mute" description="Mute assistant playback without disabling synthesis.">
              <Switch checked={settings.voice.mute()} onChange={(value) => settings.voice.setMute(value)} />
            </Row>
            <Row title="Volume" description="Local playback gain for synthesized assistant audio.">
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
            <Row title="Input device" description="Preferred recording device for the prompt microphone button.">
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
            <Row title="Show timings" description="Keep detailed timing data visible for debugging and future karaoke-style tools.">
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
              {state.playing ? "Pause" : "Play"}
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
          <div class="truncate text-12-medium text-text-strong">{props.name || "Voice clip"}</div>
          <div class="text-12-regular text-text-weak">{props.note || props.empty}</div>
        </div>
        <div class="flex items-center gap-1">
          <Show when={props.src}>
            <IconButton
              size="small"
              variant="ghost"
              icon="download"
              aria-label="Download audio"
              onClick={() => props.src && saveAudio(props.src, props.name || "voice.wav")}
            />
          </Show>
          {props.controls}
        </div>
      </div>
    </div>
  )
}
