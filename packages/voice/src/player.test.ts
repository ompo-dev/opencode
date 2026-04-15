import { afterEach, describe, expect, test } from "bun:test"
import { createAudioQueue } from "./player"

const tick = async (count = 4) => {
  for (let idx = 0; idx < count; idx += 1) {
    await Promise.resolve()
  }
}

class FakeAudio {
  static list: FakeAudio[] = []
  src = ""
  preload = ""
  currentTime = 0
  volume = 1
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playCount = 0
  pauseCount = 0

  constructor(src = "") {
    this.src = src
    FakeAudio.list.push(this)
  }

  play() {
    this.playCount += 1
    return Promise.resolve()
  }

  pause() {
    this.pauseCount += 1
  }
}

const OriginalAudio = globalThis.Audio

afterEach(() => {
  FakeAudio.list.length = 0
  if (OriginalAudio) {
    globalThis.Audio = OriginalAudio
    return
  }
  Reflect.deleteProperty(globalThis, "Audio")
})

describe("createAudioQueue", () => {
  test("does not restart the current html audio item when new audio is enqueued", async () => {
    globalThis.Audio = FakeAudio as unknown as typeof Audio

    const queue = createAudioQueue({
      prefer: "htmlaudio",
    })

    queue.enqueue("data:audio/wav;base64,UklG")
    await tick()

    const item = FakeAudio.list[0]
    expect(item).toBeDefined()
    expect(item?.playCount).toBe(1)

    queue.enqueue("data:audio/wav;base64,UklH")
    await tick()

    expect(item?.playCount).toBe(1)

    item?.onended?.()
    await tick()

    expect(item?.playCount).toBe(2)
    queue.dispose()
  })
})
