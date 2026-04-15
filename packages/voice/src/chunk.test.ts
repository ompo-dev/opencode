import { describe, expect, test } from "bun:test"
import { SentenceChunker, normalizeSpeechText } from "./chunk"

describe("normalizeSpeechText", () => {
  test("preserves supported tags while stripping markdown", () => {
    const text = normalizeSpeechText("**Hello** [laughter] [link](https://example.com) `x`")
    expect(text).toBe("Hello [laughter] link x")
  })
})

describe("SentenceChunker", () => {
  test("flushes terminal sentences", () => {
    const chunk = new SentenceChunker()
    expect(chunk.sync("Hello world. Next line")).toEqual(["Hello world."])
    expect(chunk.flush()).toEqual(["Next line"])
  })

  test("waits for a short exclamation lead to complete before splitting", () => {
    const chunk = new SentenceChunker()
    expect(chunk.sync("Claro! Eu sou seu assistente")).toEqual([])
    expect(chunk.sync("Claro! Eu sou seu assistente de IA.")).toEqual(["Claro! Eu sou seu assistente de IA."])
  })

  test("still flushes a short exclamation when the text is complete", () => {
    const chunk = new SentenceChunker()
    expect(chunk.sync("Claro!")).toEqual([])
    expect(chunk.flush()).toEqual(["Claro!"])
  })

  test("flushes long pending text after idle", () => {
    const chunk = new SentenceChunker({ limit: 10, idle: 100 })
    expect(chunk.sync("alpha beta gamma", false, 0)).toEqual([])
    expect(chunk.sync("alpha beta gamma", false, 200)).toEqual(["alpha beta"])
    expect(chunk.flush(300)).toEqual(["gamma"])
  })
})
