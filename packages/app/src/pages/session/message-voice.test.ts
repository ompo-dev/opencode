import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { createVoiceCtrl, joinVoiceText } from "./message-voice"

const tick = async (count = 6) => {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve()
  }
}

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
  test("flushes sentence chunks in order", async () => {
    const list: string[] = []
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      synth: async (text) => `audio:${text}`,
      queue: {
        enqueue: (src) => list.push(src),
        clear: () => undefined,
        update: () => undefined,
      },
    })

    ctrl.sync({ msg: "m1", text: "One. Two" })
    ctrl.flush()
    await tick()

    expect(list).toEqual(["audio:One.", "audio:Two"])
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
      queue: {
        enqueue: (src) => list.push(src),
        clear: () => undefined,
        update: () => undefined,
      },
    })

    ctrl.sync({ msg: "m1", text: "First." })
    ctrl.sync({ msg: "m2", text: "Second." })

    await tick(20)
    expect(hold).toHaveLength(1)
    expect(hold[0]?.text).toBe("Second.")
    hold[0]?.resolve(`audio:${hold[0].text}`)
    await tick()

    expect(list).toEqual(["audio:Second."])
  })

  test("emits a soft chunk after the idle window", async () => {
    const list: string[] = []
    let job: (() => void) | undefined
    let now = 1_000
    const ctrl = createVoiceCtrl({
      enabled: () => true,
      strip: () => true,
      synth: async (text) => `audio:${text}`,
      queue: {
        enqueue: (src) => list.push(src),
        clear: () => undefined,
        update: () => undefined,
      },
      later: (fn) => {
        job = fn
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clear: () => {
        job = undefined
      },
      now: () => now,
    })

    ctrl.sync({ msg: "m1", text: "alpha ".repeat(40).trimEnd() })
    expect(list).toEqual([])
    now = 2_000
    job?.()
    await tick()

    expect(list).toHaveLength(1)
    expect(list[0]?.startsWith("audio:alpha")).toBe(true)
  })
})
