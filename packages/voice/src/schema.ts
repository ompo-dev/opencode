import z from "zod"
import { normalizeSpeechText } from "./chunk"

export const voiceTags = [
  "[laughter]",
  "[sigh]",
  "[confirmation-en]",
  "[question-en]",
  "[question-ah]",
  "[question-oh]",
  "[question-ei]",
  "[question-yi]",
  "[surprise-ah]",
  "[surprise-oh]",
  "[surprise-wa]",
  "[surprise-yo]",
  "[dissatisfaction-hnn]",
] as const

export const VoiceTag = z.enum(voiceTags).meta({ ref: "VoiceTag" })
export const VoiceMode = z.enum(["auto", "clone", "design"]).meta({ ref: "VoiceMode" })
export const VoiceProfile = z.enum(["default", "call"]).meta({ ref: "VoiceProfile" })
export const VoicePauseProfile = z
  .enum(["balanced", "aggressive", "conservative"])
  .meta({ ref: "VoicePauseProfile" })
export const VoiceDesign = z
  .object({
    gender: z.string().trim().min(1).optional(),
    age: z.string().trim().min(1).optional(),
    pitch: z.string().trim().min(1).optional(),
    style: z.string().trim().min(1).optional(),
    english_accent: z.string().trim().min(1).optional(),
    chinese_dialect: z.string().trim().min(1).optional(),
  })
  .strict()
  .meta({ ref: "VoiceDesign" })

export const Runtime = z
  .object({
    enabled: z.boolean().optional(),
    python: z.string().optional(),
    device: z.enum(["auto", "cuda", "cpu", "mps"]).optional(),
    dtype: z.enum(["auto", "float16", "float32", "int8"]).optional(),
    install_on_demand: z.boolean().optional(),
    hf_token: z.string().optional(),
  })
  .strict()
  .meta({ ref: "VoiceRuntime" })

export const Stt = z
  .object({
    provider: z.literal("whisperx").optional(),
    model: z.string().optional(),
    call_model: z.string().optional(),
    language: z.string().optional(),
    timestamps: z.enum(["none", "segment", "word"]).optional(),
    diarization: z.boolean().optional(),
    vad: z.boolean().optional(),
    compute_type: z.enum(["float16", "float32", "int8"]).optional(),
    batch_size: z.number().int().positive().optional(),
    beam_size: z.number().int().positive().optional(),
    call_partial_interval_ms: z.number().int().positive().optional(),
    call_pause_profile: VoicePauseProfile.optional(),
    short_pause_ms: z.number().int().positive().optional(),
    medium_pause_ms: z.number().int().positive().optional(),
    long_pause_ms: z.number().int().positive().optional(),
  })
  .strict()
  .meta({ ref: "VoiceStt" })

export const Preset = z
  .object({
    id: z.string(),
    name: z.string(),
    mode: VoiceMode,
    ref_audio_path: z.string().optional(),
    ref_text: z.string().optional(),
    instruct: z.string().optional(),
    design: VoiceDesign.optional(),
    tags: z.array(VoiceTag).optional(),
    language: z.string().optional(),
    speed: z.number().positive().optional(),
  })
  .strict()
  .meta({ ref: "VoicePreset" })

export const Tts = z
  .object({
    provider: z.literal("omnivoice").optional(),
    default_preset: z.string().optional(),
    presets: z.array(Preset).optional(),
    live: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    chunking: z.enum(["sentence", "clause"]).optional(),
    stop_on_interrupt: z.boolean().optional(),
    strip_markdown: z.boolean().optional(),
    speed: z.number().positive().optional(),
    duration: z.number().positive().optional(),
    num_step: z.number().int().positive().optional(),
    call_speed: z.number().positive().optional(),
    call_num_step: z.number().int().positive().optional(),
    call_chunking: z.enum(["sentence", "clause"]).optional(),
    call_stop_on_interrupt: z.boolean().optional(),
    call_strip_markdown: z.boolean().optional(),
  })
  .strict()
  .meta({ ref: "VoiceTts" })

export const VoiceSchema = z
  .object({
    runtime: Runtime.optional(),
    stt: Stt.optional(),
    tts: Tts.optional(),
  })
  .strict()
  .meta({ ref: "VoiceConfig" })

export const RuntimeCfg = z
  .object({
    enabled: z.boolean(),
    python: z.string(),
    device: z.enum(["auto", "cuda", "cpu", "mps"]),
    dtype: z.enum(["auto", "float16", "float32", "int8"]),
    install_on_demand: z.boolean(),
    hf_token: z.string().optional(),
  })
  .strict()
  .meta({ ref: "VoiceRuntimeConfig" })

