import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { createVoiceCtrl, joinVoiceText } from "./message-voice"

const tick = async (count = 6) => {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve()
  }
}

const queue = (list: string[]) => ({
  enqueue: (src: string) => list.push(src),
  clear: () => undefined,
  update: () => undefined,
  state: () => ({
    state: (list.length ? "loading" : "idle") as "idle" | "loading",
    pending: list.length,
    mode: "htmlaudio" as const,
    muted: false,
    volume: 1,
  }),
})

describe("joinVoiceText", () => {
  test("skips synthetic and ignored text parts", () => {
    const parts = [
      { id: "a", sessionID: "s", messageID: "m", type: "text", text: "Hello" },
      { id: "b", sessionID: "s", messageID: "m", type: "text", text: "Skip", synthetic: true },
      { id: "c", sessionID: "s", messageID: "m", type: "text", text: "World", ignored: true },
      { id: "d", sessionID: "s", messageID: "m", type: "text", text: "Again" },
    ] satisfies Part[]

    expect(joinVoiceText(parts)).toBe("Hello\n\nAgain")
  })
})

describe("createVoiceCtrl", () => {
  test("flushes line chunks in order", async () => {
    const list: string[] = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      synth: async (text) => `audio:${text}`,
      queue: queue(list),
    })

    ctrl.sync({ msg: "m1", text: "One\nTwo" })
    ctrl.flush()
    await tick()

    expect(list).toEqual(["audio:One", "audio:Two"])
  })

  test("drops stale audio when the message changes", async () => {
    const list: string[] = []
    const hold: Array<{ text: string; resolve: (value: string) => void }> = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      synth: (text) =>
        new Promise((resolve) => {
          hold.push({ text, resolve })
        }),
      queue: queue(list),
    })

    ctrl.sync({ msg: "m1", text: "First\nnext" })
    ctrl.sync({ msg: "m2", text: "Second\nnext" })

    await tick(20)
    expect(hold).toHaveLength(2)
    expect(hold.map((item) => item.text)).toEqual(["First", "Second"])
    hold[0]?.resolve(`audio:${hold[0].text}`)
    hold[1]?.resolve(`audio:${hold[1].text}`)
    await tick()

    expect(list).toEqual(["audio:Second"])
  })

  test("waits for a full line before queueing the next chunk", async () => {
    const list: string[] = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      synth: async (text) => `audio:${text}`,
      queue: queue(list),
    })

    ctrl.sync({ msg: "m1", text: "alpha" })
    await tick()
    expect(list).toEqual([])
    ctrl.sync({ msg: "m1", text: "alpha\n" })
    await tick()

    expect(list).toEqual(["audio:alpha"])
  })

  test("starts multiple line synths across streaming updates and preserves queue order", async () => {
    const list: string[] = []
    const hold: Array<{ text: string; resolve: (value?: string) => void }> = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      synth: (text) =>
        new Promise((resolve) => {
          hold.push({ text, resolve })
        }),
      queue: queue(list),
    })

    ctrl.sync({ msg: "m1", text: "One\n" })
    ctrl.sync({ msg: "m1", text: "One\nTwo\n" })
    ctrl.sync({ msg: "m1", text: "One\nTwo\nThree" })
    ctrl.flush()
    await tick(20)

    expect(hold.map((item) => item.text)).toEqual(["One", "Two"])

    hold[0]?.resolve("audio:One")
    await tick(10)
    expect(list).toEqual(["audio:One"])
    expect(hold.map((item) => item.text)).toEqual(["One", "Two", "Three"])

    hold[1]?.resolve("audio:Two")
    await tick(10)
    expect(list).toEqual(["audio:One", "audio:Two"])

    hold[2]?.resolve("audio:Three")
    await tick(10)
    expect(list).toEqual(["audio:One", "audio:Two", "audio:Three"])
  })

  test("streams sentence chunks before the full message completes", async () => {
    const list: string[] = []
    const hold: Array<{ text: string; resolve: (value?: string) => void }> = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      chunk: "sentence",
      synth: (text) =>
        new Promise((resolve) => {
          hold.push({ text, resolve })
        }),
      queue: queue(list),
    })

    ctrl.sync({ msg: "m1", text: "Primeira frase." })
    await tick(20)
    expect(hold.map((item) => item.text)).toEqual(["Primeira frase."])

    ctrl.sync({ msg: "m1", text: "Primeira frase. Segunda frase." })
    await tick(20)
    expect(hold.map((item) => item.text)).toEqual(["Primeira frase.", "Segunda frase."])

    hold[0]?.resolve("audio:Primeira")
    await tick(10)
    expect(list).toEqual(["audio:Primeira"])

    hold[1]?.resolve("audio:Segunda")
    await tick(10)
    expect(list).toEqual(["audio:Primeira", "audio:Segunda"])
  })

  test("assigns higher effort to earlier chunks", async () => {
    const efforts: number[] = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      chunk: "clause",
      width: 3,
      synth: async (text, meta) => {
        efforts.push(meta.effort)
        return `audio:${text}`
      },
      queue: {
        enqueue: () => undefined,
        clear: () => undefined,
        update: () => undefined,
        state: () => ({
          state: "idle" as const,
          pending: 0,
          mode: "htmlaudio" as const,
          muted: false,
          volume: 1,
        }),
      },
    })

    ctrl.sync({ msg: "m1", text: "Sim, tenho integração com o Outline. Posso criar e gerenciar documentos e coleções, tipo pastas e notas." })
    await tick(20)

    expect(efforts[0]).toBe(1)
    expect(efforts[1]).toBe(0.5)
    expect(efforts[2]).toBe(0.25)
  })
})
