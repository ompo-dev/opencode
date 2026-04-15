import z from "zod"
import { ConfigCfg, Status, SynthesizeInput, TranscribeOutput, VoiceMode } from "./schema"

const Base = z
  .object({
    id: z.string(),
  })
  .strict()

export const Warm = Base.extend({
  cmd: z.literal("warm"),
  input: z
    .object({
      cfg: ConfigCfg,
      stt: z.boolean().optional(),
      tts: z.boolean().optional(),
    })
    .strict(),
}).meta({ ref: "VoiceWorkerWarm" })

export const Stat = Base.extend({
  cmd: z.literal("status"),
  input: z
    .object({
      cfg: ConfigCfg,
    })
    .strict(),
}).meta({ ref: "VoiceWorkerStatus" })

export const Transcribe = Base.extend({
  cmd: z.literal("transcribe"),
  input: z
    .object({
      cfg: ConfigCfg,
      path: z.string(),
      language: z.string().optional(),
      diarization: z.boolean().optional(),
    })
    .strict(),
}).meta({ ref: "VoiceWorkerTranscribe" })

export const Synthesize = Base.extend({
  cmd: z.literal("synthesize"),
  input: z
    .object({
      cfg: ConfigCfg,
      text: z.string(),
      preset: z.string().optional(),
      mode: VoiceMode.optional(),
      ref_audio_path: z.string().optional(),
      ref_text: z.string().optional(),
      instruct: z.string().optional(),
      tags: z.array(z.string()).optional(),
      language: z.string().optional(),
      speed: z.number().positive().optional(),
      duration: z.number().positive().optional(),
      num_step: z.number().int().positive().optional(),
    })
    .strict(),
}).meta({ ref: "VoiceWorkerSynthesize" })

export const Req = z.discriminatedUnion("cmd", [Warm, Stat, Transcribe, Synthesize]).meta({ ref: "VoiceWorkerReq" })

export const Ok = z
  .object({
    id: z.string(),
    type: z.literal("ok"),
    result: z.unknown(),
  })
  .strict()
  .meta({ ref: "VoiceWorkerOk" })

export const Err = z
  .object({
    id: z.string(),
    type: z.literal("err"),
    error: z.string(),
  })
  .strict()
  .meta({ ref: "VoiceWorkerErr" })

export const Res = z.discriminatedUnion("type", [Ok, Err]).meta({ ref: "VoiceWorkerRes" })

export type VoiceWorkerReq = z.infer<typeof Req>
export type VoiceWorkerRes = z.infer<typeof Res>
export type VoiceWorkerStatus = z.infer<typeof Status>
export type VoiceWorkerTranscribe = z.infer<typeof TranscribeOutput>
export type VoiceWorkerSynthesize = {
  mime: string
  sample_rate: number
  duration_ms: number
  text_used: string
  audio: string
  meta?: unknown
}
