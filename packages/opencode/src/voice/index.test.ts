import { describe, expect, test } from "bun:test"
import { voiceCfg } from "@opencode-ai/voice/schema"
import { resolveSynth, voicePaths } from "./index"

describe("voicePaths", () => {
  test("splits stt and tts runtimes", () => {
    const paths = voicePaths({
      data: "C:\\data",
      cache: "C:\\cache",
    })

    expect(paths.stt_venv).toContain("\\voice\\stt\\venv")
    expect(paths.tts_venv).toContain("\\voice\\tts\\venv")
    expect(paths.tmp).toBe("C:\\cache\\voice")
  })
})

describe("resolveSynth", () => {
  test("merges preset defaults into synthesis input", () => {
    const config = voiceCfg({
      tts: {
        default_preset: "clone",
        speed: 1.1,
        num_step: 24,
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

    const out = resolveSynth(config, {
      text: "hello",
    })

    expect(out.mode).toBe("clone")
    expect(out.ref_audio_path).toBe("C:\\voice\\ref.wav")
    expect(out.speed).toBe(1.1)
    expect(out.num_step).toBe(24)
  })

  test("prefers explicit overrides over preset values", () => {
    const config = voiceCfg({
      tts: {
        presets: [
          {
            id: "design",
            name: "Design",
            mode: "design",
            instruct: "warm",
            speed: 0.8,
          },
        ],
      },
    })

    const out = resolveSynth(config, {
      text: "hello",
      preset: "design",
      instruct: "bright",
      speed: 1.2,
    })

    expect(out.instruct).toBe("bright")
    expect(out.speed).toBe(1.2)
  })

  test("folds structured design controls into the OmniVoice instruction", () => {
    const config = voiceCfg({
      tts: {
        presets: [
          {
            id: "design",
            name: "Design",
            mode: "design",
            design: {
              gender: "female",
              pitch: "low pitch",
            },
            instruct: "whisper",
          },
        ],
      },
    })

    const out = resolveSynth(config, {
      text: "hello",
      preset: "design",
      design: {
        age: "young adult",
      },
    })

    expect(out.instruct).toBe("female, young adult, low pitch, whisper")
    expect(out.design?.age).toBe("young adult")
  })

  test("falls back to ad hoc synthesis when a preset id is missing", () => {
    const config = voiceCfg({
      tts: {
        default_preset: "gone",
        speed: 1.05,
        num_step: 20,
        presets: [],
      },
    })

    const out = resolveSynth(config, {
      text: "hello",
      preset: "missing",
      mode: "design",
      instruct: "calm",
    })

    expect(out.preset).toBeUndefined()
    expect(out.mode).toBe("design")
    expect(out.instruct).toBe("calm")
    expect(out.speed).toBe(1.05)
    expect(out.num_step).toBe(20)
  })
})
