import { describe, expect, test } from "bun:test"
import { merge, score, terms } from "./search"

describe("file search helpers", () => {
  test("keeps a single-line query intact", () => {
    expect(terms("  foo(bar)  ")).toEqual(["foo(bar)"])
    expect(terms(" \n ")).toEqual([])
  })

  test("splits multiline snippets into unique lines", () => {
    expect(terms("const a = 1\n\nconst b = 2\nconst a = 1")).toEqual(["const a = 1", "const b = 2"])
  })

  test("ranks files by repeated content hits", () => {
    expect(score([["a.ts", "b.ts"], ["b.ts", "c.ts"], ["b.ts"]])).toEqual(["b.ts", "a.ts", "c.ts"])
  })

  test("merges path and content matches without duplicates", () => {
    expect(merge([["src", "src/a.ts"], ["src/a.ts", "test/a.ts"]])).toEqual(["src", "src/a.ts", "test/a.ts"])
  })
})