export const SttCfg = z
  .object({
    provider: z.literal("whisperx"),
    model: z.string(),
    call_model: z.string(),
    language: z.string(),
    timestamps: z.enum(["none", "segment", "word"]),
    diarization: z.boolean(),
    vad: z.boolean(),
    compute_type: z.enum(["float16", "float32", "int8"]),
    batch_size: z.number().int().positive(),
    beam_size: z.number().int().positive(),
    call_partial_interval_ms: z.number().int().positive(),
    call_pause_profile: VoicePauseProfile,
    short_pause_ms: z.number().int().positive(),
    medium_pause_ms: z.number().int().positive(),
    long_pause_ms: z.number().int().positive(),
  })
  .strict()
  .meta({ ref: "VoiceSttConfig" })

export const TtsCfg = z
  .object({
    provider: z.literal("omnivoice"),
    default_preset: z.string().optional(),
    presets: z.array(Preset),
    live: z.boolean(),
    autoplay: z.boolean(),
    chunking: z.enum(["sentence", "clause"]),
    stop_on_interrupt: z.boolean(),
    strip_markdown: z.boolean(),
    speed: z.number().positive(),
    duration: z.number().positive().optional(),
    num_step: z.number().int().positive(),
    call_speed: z.number().positive(),
    call_num_step: z.number().int().positive(),
    call_chunking: z.enum(["sentence", "clause"]),
    call_stop_on_interrupt: z.boolean(),
    call_strip_markdown: z.boolean(),
  })
  .strict()
  .meta({ ref: "VoiceTtsConfig" })

export const ConfigCfg = z
  .object({
    runtime: RuntimeCfg,
    stt: SttCfg,
    tts: TtsCfg,
  })
  .strict()
  .meta({ ref: "VoiceConfigResolved" })

export const Paths = z
  .object({
    root: z.string(),
    references: z.string(),
    stt_root: z.string(),
    stt_venv: z.string(),
    stt_python: z.string(),
    stt_marker: z.string(),
    tts_root: z.string(),
    tts_venv: z.string(),
    tts_python: z.string(),
    tts_marker: z.string(),
    ffmpeg_dir: z.string(),
    ffmpeg: z.string().optional(),
    ffprobe: z.string().optional(),
    hf: z.string(),
    tmp: z.string(),
  })
  .strict()
  .meta({ ref: "VoicePaths" })

export const Phase = z
  .enum(["disabled", "idle", "ensuring", "starting", "ready", "busy", "error"])
  .meta({ ref: "VoicePhase" })

