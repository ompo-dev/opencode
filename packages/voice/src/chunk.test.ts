import { describe, expect, test } from "bun:test"
import { ClauseChunker, LineChunker, SentenceChunker, normalizeSpeechLines, normalizeSpeechText } from "./chunk"

describe("normalizeSpeechText", () => {
  test("preserves supported tags while stripping markdown", () => {
    const text = normalizeSpeechText("**Hello** [laughter] [link](https://example.com) `x`")
    expect(text).toBe("Hello [laughter] link x")
  })

  test("turns markdown structure into speakable sentences", () => {
    const text = normalizeSpeechText("# Summary\n- first item\n- second item\n> quoted line")
    expect(text).toBe("Summary.\nfirst item.\nsecond item.\nquoted line.")
  })
})

describe("normalizeSpeechLines", () => {
  test("preserves a trailing newline for line streaming", () => {
    const text = normalizeSpeechLines("alpha\n")
    expect(text).toBe("alpha\n")
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

describe("ClauseChunker", () => {
  test("emits short lead clauses and following clauses progressively", () => {
    const chunk = new ClauseChunker()
    expect(chunk.sync("Sim, tenho integração com o Outline.")).toEqual(["Sim,", "tenho integração com o Outline."])
  })

  test("holds the last unfinished clause until flush", () => {
    const chunk = new ClauseChunker()
    expect(chunk.sync("Posso criar e gerenciar documentos,")).toEqual(["Posso criar e gerenciar documentos,"])
    expect(chunk.sync("Posso criar e gerenciar documentos, mover e renomear")).toEqual([])
    expect(chunk.flush()).toEqual(["mover e renomear"])
  })
})

describe("LineChunker", () => {
  test("emits complete lines before the message ends", () => {
    const chunk = new LineChunker()
    expect(chunk.sync("alpha\n")).toEqual(["alpha"])
    expect(chunk.sync("alpha\nbeta")).toEqual([])
    expect(chunk.flush()).toEqual(["beta"])
  })

  test("keeps markdown line semantics for speech", () => {
    const chunk = new LineChunker({ stripMarkdown: true })
    expect(chunk.sync("# Title\n- item")).toEqual(["Title."])
    expect(chunk.flush()).toEqual(["item."])
  })
})
