import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { insertPromptText } from "./voice"

describe("prompt voice helpers", () => {
  test("insertPromptText preserves attachments and spacing", () => {
    const prompt: Prompt = [
      { type: "text", content: "Hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/app.ts",
        content: "@src/app.ts",
        start: 5,
        end: 16,
      },
      { type: "text", content: "world", start: 16, end: 21 },
      {
        type: "image",
        id: "img_1",
        filename: "shot.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,abc",
      },
    ]

    const next = insertPromptText(prompt, "from voice", 5)

    expect(next.cursor).toBe(17)
    expect(next.prompt.at(-1)?.type).toBe("image")
    expect(next.prompt.filter((part) => part.type === "image")).toHaveLength(1)
    expect(
      next.prompt
        .filter((part) => part.type !== "image")
        .map((part) => part.content)
        .join(""),
    ).toBe("Hello from voice @src/app.tsworld")
  })

  test("insertPromptText keeps cursor inside the text stream", () => {
    const prompt: Prompt = [{ type: "text", content: "Alpha Beta", start: 0, end: 10 }]

    const next = insertPromptText(prompt, "gamma", 5)

    expect(next.cursor).toBe(11)
    expect(next.prompt[0]?.type === "text" ? next.prompt[0].content : "").toBe("Alpha gamma Beta")
  })
})