export const Activity = z
  .object({
    target: z.enum(["stt", "tts", "all"]).nullable(),
    stage: z.string().optional(),
    progress: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .meta({ ref: "VoiceActivity" })

export const ModelStatus = z
  .object({
    id: z.string(),
    downloaded: z.boolean(),
    active: z.boolean(),
    loading: z.boolean(),
    progress: z.number().int().min(0).max(100).optional(),
    note: z.string().optional(),
  })
  .strict()
  .meta({ ref: "VoiceModelStatus" })

export const EngineStatus = z
  .object({
    installed: z.boolean(),
    worker: z.boolean(),
    warmed: z.boolean(),
    standby: z.boolean(),
    device: z.string().optional(),
    model: z.string().optional(),
    loading: z.boolean(),
    progress: z.number().int().min(0).max(100).optional(),
    note: z.string().optional(),
    models: z.array(ModelStatus).optional(),
  })
  .strict()
  .meta({ ref: "VoiceEngineStatus" })

export const DependencyStatus = z
  .object({
    python: z.boolean(),
    ffmpeg: z.boolean(),
  })
  .strict()
  .meta({ ref: "VoiceDependencyStatus" })

export const Status = z
  .object({
    ready: z.boolean(),
    phase: Phase,
    active_engine: z.enum(["stt", "tts"]).nullable(),
    device: z.string(),
    diarization: z.boolean(),
    worker: z.boolean(),
    ffmpeg: z.boolean(),
    deps: DependencyStatus,
    error: z.string().optional(),
    activity: Activity,
    engines: z
      .object({
        stt: EngineStatus,
        tts: EngineStatus,
      })
      .strict(),
    config: ConfigCfg,
    paths: Paths,
  })
  .strict()
  .meta({ ref: "VoiceStatus" })

export const EnsureInput = z
  .object({
    preload: z.boolean().optional(),
    target: z.enum(["all", "stt", "tts"]).optional(),
  })
  .strict()
  .meta({ ref: "VoiceEnsureInput" })

export const CancelInput = z
  .object({
    target: z.enum(["all", "stt", "tts"]).optional(),
  })
  .strict()
  .meta({ ref: "VoiceCancelInput" })

export const ReferenceInput = z
  .object({
    audio: z.string(),
    name: z.string().trim().min(1).optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    transcribe: z.boolean().optional(),
    language: z.string().optional(),
  })
  .strict()
  .meta({ ref: "VoiceReferenceInput" })

export const ReferenceOutput = z
  .object({
    path: z.string(),
    name: z.string(),
    duration_ms: z.number().int().nonnegative(),
    text: z.string().optional(),
    language: z.string().optional(),
    transcript_error: z.string().optional(),
  })
  .strict()
  .meta({ ref: "VoiceReferenceOutput" })

export const AssetInput = z
  .object({
    path: z.string(),
  })
  .strict()
  .meta({ ref: "VoiceAssetInput" })

export const AssetOutput = z
  .object({
    path: z.string(),
    name: z.string(),
    audio: z.string(),
  })
  .strict()
  .meta({ ref: "VoiceAssetOutput" })

export const Word = z
  .object({
    word: z.string(),
    start: z.number().nullable().optional(),
    end: z.number().nullable().optional(),
    score: z.number().nullable().optional(),
    speaker: z.string().optional(),
  })
  .strict()
  .meta({ ref: "VoiceWord" })

export const Segment = z
  .object({
    id: z.number().int().optional(),
    text: z.string(),
    start: z.number().nullable().optional(),
    end: z.number().nullable().optional(),
    speaker: z.string().optional(),
    words: z.array(Word).optional(),
  })
  .strict()
  .meta({ ref: "VoiceSegment" })

export const TranscribeInput = z
  .object({
    audio: z.string(),
    language: z.string().optional(),
    diarization: z.boolean().optional(),
    profile: VoiceProfile.optional(),
    partial: z.boolean().optional(),
  })
  .strict()
  .meta({ ref: "VoiceTranscribeInput" })

export const TranscribeOutput = z
  .object({
    text: z.string(),
    language: z.string().optional(),
    duration_ms: z.number().nonnegative(),
    segments: z.array(Segment),
    words: z.array(Word),
    speaker_labels: z.array(z.string()).optional(),
    raw: z.unknown().optional(),
  })
  .strict()
  .meta({ ref: "VoiceTranscribeOutput" })

export const SynthesizeInput = z
  .object({
    text: z.string(),
    profile: VoiceProfile.optional(),
    rank: z.number().int().nonnegative().optional(),
    preset: z.string().optional(),
    mode: VoiceMode.optional(),
    ref_audio_path: z.string().optional(),
    ref_text: z.string().optional(),
    instruct: z.string().optional(),
    design: VoiceDesign.optional(),
    tags: z.array(VoiceTag).optional(),
    language: z.string().optional(),
    speed: z.number().positive().optional(),
    duration: z.number().positive().optional(),
    num_step: z.number().int().positive().optional(),
  })
  .strict()
  .meta({ ref: "VoiceSynthesizeInput" })

export const SynthesizeOutput = z
  .object({
    mime: z.string(),
    sample_rate: z.number().int().positive(),
    duration_ms: z.number().nonnegative(),
    text_used: z.string(),
    audio: z.string(),
    meta: z.unknown().optional(),
  })
  .strict()
  .meta({ ref: "VoiceSynthesizeOutput" })

export type VoiceConfig = z.infer<typeof VoiceSchema>
export type VoiceConfigResolved = z.infer<typeof ConfigCfg>
export type VoiceStatus = z.infer<typeof Status>
export type VoiceCancelInput = z.infer<typeof CancelInput>
export type VoicePreset = z.infer<typeof Preset>
export type VoiceDesign = z.infer<typeof VoiceDesign>
export type VoiceReferenceInput = z.infer<typeof ReferenceInput>
export type VoiceReferenceOutput = z.infer<typeof ReferenceOutput>
export type VoiceAssetInput = z.infer<typeof AssetInput>
export type VoiceAssetOutput = z.infer<typeof AssetOutput>
export type VoiceTranscribeInput = z.infer<typeof TranscribeInput>
export type VoiceTranscribeOutput = z.infer<typeof TranscribeOutput>
export type VoiceSynthesizeInput = z.infer<typeof SynthesizeInput>
export type VoiceSynthesizeOutput = z.infer<typeof SynthesizeOutput>

export function voicePreset(input: z.input<typeof ConfigCfg>, id?: string) {
  const cfg = ConfigCfg.parse(input)
  if (id) return cfg.tts.presets.find((item) => item.id === id)
  if (!cfg.tts.default_preset) return cfg.tts.presets[0]
  return cfg.tts.presets.find((item) => item.id === cfg.tts.default_preset) ?? cfg.tts.presets[0]
}

export function voiceInput(input: {
  config: z.input<typeof ConfigCfg>
  text: string
  preset?: string
  profile?: z.input<typeof VoiceProfile>
  num_step?: number
  rank?: number
}) {
  const cfg = ConfigCfg.parse(input.config)
  const item = voicePreset(cfg, input.preset)
  const call = input.profile === "call"
  return SynthesizeInput.parse({
    text: normalizeSpeechText(input.text, { stripMarkdown: call ? cfg.tts.call_strip_markdown : cfg.tts.strip_markdown }),
    profile: input.profile,
    rank: input.rank,
    mode: item?.mode,
    ref_audio_path: item?.ref_audio_path,
    ref_text: item?.ref_text,
    instruct: item?.instruct,
    design: item?.design,
    tags: item?.tags,
    language: item?.language,
    speed: item?.speed ?? (call ? cfg.tts.call_speed : cfg.tts.speed),
    duration: cfg.tts.duration,
    num_step: input.num_step ?? (call ? cfg.tts.call_num_step : cfg.tts.num_step),
  })
}

export function voiceDesignText(input?: z.input<typeof VoiceDesign>) {
  const design = VoiceDesign.optional().parse(input)
  if (!design) return

  const zh = !!design.chinese_dialect
  const gender =
    design.gender === "female" ? (zh ? "\u5973" : "female") : design.gender === "male" ? (zh ? "\u7537" : "male") : undefined
  const age =
    design.age === "child"
      ? zh
        ? "\u513f\u7ae5"
        : "child"
      : design.age === "teenager"
        ? zh
          ? "\u5c11\u5e74"
          : "teenager"
        : design.age === "young adult"
          ? zh
            ? "\u9752\u5e74"
            : "young adult"
          : design.age === "middle-aged"
            ? zh
              ? "\u4e2d\u5e74"
              : "middle-aged"
            : design.age === "elderly"
              ? zh
                ? "\u8001\u5e74"
                : "elderly"
              : undefined
  const pitch =
    design.pitch === "very low pitch"
      ? zh
        ? "\u6781\u4f4e\u97f3\u8c03"
        : "very low pitch"
      : design.pitch === "low pitch"
        ? zh
          ? "\u4f4e\u97f3\u8c03"
          : "low pitch"
        : design.pitch === "moderate pitch"
          ? zh
            ? "\u4e2d\u97f3\u8c03"
            : "moderate pitch"
          : design.pitch === "high pitch"
            ? zh
              ? "\u9ad8\u97f3\u8c03"
              : "high pitch"
            : design.pitch === "very high pitch"
              ? zh
                ? "\u6781\u9ad8\u97f3\u8c03"
                : "very high pitch"
              : undefined
  const style = design.style === "whisper" ? (zh ? "\u8033\u8bed" : "whisper") : undefined
  const bits = [gender, age, pitch, style, zh ? design.chinese_dialect : design.english_accent].filter(
    (item): item is string => !!item,
  )

  if (bits.length === 0) return
  return zh ? bits.join("\uff0c") : bits.join(", ")
}

export function runtimeCfg(input?: z.input<typeof Runtime>) {
  return RuntimeCfg.parse({
    enabled: true,
    python: "C:\\Python313\\python.exe",
    device: "auto",
    dtype: "float16",
    install_on_demand: true,
    ...input,
  })
}

export function sttCfg(input?: z.input<typeof Stt>) {
  return SttCfg.parse({
    provider: "whisperx",
    model: "small",
    call_model: "small",
    language: "auto",
    timestamps: "word",
    diarization: false,
    vad: true,
    compute_type: "float16",
    batch_size: 8,
    beam_size: 5,
    call_partial_interval_ms: 700,
    call_pause_profile: "balanced",
    short_pause_ms: 180,
    medium_pause_ms: 420,
    long_pause_ms: 850,
    ...input,
  })
}

export function ttsCfg(input?: z.input<typeof Tts>) {
  const next = input
    ? {
        ...input,
        chunking: input.chunking === "sentence" ? "clause" : input.chunking,
        call_chunking: input.call_chunking === "sentence" ? "clause" : input.call_chunking,
      }
    : undefined
  return TtsCfg.parse({
    provider: "omnivoice",
    default_preset: undefined,
    presets: [],
    live: true,
    autoplay: true,
    chunking: "clause",
    stop_on_interrupt: true,
    strip_markdown: true,
    speed: 1,
    duration: undefined,
    num_step: 32,
    call_speed: 1,
    call_num_step: 18,
    call_chunking: "clause",
    call_stop_on_interrupt: true,
    call_strip_markdown: true,
    ...next,
  })
}

export function voiceCfg(input?: z.input<typeof VoiceSchema>) {
  return ConfigCfg.parse({
    runtime: runtimeCfg(input?.runtime),
    stt: sttCfg(input?.stt),
    tts: ttsCfg(input?.tts),
  })
}
