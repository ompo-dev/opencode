import { describe, expect, test } from "bun:test"
import { Paths, voiceCfg, voiceDesignText, voiceInput, voicePreset, voiceTags } from "./schema"

describe("voiceCfg", () => {
  test("fills defaults", () => {
    const cfg = voiceCfg()
    expect(cfg.runtime.enabled).toBe(true)
    expect(cfg.stt.provider).toBe("whisperx")
    expect(cfg.tts.provider).toBe("omnivoice")
  })

  test("accepts presets and tags", () => {
    const cfg = voiceCfg({
      tts: {
        presets: [
          {
            id: "voice",
            name: "Voice",
            mode: "design",
            instruct: "female, low pitch",
            tags: [voiceTags[0]],
          },
        ],
      },
    })
    expect(cfg.tts.presets[0]?.tags?.[0]).toBe("[laughter]")
  })

  test("serializes structured voice design instructions", () => {
    expect(
      voiceDesignText({
        gender: "female",
        age: "young adult",
        pitch: "low pitch",
        style: "whisper",
        english_accent: "british accent",
      }),
    ).toBe("female, young adult, low pitch, whisper, british accent")
  })

  test("parses split runtime paths", () => {
    const paths = Paths.parse({
      root: "C:\\voice",
      references: "C:\\voice\\references",
      stt_root: "C:\\voice\\stt",
      stt_venv: "C:\\voice\\stt\\venv",
      stt_python: "C:\\voice\\stt\\venv\\Scripts\\python.exe",
      stt_marker: "C:\\voice\\stt\\install.json",
      tts_root: "C:\\voice\\tts",
      tts_venv: "C:\\voice\\tts\\venv",
      tts_python: "C:\\voice\\tts\\venv\\Scripts\\python.exe",
      tts_marker: "C:\\voice\\tts\\install.json",
      ffmpeg_dir: "C:\\voice\\ffmpeg",
      hf: "C:\\voice\\hf",
      tmp: "C:\\voice\\tmp",
    })

    expect(paths.stt_python.endsWith("python.exe")).toBe(true)
    expect(paths.tts_marker.endsWith("install.json")).toBe(true)
    expect(paths.references.endsWith("references")).toBe(true)
  })

  test("resolves the configured default preset", () => {
    const cfg = voiceCfg({
      tts: {
        default_preset: "clone",
        presets: [
          {
            id: "clone",
            name: "Clone",
            mode: "clone",
            ref_audio_path: "C:\\voice\\ref.wav",
          },
        ],
      },
    })

    expect(voicePreset(cfg)?.id).toBe("clone")
  })

  test("builds synth input from config without sending a preset id", () => {
    const cfg = voiceCfg({
      tts: {
        default_preset: "design",
        speed: 1.15,
        num_step: 24,
        presets: [
          {
            id: "design",
            name: "Design",
            mode: "design",
            instruct: "warm",
          },
        ],
      },
    })

    const out = voiceInput({
      config: cfg,
      text: "hello",
    })

    expect(out.preset).toBeUndefined()
    expect(out.mode).toBe("design")
    expect(out.instruct).toBe("warm")
    expect(out.speed).toBe(1.15)
    expect(out.num_step).toBe(24)
  })
})
